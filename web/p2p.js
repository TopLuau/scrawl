/* Scrawl peer-to-peer transport, used on static hosts (Vercel) where there is no board server.
 *
 * The first person to open a board code hosts it in their browser; everyone else connects to the
 * host over WebRTC (PeerJS). The host plays the same role as the Rust server: it validates edits,
 * keeps the board state and relays changes. If the host leaves, a remaining person takes over
 * using their own copy of the board. A public PeerJS server is only used to introduce browsers
 * to each other; drawings travel directly between them.
 */
(() => {
'use strict';
const PREFIX = 'scrawl-v1-';
const TYPES = ['stroke', 'shape', 'text', 'note', 'image'];
const MAX_OBJS = 3000, MAX_USERS = 30, MAX_SRC = 3.2e6;
const okId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s);
const num = v => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 1e7;
const safeColor = s => String(s).replace(/[^A-Za-z0-9#(),.% ]/g, '').slice(0, 32) || '#17171c';
const safeName = s => String(s || 'Guest').replace(/[\u0000-\u001f]/g, '').slice(0, 24) || 'Guest';

// Same rules as the Rust server's check_fields, because peers are strangers.
function checkFields(m, ty) {
  for (const k of Object.keys(m)) {
    const v = m[k];
    switch (k) {
      case 'id': case 'type': break;
      case 'c': case 'bg': if (typeof v !== 'string') return false; m[k] = safeColor(v); break;
      case 's': if (typeof v !== 'string' || v.length > 10000) return false; break;
      case 'src':
        if (typeof v !== 'string' || v.length > MAX_SRC) return false;
        if (/^https?:\/\//i.test(v)) { if (v.length > 2048 || /["<\s]/.test(v)) return false; }
        else if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(v)) return false;
        break;
      case 'kind': if (!['line', 'arrow', 'rect', 'ellipse'].includes(v)) return false; break;
      case 'pts': if (ty !== 'stroke' || !Array.isArray(v) || v.length > 40000 || !v.every(num)) return false; break;
      case 'hl': if (typeof v !== 'boolean') return false; break;
      case 'x': case 'y': case 'x1': case 'y1': case 'x2': case 'y2': case 'w': case 'h': case 'size': if (!num(v)) return false; break;
      default: return false;
    }
  }
  return true;
}
function cleanObj(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || !okId(o.id) || !TYPES.includes(o.type)) return null;
  return checkFields(o, o.type) ? o : null;
}

function start({ room, me, onMessage, onStatus, getObjs }) {
  const hostId = PREFIX + room.toLowerCase();
  const peerCfg = (window.SCRAWL && window.SCRAWL.peer) || {};
  const storeKey = 'scrawl.board.' + room.toLowerCase();
  let peer = null, role = null, hostConn = null, H = null, tries = 0, saveTimer = null, gone = false;

  const status = (ok, text) => onStatus(ok, text, role);
  const kill = () => { try { peer && peer.destroy(); } catch {} peer = null; hostConn = null; };
  addEventListener('pagehide', () => { gone = true; kill(); });

  // ---------------------------------------------------------------- becoming the host
  function attempt(seed) {
    if (gone) return;
    kill();
    status(false, 'connecting…');
    peer = new Peer(hostId, peerCfg);
    const mine = peer;
    peer.on('open', () => { if (peer === mine) becomeHost(seed); });
    peer.on('error', e => {
      if (peer !== mine) return;
      if (e.type === 'unavailable-id') { kill(); joinAsClient(seed); }
      else retryLater(seed, e);
    });
  }
  function retryLater(seed, e) {
    kill(); role = null; tries++;
    status(false, 'can’t reach the matchmaking server, retrying…');
    setTimeout(() => attempt(seed), Math.min(8000, 800 * tries));
  }
  function loadSaved() { try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { return []; } }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(storeKey, JSON.stringify(H.objs)); } catch {} }, 1500);
  }

  function becomeHost(seed) {
    role = 'host'; tries = 0;
    const objs = (seed && seed.length ? seed : loadSaved()).map(cleanObj).filter(Boolean);
    H = { objs, users: new Map(), conns: new Map(), nextId: 2, buckets: new Map() };
    me.id = 1;
    H.users.set(1, { id: 1, name: me.name, color: me.color });
    onMessage({ t: 'init', you: 1, objs: H.objs, users: [...H.users.values()] });
    status(true, 'You are hosting this board. It stays online while at least one of you has it open.');
    peer.on('connection', conn => {
      conn.on('data', d => fromClient(conn, d));
      conn.on('close', () => drop(conn));
      conn.on('error', () => drop(conn));
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
    peer.on('error', () => {});
  }

  function bcast(msg, except) { for (const [uid, c] of H.conns) if (uid !== except && c.open) { try { c.send(msg); } catch {} } }
  function drop(conn) {
    if (!H || !conn.uid || !H.conns.has(conn.uid)) return;
    const uid = conn.uid;
    H.conns.delete(uid); H.users.delete(uid); H.buckets.delete(uid);
    const m = { t: 'leave', id: uid };
    bcast(m); onMessage(m);
  }
  function allow(uid) {
    const now = performance.now();
    const b = H.buckets.get(uid) || { t: 300, at: now };
    b.t = Math.min(300, b.t + (now - b.at) / 1000 * 150); b.at = now;
    H.buckets.set(uid, b);
    if (b.t < 1) return false;
    b.t -= 1; return true;
  }
  function fromClient(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (!conn.uid) {
      if (d.t !== 'hello') return;
      if (H.users.size >= MAX_USERS) { try { conn.send({ t: 'full' }); } catch {} setTimeout(() => conn.close(), 300); return; }
      const uid = H.nextId++;
      conn.uid = uid;
      const u = { id: uid, name: safeName(d.name), color: safeColor(d.color) };
      H.users.set(uid, u); H.conns.set(uid, conn);
      conn.send({ t: 'init', you: uid, objs: H.objs, users: [...H.users.values()] });
      const j = { t: 'join', u }; bcast(j, uid); onMessage(j);
      return;
    }
    if (allow(conn.uid)) apply(conn.uid, d);
  }

  // The same edit rules as the Rust server: validate, change the board, relay to everyone else.
  function apply(uid, m) {
    switch (m.t) {
      case 'cur': if (num(m.x) && num(m.y)) { const o = { t: 'cur', from: uid, x: m.x, y: m.y }; bcast(o, uid); if (uid !== 1) onMessage(o); } break;
      case 'add': {
        const o = cleanObj(m.o);
        if (!o || H.objs.length >= MAX_OBJS || H.objs.some(x => x.id === o.id)) return;
        H.objs.push(o); out({ t: 'add', from: uid, o }, uid); break;
      }
      case 'upd': {
        const o = H.objs.find(x => x.id === m.id);
        const p = m.p;
        if (!o || !p || typeof p !== 'object' || Array.isArray(p) || 'id' in p || 'type' in p || !checkFields(p, o.type)) return;
        Object.assign(o, p); out({ t: 'upd', from: uid, id: m.id, p }, uid); break;
      }
      case 'del': {
        const n = H.objs.length;
        H.objs = H.objs.filter(x => x.id !== m.id);
        if (H.objs.length !== n) out({ t: 'del', from: uid, id: m.id }, uid);
        break;
      }
      case 'clear': H.objs = []; out({ t: 'clear', from: uid }, uid); break;
    }
  }
  function out(msg, uid) { bcast(msg, uid); if (uid !== 1) onMessage(msg); scheduleSave(); }

  // ---------------------------------------------------------------- joining someone else's board
  function joinAsClient(seed) {
    if (gone) return;
    role = 'client'; status(false, 'joining…');
    peer = new Peer(undefined, peerCfg);
    const mine = peer;
    let opened = false;
    const lost = () => {
      if (peer !== mine) return;
      kill(); role = null; tries++;
      status(false, 'host left, taking over…');
      // Whoever claims the board code first becomes the new host, seeded from their own copy.
      setTimeout(() => attempt(getObjs()), 250 + Math.random() * 1200 + Math.min(4000, tries * 500));
    };
    peer.on('error', e => { if (e.type === 'peer-unavailable' || e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') lost(); });
    peer.on('open', () => {
      if (peer !== mine) return;
      hostConn = peer.connect(hostId, { reliable: true });
      const c = hostConn;
      c.on('open', () => { opened = true; tries = 0; c.send({ t: 'hello', name: me.name, color: me.color }); });
      c.on('data', d => fromHost(d));
      c.on('close', lost);
      c.on('error', lost);
      setTimeout(() => { if (!opened) lost(); }, 9000);
    });
  }
  function fromHost(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'full': onStatus(false, 'This board is full.', role); break;
      case 'init':
        d.objs = (Array.isArray(d.objs) ? d.objs : []).map(cleanObj).filter(Boolean);
        d.users = (Array.isArray(d.users) ? d.users : []).map(u => ({ id: u.id, name: safeName(u.name), color: safeColor(u.color) }));
        onMessage(d); status(true, 'Connected to the board host.'); break;
      case 'join': d.u = { id: d.u.id, name: safeName(d.u.name), color: safeColor(d.u.color) }; onMessage(d); break;
      case 'add': if (cleanObj(d.o)) onMessage(d); break;
      case 'upd': if (d.p && typeof d.p === 'object' && !('id' in d.p) && !('type' in d.p) && checkFields(d.p, 'stroke')) onMessage(d); break;
      case 'leave': case 'del': case 'clear': case 'cur': onMessage(d); break;
    }
  }

  attempt(null);
  return {
    send(m) {
      if (role === 'host' && H) apply(1, m);
      else if (hostConn && hostConn.open) { try { hostConn.send(m); } catch {} }
    },
    role: () => role,
  };
}

window.ScrawlP2P = { start, cleanObj };
})();
