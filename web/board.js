(() => {
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const $ = s => document.querySelector(s);
const FONT = '"Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const room = decodeURIComponent(location.pathname.split('/').pop());
const COLORS = ['#17171c', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#d6336c', '#868e96'];
const USER_COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#d6336c'];
const SIZES = [2.5, 5, 10];
const TEXT_SIZES = [20, 28, 44];
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => (b % 36).toString(36)).join('');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const IC = {
  select: '<path d="M5 3l14 7-6 2-2 6z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  hl: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4"/>',
  eraser: '<path d="M20 20H9l-5.5-5.5a2 2 0 010-2.8l9-9a2 2 0 012.8 0l5.2 5.2a2 2 0 010 2.8L13 20"/><path d="M7 11l6 6"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M9 5h10v10"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  ellipse: '<circle cx="12" cy="12" r="8"/>',
  text: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  note: '<path d="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V9z"/><path d="M15 3v6h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18 14 14 0 010-18z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  fit: '<path d="M3 9V3h6"/><path d="M21 9V3h-6"/><path d="M3 15v6h6"/><path d="M21 15v6h-6"/>',
};
const icon = n => `<svg class="i" viewBox="0 0 24 24">${IC[n]}</svg>`;

// ---------------------------------------------------------------- state
const stage = $('#stage'), svg = $('#svg'), world = $('#world'), objsG = $('#objs'), overlay = $('#overlay'), cursorsG = $('#cursors');
const selG = document.createElementNS(NS, 'g'), prevG = document.createElementNS(NS, 'g');
overlay.append(prevG, selG);
let cam = { x: innerWidth / 2, y: innerHeight / 2, k: 1 };
const objs = new Map(), els = new Map(), users = new Map(), cursors = new Map();
let ws = null, me = { id: null, name: 'Guest', color: USER_COLORS[0] }, online = false, firstInit = true, retry = 0;
let tool = 'pen', color = COLORS[0], sizeIdx = 1, sel = null, drag = null, spaceDown = false, editing = null;
const pointers = new Map();
let pinch = null;
const undoSt = [], redoSt = [];

const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const toast = (() => { let t; return msg => { const e = $('#toast'); e.textContent = msg; e.classList.add('show'); clearTimeout(t); t = setTimeout(() => e.classList.remove('show'), 2800); }; })();

// ---------------------------------------------------------------- text measuring
const mctx = document.createElement('canvas').getContext('2d');
function measure(str, size) { mctx.font = `${size}px ${FONT}`; return mctx.measureText(str).width; }
function wrap(text, maxW, size) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (line && measure(t, size) > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const NOTE_FS = 18, NOTE_PAD = 12;

// ---------------------------------------------------------------- geometry
function bbox(o) {
  switch (o.type) {
    case 'stroke': {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < o.pts.length; i += 2) { x0 = Math.min(x0, o.pts[i]); x1 = Math.max(x1, o.pts[i]); y0 = Math.min(y0, o.pts[i + 1]); y1 = Math.max(y1, o.pts[i + 1]); }
      const r = (o.hl ? o.w * 3.5 : o.w) / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
    }
    case 'shape': { const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2); return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) }; }
    case 'text': {
      const size = o.size || 24, lines = (o.s || '').split('\n');
      return { x: o.x, y: o.y, w: Math.max(20, ...lines.map(l => measure(l, size))), h: lines.length * size * 1.25 };
    }
    default: return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}
function moved(o, dx, dy, base) {
  base = base || o;
  switch (o.type) {
    case 'stroke': return { pts: base.pts.map((v, i) => v + (i % 2 ? dy : dx)) };
    case 'shape': return { x1: base.x1 + dx, y1: base.y1 + dy, x2: base.x2 + dx, y2: base.y2 + dy };
    default: return { x: base.x + dx, y: base.y + dy };
  }
}

