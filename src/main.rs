//! Scrawl server: serves the web app, relays board edits over WebSockets, stores boards as JSON
//! files and uploaded images/GIFs on disk. No database, no accounts.
use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, Path, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::broadcast;
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};

const MAX_OBJECTS: usize = 6000;
const MAX_USERS_PER_ROOM: usize = 60;
const MAX_ROOMS: usize = 5000;
const MAX_MSG: usize = 512 * 1024;
const MAX_UPLOAD: usize = 10 * 1024 * 1024;
const MAX_STROKE_NUMS: usize = 40_000;

struct User {
    name: String,
    color: String,
}

struct Room {
    objs: Mutex<Vec<Value>>,
    users: Mutex<HashMap<u64, User>>,
    tx: broadcast::Sender<String>,
    dirty: AtomicBool,
}

struct App {
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    data: PathBuf,
    next_id: AtomicU64,
    uploads: Mutex<HashMap<IpAddr, (Instant, u32)>>,
    trust_proxy: bool,
}

type St = Arc<App>;

fn valid_room(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn safe_text(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect()
}

fn safe_color(s: &str) -> String {
    let t: String = s.chars().filter(|c| c.is_ascii_alphanumeric() || "#(),.% ".contains(*c)).take(32).collect();
    if t.is_empty() { "#1b1b1f".into() } else { t }
}

impl App {
    fn room(&self, name: &str) -> Option<Arc<Room>> {
        let mut rooms = self.rooms.lock().unwrap();
        if let Some(r) = rooms.get(name) {
            return Some(r.clone());
        }
        if rooms.len() >= MAX_ROOMS {
            return None;
        }
        let objs: Vec<Value> = std::fs::read_to_string(self.data.join("boards").join(format!("{name}.json")))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let (tx, _) = broadcast::channel(512);
        let r = Arc::new(Room { objs: Mutex::new(objs), users: Mutex::new(HashMap::new()), tx, dirty: AtomicBool::new(false) });
        rooms.insert(name.to_string(), r.clone());
        Some(r)
    }
    fn client_ip(&self, addr: SocketAddr, h: &HeaderMap) -> IpAddr {
        if self.trust_proxy {
            if let Some(ip) = h.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).and_then(|v| v.trim().parse().ok()) {
                return ip;
            }
        }
        addr.ip()
    }
}

/// Check one object coming from a client; returns the cleaned object.
fn clean_obj(mut o: Value) -> Option<Value> {
    let m = o.as_object_mut()?;
    let id = m.get("id")?.as_str()?;
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    let ty = m.get("type")?.as_str()?.to_string();
    if !["stroke", "shape", "text", "note", "image"].contains(&ty.as_str()) {
        return None;
    }
    check_fields(m, &ty)?;
    Some(o)
}

fn check_fields(m: &mut serde_json::Map<String, Value>, ty: &str) -> Option<()> {
    for (k, v) in m.iter_mut() {
        match k.as_str() {
            "id" | "type" => {}
            "c" | "bg" => *v = Value::String(safe_color(v.as_str()?)),
            "s" => {
                if v.as_str()?.chars().count() > 5000 {
                    return None;
                }
            }
            "src" => {
                let s = v.as_str()?;
                if s.len() > 2048 || !(s.starts_with("/files/") || s.starts_with("https://") || s.starts_with("http://")) || s.chars().any(|c| c.is_control() || c == '"' || c == '<') {
                    return None;
                }
            }
            "kind" => {
                if !["line", "arrow", "rect", "ellipse"].contains(&v.as_str()?) {
                    return None;
                }
            }
            "pts" => {
                let a = v.as_array()?;
                if ty != "stroke" || a.len() > MAX_STROKE_NUMS || !a.iter().all(|n| n.is_number()) {
                    return None;
                }
            }
            "hl" => {
                v.as_bool()?;
            }
            "x" | "y" | "x1" | "y1" | "x2" | "y2" | "w" | "h" | "size" => {
                let n = v.as_f64()?;
                if !n.is_finite() || n.abs() > 1.0e7 {
                    return None;
                }
            }
            _ => return None,
        }
    }
    Some(())
}

struct Bucket {
    tokens: f64,
    last: Instant,
}
impl Bucket {
    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens + now.duration_since(self.last).as_secs_f64() * 150.0).min(300.0);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

