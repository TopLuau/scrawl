<p align="center"><img src="web/icon-192.png" width="96" alt="Scrawl"></p>

# Scrawl

A real-time collaborative whiteboard. One Rust binary, no accounts, no database. Open a board, send the link, draw together.

- **Draw and write**: pen, highlighter, eraser, lines, arrows, rectangles, ellipses, text, sticky notes, on an endless pan/zoom canvas.
- **Images and GIFs**: upload, drag and drop, paste from the clipboard, or add by link. GIFs keep animating on the board.
- **Live**: everyone's edits and cursors show up instantly (WebSockets). Select, move, resize, undo/redo (your own actions).
- **Saved**: boards are stored as JSON files on the server and survive restarts.
- **Export** a board as PNG. **Share** copies the board link.

## Run it

```bash
cargo run --release
# open http://localhost:8080
```

| Environment variable | Default | Meaning |
|---|---|---|
| `SCRAWL_ADDR` | `0.0.0.0:8080` | address to listen on |
| `SCRAWL_DATA` | `data` | folder for boards (`boards/`) and uploads (`files/`) |
| `SCRAWL_TRUST_PROXY` | unset | set it when behind a reverse proxy so upload rate limits use `X-Forwarded-For` |

Docker: `docker build -t scrawl . && docker run -p 8080:8080 -v scrawl-data:/data scrawl`

Behind a reverse proxy, forward WebSocket upgrades on `/ws/*`.

## How it works

- `src/main.rs` is the whole server (axum): serves the web app, relays edits per board room over WebSockets, persists rooms every two seconds, accepts image uploads.
- `web/` is the front end, plain JS rendering to SVG. It is embedded into the binary, so deployment is a single file.
- Board code in the URL (`/b/<code>`) is the only access control: anyone with the link can edit. Treat links like unlisted documents.

## Limits and abuse protection

Per board: 6000 objects, 60 people. Per message: 512 KB, plus a per-connection rate limit. Uploads: 10 MB, PNG/JPEG/GIF/WebP only (checked by file signature), 30 per minute per IP, served with `nosniff` and a locked-down CSP. Every object field is validated server side (types, colours, image URLs must be `http(s)` or an uploaded file).

## Tested and not tested

Tested on Windows 11 in Chrome (built-in browser pane): joining, pen strokes, text editing, moving objects, delete/undo/redo, GIF upload by drop and animation, live sync and presence between two clients (the second client was a scripted WebSocket client), persistence across a server restart, rejection of bad objects and non-image uploads.

Not tested: Safari and Firefox, real touch devices (pinch zoom is implemented but untried), multiple real people on separate machines, PNG export of boards containing remote images (cross-origin images are skipped if the host blocks fetching), Linux/macOS builds (CI builds them).

Known gaps: no multi-select, undo is per person and local, no authentication or board passwords.

## Icon

`tools/make-icon.py` draws the icon, favicon and social card in code (Python and Pillow).

MIT licensed.