// ---------------------------------------------------------------- rendering
function pathD(p) {
  if (p.length <= 2) return `M${p[0]} ${p[1]}l.01 0`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) d += `Q${p[i]} ${p[i + 1]} ${(p[i] + p[i + 2]) / 2} ${(p[i + 1] + p[i + 3]) / 2}`;
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}
const HIT = 'rgba(0,0,0,0)';
function fill(g, o) {
  g.textContent = '';
  switch (o.type) {
    case 'stroke': {
      const d = pathD(o.pts), w = o.hl ? o.w * 3.5 : o.w;
      mk('path', { d, fill: 'none', stroke: o.c, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': o.hl ? .38 : 1 }, g);
      mk('path', { d, fill: 'none', stroke: HIT, 'stroke-width': Math.max(w + 6, 14), 'stroke-linecap': 'round', 'pointer-events': 'stroke' }, g);
      break;
    }
    case 'shape': {
      const a = { fill: 'none', stroke: o.c, 'stroke-width': o.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      const hit = { fill: 'none', stroke: HIT, 'stroke-width': Math.max(o.w + 6, 14), 'pointer-events': 'stroke' };
      const b = bbox(o);
      for (const st of [a, hit]) {
        if (o.kind === 'rect') mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, ...st }, g);
        else if (o.kind === 'ellipse') mk('ellipse', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, ...st }, g);
        else {
          let d = `M${o.x1} ${o.y1}L${o.x2} ${o.y2}`;
          if (o.kind === 'arrow' && st === a) {
            const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), len = Math.max(14, o.w * 4);
            d += `M${o.x2 - len * Math.cos(ang - .45)} ${o.y2 - len * Math.sin(ang - .45)}L${o.x2} ${o.y2}L${o.x2 - len * Math.cos(ang + .45)} ${o.y2 - len * Math.sin(ang + .45)}`;
          }
          mk('path', { d, ...st }, g);
        }
      }
      break;
    }
    case 'text': {
      const size = o.size || 24, b = bbox(o);
      mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: HIT, 'pointer-events': 'all' }, g);
      const t = mk('text', { fill: o.c, 'font-size': size, 'font-family': FONT }, g);
      (o.s || '').split('\n').forEach((l, i) => { const ts = mk('tspan', { x: o.x, y: o.y + size * 1.02 + i * size * 1.25 }, t); ts.textContent = l || ' '; });
      break;
    }
    case 'note': {
      mk('rect', { x: o.x + 2, y: o.y + 4, width: o.w, height: o.h, rx: 6, fill: 'rgba(0,0,0,.12)' }, g);
      mk('rect', { x: o.x, y: o.y, width: o.w, height: o.h, rx: 6, fill: o.bg || '#ffec99' }, g);
      const lines = wrap(o.s || '', o.w - NOTE_PAD * 2, NOTE_FS).slice(0, Math.max(1, Math.floor((o.h - NOTE_PAD * 2) / (NOTE_FS * 1.25))));
      const t = mk('text', { fill: '#17171c', 'font-size': NOTE_FS, 'font-family': FONT }, g);
      lines.forEach((l, i) => { const ts = mk('tspan', { x: o.x + NOTE_PAD, y: o.y + NOTE_PAD + NOTE_FS * 1.02 + i * NOTE_FS * 1.25 }, t); ts.textContent = l || ' '; });
      break;
    }
    case 'image': {
      const im = mk('image', { x: o.x, y: o.y, width: o.w, height: o.h, preserveAspectRatio: 'none' }, g);
      im.setAttribute('href', o.src);
      mk('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'none', 'pointer-events': 'all' }, g);
      break;
    }
  }
}
function build(o) { const g = document.createElementNS(NS, 'g'); g.dataset.id = o.id; fill(g, o); return g; }