async fn ws_handler(ws: WebSocketUpgrade, Path(room): Path<String>, Query(q): Query<HashMap<String, String>>, State(st): State<St>) -> Response {
    if !valid_room(&room) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(r) = st.room(&room) else { return StatusCode::SERVICE_UNAVAILABLE.into_response() };
    if r.users.lock().unwrap().len() >= MAX_USERS_PER_ROOM {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let name = safe_text(q.get("name").map(|s| s.as_str()).unwrap_or("Guest"), 24);
    let color = safe_color(q.get("color").map(|s| s.as_str()).unwrap_or("#e03131"));
    ws.max_message_size(MAX_MSG).on_upgrade(move |s| client(s, st, r, name, color))
}

async fn client(socket: WebSocket, st: St, room: Arc<Room>, name: String, color: String) {
    let me = st.next_id.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let mut rx = room.tx.subscribe();
    let users_json = {
        let mut u = room.users.lock().unwrap();
        u.insert(me, User { name: name.clone(), color: color.clone() });
        u.iter().map(|(id, u)| json!({"id": id, "name": u.name, "color": u.color})).collect::<Vec<_>>()
    };
    let init = json!({"t": "init", "you": me, "objs": *room.objs.lock().unwrap(), "users": users_json});
    if sink.send(Message::Text(init.to_string())).await.is_err() {
        room.users.lock().unwrap().remove(&me);
        return;
    }
    let _ = room.tx.send(json!({"t": "join", "u": {"id": me, "name": name, "color": color}}).to_string());

    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(m) => {
                    if sink.send(Message::Text(m)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    let mut bucket = Bucket { tokens: 300.0, last: Instant::now() };
    while let Some(Ok(msg)) = stream.next().await {
        let Message::Text(txt) = msg else {
            if matches!(msg, Message::Close(_)) {
                break;
            }
            continue;
        };
        if !bucket.take() {
            continue;
        }
        let Ok(mut v) = serde_json::from_str::<Value>(&txt) else { continue };
        let t = v.get("t").and_then(|t| t.as_str()).unwrap_or("").to_string();
        match t.as_str() {
            "cur" => {
                let (x, y) = (v.get("x").and_then(|x| x.as_f64()), v.get("y").and_then(|y| y.as_f64()));
                if let (Some(x), Some(y)) = (x, y) {
                    let _ = room.tx.send(json!({"t": "cur", "from": me, "x": x, "y": y}).to_string());
                }
            }
            "add" => {
                let Some(o) = v.get_mut("o").map(Value::take).and_then(clean_obj) else { continue };
                let mut objs = room.objs.lock().unwrap();
                let id = o["id"].as_str().unwrap().to_string();
                if objs.len() >= MAX_OBJECTS || objs.iter().any(|x| x["id"] == id.as_str()) {
                    continue;
                }
                objs.push(o.clone());
                drop(objs);
                room.dirty.store(true, Ordering::Relaxed);
                let _ = room.tx.send(json!({"t": "add", "from": me, "o": o}).to_string());
            }
            "upd" => {
                let Some(id) = v.get("id").and_then(|i| i.as_str()).map(String::from) else { continue };
                let Some(mut p) = v.get_mut("p").map(Value::take) else { continue };
                let Some(pm) = p.as_object_mut() else { continue };
                let mut objs = room.objs.lock().unwrap();
                let Some(o) = objs.iter_mut().find(|o| o["id"] == id.as_str()) else { continue };
                let ty = o["type"].as_str().unwrap_or("").to_string();
                if pm.contains_key("id") || pm.contains_key("type") || check_fields(pm, &ty).is_none() {
                    continue;
                }
                let om = o.as_object_mut().unwrap();
                for (k, val) in pm.iter() {
                    om.insert(k.clone(), val.clone());
                }
                drop(objs);
                room.dirty.store(true, Ordering::Relaxed);
                let _ = room.tx.send(json!({"t": "upd", "from": me, "id": id, "p": p}).to_string());
            }
            "del" => {
                let Some(id) = v.get("id").and_then(|i| i.as_str()).map(String::from) else { continue };
                let mut objs = room.objs.lock().unwrap();
                let before = objs.len();
                objs.retain(|o| o["id"] != id.as_str());
                if objs.len() != before {
                    drop(objs);
                    room.dirty.store(true, Ordering::Relaxed);
                    let _ = room.tx.send(json!({"t": "del", "from": me, "id": id}).to_string());
                }
            }
            "clear" => {
                room.objs.lock().unwrap().clear();
                room.dirty.store(true, Ordering::Relaxed);
                let _ = room.tx.send(json!({"t": "clear", "from": me}).to_string());
            }
            _ => {}
        }
    }
    send_task.abort();
    room.users.lock().unwrap().remove(&me);
    let _ = room.tx.send(json!({"t": "leave", "id": me}).to_string());
}

async fn upload(State(st): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, body: Bytes) -> Response {
    let ip = st.client_ip(addr, &headers);
    {
        let mut u = st.uploads.lock().unwrap();
        let e = u.entry(ip).or_insert((Instant::now(), 0));
        if e.0.elapsed() > Duration::from_secs(60) {
            *e = (Instant::now(), 0);
        }
        e.1 += 1;
        if e.1 > 30 {
            return (StatusCode::TOO_MANY_REQUESTS, "slow down: 30 uploads per minute").into_response();
        }
    }
    let ext = match body.get(..12) {
        Some(b) if b.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
        Some(b) if b.starts_with(&[0xff, 0xd8, 0xff]) => "jpg",
        Some(b) if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") => "gif",
        Some(b) if b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" => "webp",
        _ => return (StatusCode::UNSUPPORTED_MEDIA_TYPE, "only PNG, JPEG, GIF and WebP images are accepted").into_response(),
    };
    let id: String = (0..16).map(|_| format!("{:x}", rand::random::<u8>() & 15)).collect();
    let file = format!("{id}.{ext}");
    let dir = st.data.join("files");
    if tokio::fs::create_dir_all(&dir).await.is_err() || tokio::fs::write(dir.join(&file), &body).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Json(json!({"url": format!("/files/{file}")})).into_response()
}

async fn saver(st: St) {
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let rooms: Vec<(String, Arc<Room>)> = st.rooms.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (name, r) in rooms {
            if r.dirty.swap(false, Ordering::Relaxed) {
                let s = serde_json::to_string(&*r.objs.lock().unwrap()).unwrap_or_default();
                let dir = st.data.join("boards");
                let _ = tokio::fs::create_dir_all(&dir).await;
                let tmp = dir.join(format!("{name}.json.tmp"));
                if tokio::fs::write(&tmp, s).await.is_ok() {
                    let _ = tokio::fs::rename(&tmp, dir.join(format!("{name}.json"))).await;
                }
            }
            if r.users.lock().unwrap().is_empty() && !r.dirty.load(Ordering::Relaxed) {
                st.rooms.lock().unwrap().remove(&name);
            }
        }
    }
}

async fn stats(State(st): State<St>) -> Json<Value> {
    let rooms = st.rooms.lock().unwrap();
    let users: usize = rooms.values().map(|r| r.users.lock().unwrap().len()).sum();
    Json(json!({"boards_loaded": rooms.len(), "connected": users}))
}

fn asset(body: &'static str, ctype: &'static str) -> Response {
    ([(header::CONTENT_TYPE, ctype), (header::CACHE_CONTROL, "no-cache")], body).into_response()
}

#[tokio::main]
async fn main() {
    let data = PathBuf::from(std::env::var("SCRAWL_DATA").unwrap_or_else(|_| "data".into()));
    let addr: SocketAddr = std::env::var("SCRAWL_ADDR").unwrap_or_else(|_| "0.0.0.0:7878".into()).parse().expect("SCRAWL_ADDR must look like 0.0.0.0:7878");
    let _ = std::fs::create_dir_all(data.join("files"));
    let st: St = Arc::new(App { rooms: Mutex::new(HashMap::new()), data: data.clone(), next_id: AtomicU64::new(1), uploads: Mutex::new(HashMap::new()), trust_proxy: std::env::var("SCRAWL_TRUST_PROXY").is_ok() });
    tokio::spawn(saver(st.clone()));

    let files = tower::ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; img-src 'self'")))
        .service(ServeDir::new(data.join("files")));

    let app = Router::new()
        .route("/", get(|| async { Html(include_str!("../web/home.html")) }))
        .route("/b/:room", get(|| async { Html(include_str!("../web/board.html")) }))
        .route("/style.css", get(|| async { asset(include_str!("../web/style.css"), "text/css; charset=utf-8") }))
        .route("/board.js", get(|| async { asset(include_str!("../web/board.js"), "text/javascript; charset=utf-8") }))
        .route("/icon.svg", get(|| async { asset(include_str!("../web/icon.svg"), "image/svg+xml") }))
        .route("/icon-192.png", get(|| async { ([(header::CONTENT_TYPE, "image/png")], include_bytes!("../web/icon-192.png").as_slice()) }))
        .route("/og.png", get(|| async { ([(header::CONTENT_TYPE, "image/png")], include_bytes!("../web/og.png").as_slice()) }))
        .route("/ws/:room", get(ws_handler))
        .route("/api/upload", post(upload).layer(DefaultBodyLimit::max(MAX_UPLOAD)))
        .route("/api/stats", get(stats))
        .nest_service("/files", files)
        .with_state(st);

    println!("Scrawl listening on http://{addr}  (data in {})", data.display());
    let listener = tokio::net::TcpListener::bind(addr).await.expect("could not bind");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}