// ---------------------------------------------------------------- local + remote application
function addLocal(o) { objs.set(o.id, o); const g = build(o); objsG.appendChild(g); els.set(o.id, g); }
function updLocal(id, p) {
  const o = objs.get(id); if (!o) return;
  Object.assign(o, p);
  fill(els.get(id), o);
  if (sel === id) renderSel();
}
function delLocal(id) {
  objs.delete(id); const g = els.get(id); if (g) g.remove(); els.delete(id);
  if (sel === id) select(null);
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function applyItem(it, undo) {
  switch (it.k) {
    case 'add': if (undo) { delLocal(it.o.id); send({ t: 'del', id: it.o.id }); } else { addLocal(structuredClone(it.o)); send({ t: 'add', o: it.o }); } break;
    case 'del': if (undo) { addLocal(structuredClone(it.o)); send({ t: 'add', o: it.o }); } else { delLocal(it.o.id); send({ t: 'del', id: it.o.id }); } break;
    case 'upd': { const p = undo ? it.before : it.after; updLocal(it.id, p); send({ t: 'upd', id: it.id, p }); break; }
    case 'batch': for (const x of (undo ? [...it.items].reverse() : it.items)) applyItem(x, undo); break;
  }
}
function record(it) { undoSt.push(it); if (undoSt.length > 200) undoSt.shift(); redoSt.length = 0; syncUndo(); }
function doAdd(o) { const it = { k: 'add', o }; applyItem(it, false); record(it); }
function doDel(id) { const o = objs.get(id); if (!o) return; const it = { k: 'del', o: structuredClone(o) }; applyItem(it, false); record(it); }
function doUpd(id, p) { const o = objs.get(id); if (!o) return; const before = {}; for (const k in p) before[k] = structuredClone(o[k]); const it = { k: 'upd', id, before, after: p }; applyItem(it, false); record(it); }
function undo() { const it = undoSt.pop(); if (!it) return; applyItem(it, true); redoSt.push(it); syncUndo(); }
function redo() { const it = redoSt.pop(); if (!it) return; applyItem(it, false); undoSt.push(it); syncUndo(); }
function syncUndo() { const u = $('#b-undo'), r = $('#b-redo'); if (u) u.disabled = !undoSt.length; if (r) r.disabled = !redoSt.length; }

// ---------------------------------------------------------------- camera
function applyCam() {
  world.setAttribute('transform', `translate(${cam.x} ${cam.y}) scale(${cam.k})`);
  const g = 28 * cam.k;
  stage.style.backgroundSize = `${g}px ${g}px`;
  stage.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  $('#zoomv').textContent = Math.round(cam.k * 100) + '%';
  renderSel();
  for (const [id, c] of cursors) placeCursor(id, c);
}
const toWorld = (sx, sy) => ({ x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k });
function zoomAt(sx, sy, k2) {
  k2 = clamp(k2, .1, 8);
  const w = toWorld(sx, sy);
  cam.k = k2; cam.x = sx - w.x * k2; cam.y = sy - w.y * k2;
  applyCam();
}
function fitAll() {
  if (!objs.size) { cam = { x: innerWidth / 2, y: innerHeight / 2, k: 1 }; applyCam(); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const o of objs.values()) { const b = bbox(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const pad = 90, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
  const k = clamp(Math.min(innerWidth / w, innerHeight / h), .1, 1.5);
  cam.k = k; cam.x = innerWidth / 2 - (x0 + x1) / 2 * k; cam.y = innerHeight / 2 - (y0 + y1) / 2 * k;
  applyCam();
}

// ---------------------------------------------------------------- selection
function select(id) { sel = id; renderSel(); }
function renderSel() {
  selG.textContent = '';
  const o = sel && objs.get(sel);
  if (!o || tool !== 'select') return;
  const k = cam.k, b = bbox(o), pad = 6 / k;
  mk('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: 'none', stroke: '#7c5cff', 'stroke-width': 1.5 / k, 'stroke-dasharray': `${5 / k} ${4 / k}`, 'pointer-events': 'none' }, selG);
  const handles = o.type === 'shape' ? [['p1', o.x1, o.y1], ['p2', o.x2, o.y2]] : (o.type === 'image' || o.type === 'note') ? [['br', o.x + o.w, o.y + o.h]] : [];
  for (const [h, x, y] of handles) mk('rect', { x: x - 5 / k, y: y - 5 / k, width: 10 / k, height: 10 / k, rx: 2 / k, fill: '#fff', stroke: '#7c5cff', 'stroke-width': 1.5 / k, 'data-h': h, style: 'cursor:nwse-resize' }, selG);
}

// ---------------------------------------------------------------- text editing
function openEditor(spec) {
  commitEditor();
  const k = cam.k, isNote = spec.type === 'note', fs = isNote ? NOTE_FS : (spec.size || 24);
  const ta = document.createElement('textarea');
  ta.id = 'editor'; ta.spellcheck = false; ta.value = spec.s || '';
  Object.assign(ta.style, { left: cam.x + spec.x * k + 'px', top: cam.y + spec.y * k + 'px', fontSize: fs * k + 'px', color: isNote ? '#17171c' : spec.c });
  if (isNote) Object.assign(ta.style, { width: spec.w * k + 'px', height: spec.h * k + 'px', padding: NOTE_PAD * k + 'px', background: spec.bg, border: '1.5px dashed #7c5cff' });
  const fit = () => {
    if (isNote) return;
    const lines = ta.value.split('\n');
    ta.style.width = Math.max(140, Math.max(...lines.map(l => measure(l, fs))) * k + 40) + 'px';
    ta.style.height = lines.length * fs * 1.25 * k + 6 + 'px';
  };
  document.body.appendChild(ta);
  editing = { spec, ta };
  if (spec.id) els.get(spec.id).style.display = 'none';
  fit(); ta.focus(); ta.select();
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitEditor(); } });
  ta.addEventListener('blur', () => commitEditor());
}
function commitEditor() {
  if (!editing) return;
  const { spec, ta } = editing; editing = null;
  const s = ta.value; ta.remove();
  if (spec.id) {
    const g = els.get(spec.id); if (g) g.style.display = '';
    if (!objs.has(spec.id)) return;
    if (spec.type === 'text' && !s.trim()) doDel(spec.id); else if (s !== spec.s) doUpd(spec.id, { s });
  } else if (s.trim()) {
    const o = { id: rid(), type: spec.type, x: spec.x, y: spec.y, s, c: spec.c };
    if (spec.type === 'text') o.size = spec.size; else { o.w = spec.w; o.h = spec.h; o.bg = spec.bg; }
    doAdd(o);
  }
}
function mix(hex, t) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * t)); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); }

// ---------------------------------------------------------------- pointer handling
function worldOf(e) { const r = stage.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); }
const objAt = (x, y) => { const el = document.elementFromPoint(x, y); const g = el && el.closest && el.closest('#objs > g'); return g ? g.dataset.id : null; };
let lastCur = 0, lastUpd = 0;

stage.addEventListener('pointerdown', e => {
  if (e.target.closest('#editor')) return;
  commitEditor();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stage.setPointerCapture(e.pointerId);
  if (pointers.size === 2) { startPinch(); return; }
  if (pointers.size > 2) return;
  const panning = e.button === 1 || spaceDown;
  if (e.button !== 0 && !panning) return;
  if (panning) { drag = { k: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; stage.classList.add('panning'); return; }
  if (!online) { toast('Reconnecting… your edits cannot be sent right now.'); return; }
  const p = worldOf(e), w = SIZES[sizeIdx];
  switch (tool) {
    case 'pen': case 'hl':
      drag = { k: 'draw', tmp: { id: 'tmp', type: 'stroke', pts: [p.x, p.y], c: color, w, hl: tool === 'hl' }, g: mk('g', {}, prevG) };
      fill(drag.g, drag.tmp); break;
    case 'line': case 'arrow': case 'rect': case 'ellipse':
      drag = { k: 'shape', tmp: { id: 'tmp', type: 'shape', kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: color, w }, g: mk('g', {}, prevG) }; break;
    case 'eraser': drag = { k: 'erase', items: [] }; eraseAt(e.clientX, e.clientY); break;
    case 'text': openEditor({ type: 'text', x: p.x, y: p.y - TEXT_SIZES[sizeIdx] / 2, c: color, size: TEXT_SIZES[sizeIdx] }); e.preventDefault(); break;
    case 'note': openEditor({ type: 'note', x: p.x - 100, y: p.y - 100, w: 200, h: 200, bg: mix(color === COLORS[0] ? '#f2b705' : color, .72), c: '#17171c' }); e.preventDefault(); break;
    case 'select': {
      const h = e.target.dataset && e.target.dataset.h;
      if (h && sel) { const o = objs.get(sel); drag = { k: 'resize', h, id: sel, base: structuredClone(o) }; break; }
      const id = objAt(e.clientX, e.clientY);
      if (id) { select(id); drag = { k: 'move', id, p0: p, base: structuredClone(objs.get(id)) }; }
      else { select(null); drag = { k: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; stage.classList.add('panning'); }
    }
  }
});

stage.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const now = performance.now();
  if (online && now - lastCur > 40) { const p = worldOf(e); send({ t: 'cur', x: Math.round(p.x), y: Math.round(p.y) }); lastCur = now; }
  if (pinch && pointers.size === 2) { updatePinch(); return; }
  if (!drag) return;
  const p = worldOf(e);
  switch (drag.k) {
    case 'pan': cam.x = drag.cx + e.clientX - drag.sx; cam.y = drag.cy + e.clientY - drag.sy; applyCam(); break;
    case 'draw': {
      const pts = drag.tmp.pts, n = pts.length;
      if (Math.hypot(p.x - pts[n - 2], p.y - pts[n - 1]) * cam.k > 1.5) { pts.push(p.x, p.y); fill(drag.g, drag.tmp); }
      break;
    }
    case 'shape': drag.tmp.x2 = p.x; drag.tmp.y2 = p.y; fill(drag.g, drag.tmp); break;
    case 'erase': eraseAt(e.clientX, e.clientY); break;
    case 'move': {
      const patch = moved(drag.base, p.x - drag.p0.x, p.y - drag.p0.y);
      updLocal(drag.id, patch);
      if (now - lastUpd > 45) { send({ t: 'upd', id: drag.id, p: patch }); lastUpd = now; }
      break;
    }
    case 'resize': {
      const b = drag.base; let patch;
      if (drag.h === 'p1') patch = { x1: p.x, y1: p.y };
      else if (drag.h === 'p2') patch = { x2: p.x, y2: p.y };
      else if (b.type === 'image') { const w = Math.max(24, p.x - b.x); patch = { w, h: w * b.h / b.w }; }
      else patch = { w: Math.max(80, p.x - b.x), h: Math.max(60, p.y - b.y) };
      updLocal(drag.id, patch);
      if (now - lastUpd > 45) { send({ t: 'upd', id: drag.id, p: patch }); lastUpd = now; }
      break;
    }
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  const d = drag; drag = null;
  stage.classList.remove('panning');
  if (!d) return;
  switch (d.k) {
    case 'draw': {
      d.g.remove();
      if (d.tmp.pts.length === 2) d.tmp.pts.push(d.tmp.pts[0], d.tmp.pts[1]);
      d.tmp.id = rid(); doAdd(d.tmp); break;
    }
    case 'shape': {
      d.g.remove();
      const t = d.tmp;
      if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) * cam.k > 4) { t.id = rid(); doAdd(t); }
      break;
    }
    case 'erase': if (d.items.length) record({ k: 'batch', items: d.items }); break;
    case 'move': case 'resize': {
      const o = objs.get(d.id); if (!o) break;
      const keys = d.k === 'move' ? Object.keys(moved(o, 0, 0)) : (d.h === 'p1' ? ['x1', 'y1'] : d.h === 'p2' ? ['x2', 'y2'] : ['w', 'h']);
      const before = {}, after = {}; let changed = false;
      for (const k of keys) { before[k] = d.base[k]; after[k] = o[k]; if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed = true; }
      if (changed) { send({ t: 'upd', id: d.id, p: after }); record({ k: 'upd', id: d.id, before, after }); }
      break;
    }
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('dblclick', e => {
  if (tool !== 'select' || !online) return;
  const id = objAt(e.clientX, e.clientY), o = id && objs.get(id);
  if (o && (o.type === 'text' || o.type === 'note')) openEditor({ ...o });
});
stage.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0016)));
}, { passive: false });

function eraseAt(cx, cy) {
  const id = objAt(cx, cy);
  if (id && drag && drag.k === 'erase') { const o = objs.get(id); const it = { k: 'del', o: structuredClone(o) }; applyItem(it, false); drag.items.push(it); }
}
function startPinch() {
  if (drag) { if (drag.g) drag.g.remove(); drag = null; stage.classList.remove('panning'); }
  const [a, b] = [...pointers.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}
function updatePinch() {
  const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  cam.x += mx - pinch.mx; cam.y += my - pinch.my;
  zoomAt(mx, my, cam.k * d / pinch.d);
  pinch = { d, mx, my };
}

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { if (!spaceDown) { spaceDown = true; stage.classList.add('pan'); } e.preventDefault(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && online) { doDel(sel); return; }
  if (e.key === 'Escape') { select(null); setTool('select'); return; }
  const map = { v: 'select', p: 'pen', h: 'hl', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', n: 'note' };
  if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
});
addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('pan'); } });

// ---------------------------------------------------------------- UI
const TOOLS = [['select', 'Select (V)'], ['pen', 'Pen (P)'], ['hl', 'Highlighter (H)'], ['eraser', 'Eraser (E)'], null, ['line', 'Line (L)'], ['arrow', 'Arrow (A)'], ['rect', 'Rectangle (R)'], ['ellipse', 'Ellipse (O)'], null, ['text', 'Text (T)'], ['note', 'Sticky note (N)']];
const tools = $('#tools');
for (const t of TOOLS) {
  if (!t) { tools.appendChild(Object.assign(document.createElement('div'), { className: 'sep' })); continue; }
  const b = document.createElement('button'); b.className = 'tb'; b.dataset.tool = t[0]; b.title = t[1]; b.innerHTML = icon(t[0]); b.onclick = () => setTool(t[0]); tools.appendChild(b);
}
function actionBtn(parent, ic, title, fn, id) { const b = document.createElement('button'); b.className = 'tb'; b.title = title; b.innerHTML = icon(ic); b.onclick = fn; if (id) b.id = id; parent.appendChild(b); return b; }
tools.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
actionBtn(tools, 'image', 'Add image or GIF from your computer', () => $('#file').click());
actionBtn(tools, 'globe', 'Add image or GIF from a link', addFromUrlDialog);
tools.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
actionBtn(tools, 'undo', 'Undo (Ctrl+Z)', undo, 'b-undo');
actionBtn(tools, 'redo', 'Redo (Ctrl+Shift+Z)', redo, 'b-redo');

const right = $('#right');
actionBtn(right, 'download', 'Export as PNG', exportPng);
actionBtn(right, 'trash', 'Clear the board', async () => { if (await modal({ title: 'Clear the whole board?', text: 'This removes everything for everyone and cannot be undone.', ok: 'Clear board' })) { send({ t: 'clear' }); for (const id of [...objs.keys()]) delLocal(id); undoSt.length = redoSt.length = 0; syncUndo(); } });
const sb = document.createElement('button'); sb.className = 'btn accent'; sb.style.cssText = 'padding:8px 14px;border-radius:9px'; sb.innerHTML = icon('link') + 'Share';
sb.onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied. Anyone with it can draw on this board.'); } catch { modal({ title: 'Share this link', text: location.href, ok: 'Close', cancel: null }); } };
right.appendChild(sb);

const zoom = $('#zoom');
actionBtn(zoom, 'minus', 'Zoom out', () => zoomAt(innerWidth / 2, innerHeight / 2, cam.k / 1.25));
zoom.insertAdjacentHTML('beforeend', '<span id="zoomv">100%</span>');
actionBtn(zoom, 'plus', 'Zoom in', () => zoomAt(innerWidth / 2, innerHeight / 2, cam.k * 1.25));
actionBtn(zoom, 'fit', 'Fit everything', fitAll);

const sw = $('#sw');
COLORS.forEach(c => { const b = document.createElement('button'); b.style.background = c; b.title = c; b.onclick = () => { color = c; syncStyle(); if (sel && online) { const o = objs.get(sel); if (o.type === 'note') doUpd(sel, { bg: mix(c === COLORS[0] ? '#f2b705' : c, .72) }); else if (o.type !== 'image') doUpd(sel, { c }); } }; sw.appendChild(b); });
const wd = $('#wd');
SIZES.forEach((s, i) => { const b = document.createElement('button'); b.title = ['Thin', 'Medium', 'Thick'][i]; b.innerHTML = `<i style="height:${[2, 4, 7][i]}px"></i>`; b.onclick = () => { sizeIdx = i; syncStyle(); if (sel && online) { const o = objs.get(sel); if (o.type === 'stroke' || o.type === 'shape') doUpd(sel, { w: SIZES[i] }); else if (o.type === 'text') doUpd(sel, { size: TEXT_SIZES[i] }); } }; wd.appendChild(b); });
function syncStyle() {
  [...sw.children].forEach((b, i) => b.classList.toggle('on', COLORS[i] === color));
  [...wd.children].forEach((b, i) => b.classList.toggle('on', i === sizeIdx));
}
function setTool(t) {
  commitEditor();
  tool = t; if (t !== 'select') select(null);
  [...tools.querySelectorAll('[data-tool]')].forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  stage.classList.toggle('sel', t === 'select');
  $('#style').style.display = t === 'select' && !sel ? 'none' : '';
  renderSel();
}
const _select = select;
select = function (id) { _select(id); $('#style').style.display = tool === 'select' && !id ? 'none' : ''; };

function modal({ title, text, input, ok = 'OK', cancel = 'Cancel', value = '', placeholder = '' }) {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="card"><h3></h3><p></p><input class="txt" hidden><div class="row"><button class="btn accent" data-ok></button><button class="btn ghost" data-c></button></div></div>';
    m.querySelector('h3').textContent = title; m.querySelector('p').textContent = text || '';
    const inp = m.querySelector('input'); if (input) { inp.hidden = false; inp.value = value; inp.placeholder = placeholder; }
    m.querySelector('[data-ok]').textContent = ok;
    const c = m.querySelector('[data-c]'); if (cancel) c.textContent = cancel; else c.remove();
    const done = v => { m.remove(); res(v); };
    m.querySelector('[data-ok]').onclick = () => done(input ? inp.value.trim() : true);
    c.onclick = () => done(null);
    m.addEventListener('keydown', e => { if (e.key === 'Enter') done(input ? inp.value.trim() : true); if (e.key === 'Escape') done(null); });
    m.addEventListener('pointerdown', e => { if (e.target === m) done(null); });
    document.body.appendChild(m); (input ? inp : m.querySelector('[data-ok]')).focus();
  });
}

// people
function renderPeople() {
  const box = $('#people'); box.textContent = '';
  for (const [id, u] of users) {
    const a = document.createElement('div'); a.className = 'av'; a.style.background = u.color; a.textContent = (u.name || '?')[0].toUpperCase(); a.title = u.name + (id === me.id ? ' (you, click to rename)' : '');
    if (id === me.id) { a.style.cursor = 'pointer'; a.onclick = async () => { const n = await modal({ title: 'Your name', input: true, value: me.name, ok: 'Save' }); if (n) { localStorage.setItem('scrawl.name', n.slice(0, 24)); location.reload(); } }; }
    box.appendChild(a);
  }
}
function placeCursor(id, c) {
  let g = c.g;
  if (!g) {
    const u = users.get(id) || { name: '', color: '#e03131' };
    g = c.g = mk('g', { class: 'cursor', 'pointer-events': 'none' }, cursorsG);
    mk('path', { d: 'M0 0L0 17L4.5 13L8 20L10.5 19L7 12L13 12Z', fill: u.color, stroke: '#fff', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, g);
    const t = mk('text', { x: 14, y: 26, fill: u.color }, g); t.textContent = u.name;
  }
  g.setAttribute('transform', `translate(${c.x} ${c.y}) scale(${1 / cam.k})`);
}

// ---------------------------------------------------------------- images
async function uploadFile(file) {
  if (!file.type.startsWith('image/')) { toast('Only images and GIFs can be added.'); return null; }
  if (file.size > 10 * 1024 * 1024) { toast('That file is over the 10 MB limit.'); return null; }
  const r = await fetch('/api/upload', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
  if (!r.ok) { toast(await r.text() || 'Upload failed'); return null; }
  return (await r.json()).url;
}
function loadDims(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res([i.naturalWidth || 200, i.naturalHeight || 200]); i.onerror = () => rej(new Error('not an image')); i.src = src; }); }
async function placeImage(src, at) {
  if (!online) { toast('Reconnecting… try again in a moment.'); return; }
  let w, h;
  try { [w, h] = await loadDims(src); } catch { toast("That link isn't a direct image or GIF."); return; }
  const s = Math.min(1, 480 / Math.max(w, h)); w *= s; h *= s;
  const c = at || toWorld(innerWidth / 2, innerHeight / 2);
  doAdd({ id: rid(), type: 'image', x: c.x - w / 2, y: c.y - h / 2, w, h, src });
}
async function addFiles(files, at) {
  for (const f of files) { const url = await uploadFile(f); if (url) await placeImage(url, at); }
}
async function addFromUrlDialog() {
  const u = await modal({ title: 'Add an image or GIF from a link', text: 'Paste the direct link to an image or GIF (it should end in .gif, .png, .jpg or .webp).', input: true, ok: 'Add', placeholder: 'https://…' });
  if (u) { if (/^https?:\/\//i.test(u)) placeImage(u); else toast('The link must start with http:// or https://'); }
}
$('#file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
const dropEl = $('#drop');
let dragDepth = 0;
addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; dropEl.classList.add('show'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropEl.classList.remove('show'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; dropEl.classList.remove('show');
  const at = toWorld(e.clientX, e.clientY);
  if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], at);
  else { const u = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim(); if (/^https?:\/\/\S+$/i.test(u)) placeImage(u, at); }
});
addEventListener('paste', e => {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const files = [...(e.clipboardData.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  const t = (e.clipboardData.getData('text/plain') || '').trim();
  if (!t) return;
  if (/^https?:\/\/\S+$/i.test(t)) placeImage(t);
  else if (online && t.length < 5000) { const c = toWorld(innerWidth / 2, innerHeight / 2); doAdd({ id: rid(), type: 'text', x: c.x, y: c.y, s: t, c: color, size: TEXT_SIZES[sizeIdx] }); }
});

// ---------------------------------------------------------------- export
async function exportPng() {
  if (!objs.size) { toast('The board is empty.'); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const o of objs.values()) { const b = bbox(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const pad = 40; x0 -= pad; y0 -= pad; const w = x1 - x0 + pad, h = y1 - y0 + pad;
  const holder = document.createElementNS(NS, 'g');
  for (const o of objs.values()) holder.appendChild(build(o));
  for (const im of holder.querySelectorAll('image')) {
    try { const b = await (await fetch(im.getAttribute('href'))).blob(); const d = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); im.setAttribute('href', d); } catch { im.remove(); }
  }
  const body = new XMLSerializer().serializeToString(holder);
  const scale = Math.min(2, 4000 / Math.max(w, h));
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w * scale}" height="${h * scale}"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#f6f4ee"/>${body}</svg>`;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; c.getContext('2d').drawImage(img, 0, 0);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `scrawl-${room}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
  };
  img.onerror = () => toast('Export failed.');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}

// ---------------------------------------------------------------- network
function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(room)}?name=${encodeURIComponent(me.name)}&color=${encodeURIComponent(me.color)}`;
  ws = new WebSocket(url);
  ws.onopen = () => { online = true; retry = 0; $('#dot').className = 'ok'; $('#dot').title = 'connected'; };
  ws.onclose = () => { online = false; $('#dot').className = 'bad'; $('#dot').title = 'offline, reconnecting'; retry++; setTimeout(connect, Math.min(8000, 600 * retry)); };
  ws.onmessage = ev => handle(JSON.parse(ev.data));
}
function handle(m) {
  switch (m.t) {
    case 'init': {
      for (const id of [...objs.keys()]) delLocal(id);
      cursorsG.textContent = ''; cursors.clear(); users.clear();
      me.id = m.you;
      m.objs.forEach(addLocal);
      m.users.forEach(u => users.set(u.id, u));
      undoSt.length = redoSt.length = 0; syncUndo(); renderPeople();
      if (firstInit) { firstInit = false; fitAll(); }
      break;
    }
    case 'join': users.set(m.u.id, m.u); renderPeople(); break;
    case 'leave': users.delete(m.id); { const c = cursors.get(m.id); if (c && c.g) c.g.remove(); cursors.delete(m.id); } renderPeople(); break;
    case 'add': if (m.from !== me.id && !objs.has(m.o.id)) addLocal(m.o); break;
    case 'upd': if (m.from !== me.id) updLocal(m.id, m.p); break;
    case 'del': if (m.from !== me.id) delLocal(m.id); break;
    case 'clear': if (m.from !== me.id) { for (const id of [...objs.keys()]) delLocal(id); toast('The board was cleared.'); } break;
    case 'cur': if (m.from !== me.id) { const c = cursors.get(m.from) || {}; c.x = m.x; c.y = m.y; cursors.set(m.from, c); placeCursor(m.from, c); } break;
  }
}

// ---------------------------------------------------------------- boot
(async function boot() {
  $('#bname').textContent = room;
  try { const r = JSON.parse(localStorage.getItem('scrawl.recent') || '[]').filter(x => x !== room); r.unshift(room); localStorage.setItem('scrawl.recent', JSON.stringify(r.slice(0, 8))); } catch {}
  let name = null, col = null;
  try { name = localStorage.getItem('scrawl.name'); col = localStorage.getItem('scrawl.color'); } catch {}
  if (!col) { col = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]; try { localStorage.setItem('scrawl.color', col); } catch {} }
  if (!name) {
    name = (await modal({ title: 'Welcome to Scrawl', text: 'What should others see you as?', input: true, ok: 'Join board', cancel: null, placeholder: 'Your name' })) || 'Guest';
    try { localStorage.setItem('scrawl.name', name.slice(0, 24)); } catch {}
  }
  me.name = name.slice(0, 24); me.color = col;
  syncStyle(); setTool('pen'); syncUndo(); applyCam(); connect();
  window.__scrawl = { objs, get cam() { return cam; }, get dbg() { return { tool, spaceDown, drag: drag && drag.k, sel, pointers: pointers.size }; } };
})();
addEventListener('resize', applyCam);
})();
