const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const MAX_AUDIO_CHARS = 20 * 1024 * 1024;
const MAX_TEX_CHARS = 30 * 1024 * 1024;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('COMMUNITY WORLD WebSocket server is running.');
});

const wss = new WebSocketServer({ server, maxPayload: 50 * 1024 * 1024 });
let nextId = 1;
const players = new Map();
const world = {
  objs: {},
  tex: {},
  drops: {},
  jukes: {},
  // The height/color arrays are kept authoritative and current on the server.
  // `ops` is retained for compatibility with clients from older builds.
  ops: [],
  time: 6000,
  h: new Array(257 * 257).fill(0),
  c: new Array(257 * 257).fill(0)
};

const now = () => Date.now();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except = null) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws !== except && p.ws.readyState === 1) p.ws.send(data);
  }
}
function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(data);
}
function cleanName(v) { return String(v || 'Joueur').replace(/[\u0000-\u001f]/g, '').slice(0, 16) || 'Joueur'; }
function cleanNum(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function cleanVec(v, d = [0, 0, 0]) {
  return Array.isArray(v) && v.length >= 3 ? [cleanNum(v[0], d[0]), cleanNum(v[1], d[1]), cleanNum(v[2], d[2])] : d.slice();
}
function validPos(s) { return !!s && [s.x, s.y, s.z].every(v => Number.isFinite(Number(v))); }
function sanitizeItem(it) {
  if (!it || typeof it.k !== 'string') return null;
  const out = { k: it.k.slice(0, 220), n: Math.max(1, Math.min(64, Math.floor(cleanNum(it.n, 1)))) };
  if (it.cid != null) out.cid = String(it.cid).slice(0, 120);
  if (typeof it.name === 'string') out.name = it.name.slice(0, 48);
  if (it.model && typeof it.model === 'object' && typeof it.model.mdl === 'string') {
    out.model = {
      mdl: it.model.mdl.slice(0, 220),
      fmt: ['obj', 'gltf'].includes(it.model.fmt) ? it.model.fmt : 'glb',
      s: cleanVec(it.model.s, [1, 1, 1]).map(v => clamp(v, .02, 100)),
      r: cleanVec(it.model.r, [0, 0, 0]),
      name: String(it.model.name || 'Modèle 3D').slice(0, 48),
      tex: typeof it.model.tex === 'string' ? it.model.tex.slice(0, 220) : null,
      tx: Array.isArray(it.model.tx) ? it.model.tx.slice(0, 4).map(v => cleanNum(v)) : [1, 0, 0, 0]
    };
  }
  return out;
}
function sanitizeObj(o) {
  if (!o || typeof o.type !== 'string') return null;
  const r = {
    type: o.type.slice(0, 80), p: cleanVec(o.p), r: cleanVec(o.r),
    s: cleanVec(o.s, [1, 1, 1]).map(v => clamp(v, .02, 100)),
    tx: Array.isArray(o.tx) ? o.tx.slice(0, 4).map(v => cleanNum(v)) : [1, 0, 0, 0],
    tex: typeof o.tex === 'string' ? o.tex.slice(0, 220) : null,
    mdl: typeof o.mdl === 'string' ? o.mdl.slice(0, 220) : undefined,
    fmt: ['obj', 'gltf'].includes(o.fmt) ? o.fmt : 'glb',
    name: String(o.name || '').slice(0, 48),
    anch: o.anch === 0 ? 0 : 1,
    vis: o.vis === 0 ? 0 : 1,
    tch: o.tch === 0 ? 0 : 1
  };
  if (typeof o.txt === 'string') r.txt = o.txt.slice(0, 56);
  if (typeof o.code === 'string') r.code = o.code.slice(0, 20000);
  if (Array.isArray(o.items)) r.items = o.items.slice(0, 27).map(sanitizeItem).filter(Boolean);
  if (r.type === 'model' && !r.mdl) return null;
  return r;
}
function distance(a, b) {
  if (!validPos(a) || !Array.isArray(b) || b.length < 3) return Infinity;
  return Math.hypot(a.x - b[0], a.z - b[2], (a.y || 0) - (b[1] || 0));
}

// Keep the same bilinear terrain heightmap as the browser simulation.
function terrainAt(x, z) {
  const N = 256, W = 257, O = 128;
  x += O; z += O;
  if (x < 0 || z < 0 || x >= N || z >= N) return 0;
  const i = x | 0, j = z | 0, fx = x - i, fz = z - j, H = world.h;
  const a = H[j * W + i] || 0, b = H[j * W + i + 1] || 0;
  const c = H[(j + 1) * W + i] || 0, d = H[(j + 1) * W + i + 1] || 0;
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function applyTerrainOp(o) {
  const N = 256, W = 257, O = 128, h = world.h, c = world.c;
  const r = Math.max(.01, o.r);
  const src = o.k === 'smooth' ? h.slice() : null;
  const q = (i, j) => src[Math.min(N, Math.max(0, j)) * W + Math.min(N, Math.max(0, i))] || 0;
  for (let j = Math.max(0, Math.floor(o.z + O - r)); j <= Math.min(N, Math.ceil(o.z + O + r)); j++) {
    for (let i = Math.max(0, Math.floor(o.x + O - r)); i <= Math.min(N, Math.ceil(o.x + O + r)); i++) {
      const d = Math.hypot(i - O - o.x, j - O - o.z);
      if (d > r) continue;
      let f = 1 - d / r; f = f * f * (3 - 2 * f);
      const p = j * W + i;
      if (o.k === 'raise') h[p] += o.s * f * .4;
      else if (o.k === 'lower') h[p] -= o.s * f * .4;
      else if (o.k === 'flatten') h[p] += (o.y - h[p]) * Math.min(1, f * o.s * .8);
      else if (o.k === 'smooth') h[p] += ((q(i - 1, j) + q(i + 1, j) + q(i, j - 1) + q(i, j + 1)) / 4 - src[p]) * Math.min(1, f * o.s);
      else if (o.k === 'paint' && f > .25) c[p] = o.m;
    }
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  let me = null;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      me = { id, name: cleanName(m.name), skin: typeof m.skin === 'string' ? m.skin.slice(0, 2_000_000) : null, eyes: m.eyes || null, s: null };
      players.set(id, { ws, p: me });
      const plist = {};
      for (const [pid, p] of players) plist[pid] = p.p;
      send(ws, {
        t: 'init', id, pos: null, players: plist, objs: world.objs, tex: world.tex,
        drops: world.drops, jukes: world.jukes, ops: world.ops, time: world.time, h: world.h, c: world.c
      });
      broadcast({ t: 'join', p: me }, ws);
      return;
    }
    if (!me) return;

    if (m.t === 'p') {
      if (m.s && validPos(m.s)) {
        me.s = {
          x: cleanNum(m.s.x), y: cleanNum(m.s.y), z: cleanNum(m.s.z), ry: cleanNum(m.s.ry),
          sp: cleanNum(m.s.sp), sn: cleanNum(m.s.sn), si: cleanNum(m.s.si), air: cleanNum(m.s.air), vy: cleanNum(m.s.vy),
          atk: cleanNum(m.s.atk), use: cleanNum(m.s.use), fy: cleanNum(m.s.fy), gl: cleanNum(m.s.gl), el: cleanNum(m.s.el), hy: cleanNum(m.s.hy),
          hp: cleanNum(m.s.hp), pg: cleanNum(m.s.pg), dd: cleanNum(m.s.dd)
        };
        broadcast({ t: 'p', id, s: me.s }, ws);
      }
      return;
    }
    if (m.t === 'eyes') { me.eyes = m.e || null; broadcast({ t: 'eyes', id, e: me.eyes }, ws); return; }
    if (m.t === 'skin') { me.skin = typeof m.skin === 'string' ? m.skin.slice(0, 2_000_000) : null; broadcast({ t: 'skin', id, skin: me.skin }, ws); return; }
    if (m.t === 'chat') { broadcast({ t: 'chat', id, n: me.name, m: String(m.m || '').slice(0, 200) }); return; }
    if (m.t === 'voice') {
      if (typeof m.d !== 'string' || m.d.length > 400_000) return;
      broadcast({ t: 'voice', id, d: m.d, l: cleanNum(m.l, 3), a: cleanNum(m.a, 2.5) }, ws); return;
    }
    if (m.t === 'ping') { send(ws, { t: 'ping', id, ts: m.ts }); return; }

    if (m.t === 'time') {
      const v = Math.max(0, Math.min(24000, cleanNum(m.v, world.time)));
      world.time = v;
      broadcastAll({ t: 'time', v });
      return;
    }
    if (m.t === 'hit') { broadcastAll({ ...m, from: m.from ?? id }); return; }

    if (m.t === 'juke') {
      const oid = String(m.id || '');
      const box = world.objs[oid];
      if (!box || box.type !== 'jukebox' || distance(me.s || {}, box.p) > 16) return;
      if (m.stop) {
        delete world.jukes[oid];
        broadcastAll({ t: 'juke', id: oid, stop: 1, from: id });
        return;
      }
      if (typeof m.data !== 'string' || m.data.length > MAX_AUDIO_CHARS) return;
      const state = {
        id: oid, name: String(m.name || 'CD').slice(0, 30), cid: String(m.cid || '').slice(0, 120),
        data: m.data, from: id, startedAt: now()
      };
      world.jukes[oid] = state;
      broadcastAll({ t: 'juke', ...state });
      return;
    }

    if (m.t === 'op' && m.o) {
      const o = {
        x: clamp(cleanNum(m.o.x), -128, 128), z: clamp(cleanNum(m.o.z), -128, 128),
        r: clamp(cleanNum(m.o.r), 0, 30), k: String(m.o.k || ''),
        s: clamp(cleanNum(m.o.s), 0, 1), y: clamp(cleanNum(m.o.y), -100, 100),
        m: clamp(Math.floor(cleanNum(m.o.m)), 0, 7)
      };
      if (!['raise', 'lower', 'smooth', 'flatten', 'paint'].includes(o.k)) return;
      applyTerrainOp(o);
      // New joiners receive the current height/color map (not a history to replay).
      world.ops.length = 0;
      broadcastAll({ t: 'op', o });
      return;
    }

    if (m.t === 'tex') {
      if (typeof m.id !== 'string' || typeof m.d !== 'string') return;
      if (m.id.length > 220 || m.d.length > MAX_TEX_CHARS) return;
      world.tex[m.id] = m.d;
      broadcastAll({ t: 'tex', id: m.id, d: m.d });
      return;
    }

    if (m.t === 'add' && m.o) {
      const o = sanitizeObj(m.o);
      if (!o) return;
      const oid = `o:${now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
      o.id = oid;
      world.objs[oid] = o;
      broadcastAll({ t: 'add', o, by: id });
      return;
    }
    if (m.t === 'upd' && m.id && world.objs[m.id]) {
      const p = m.p && typeof m.p === 'object' ? m.p : {};
      const patch = {};
      const target = world.objs[m.id];
      if (Array.isArray(p.p)) patch.p = cleanVec(p.p, target.p);
      if (Array.isArray(p.r)) patch.r = cleanVec(p.r, target.r);
      if (Array.isArray(p.s)) patch.s = cleanVec(p.s, target.s).map(v => clamp(v, .02, 100));
      for (const k of ['anch', 'vis', 'tch']) if (k in p) patch[k] = p[k] === 0 ? 0 : 1;
      if (Array.isArray(p.tx)) patch.tx = p.tx.slice(0, 4).map(v => cleanNum(v));
      if (typeof p.tex === 'string' || p.tex === null) patch.tex = p.tex;
      if (typeof p.txt === 'string') patch.txt = p.txt.slice(0, 56);
      if (typeof p.code === 'string') patch.code = p.code.slice(0, 20000);
      if (Array.isArray(p.items)) patch.items = p.items.slice(0, 27).map(sanitizeItem).filter(Boolean);
      Object.assign(target, patch);
      broadcastAll({ t: 'upd', id: m.id, p: patch });
      return;
    }
    if (m.t === 'break' && m.id && world.objs[m.id]) {
      const o = world.objs[m.id];
      const reach = 16 + (o.type === 'model' ? Math.max(...o.s.map(Math.abs)) * 1.5 : 0);
      if (distance(me.s || {}, o.p) > reach) return;
      delete world.objs[m.id];
      if (o.type === 'jukebox' && world.jukes[m.id]) {
        delete world.jukes[m.id];
        broadcastAll({ t: 'juke', id: m.id, stop: 1, from: id });
      }
      broadcastAll({ t: 'del', id: m.id });
      let items;
      if (o.type === 'model' && o.mdl) {
        // Model rewards are built from authoritative world state: size, rotation,
        // model format and texture survive a break/pickup/place cycle.
        items = [{
          k: `model:${o.mdl}`, n: 1,
          model: { mdl: o.mdl, fmt: o.fmt, s: o.s, r: o.r, name: o.name || 'Modèle 3D', tex: o.tex, tx: o.tx }
        }];
      } else {
        items = Array.isArray(m.items) ? m.items.map(sanitizeItem).filter(Boolean).slice(0, 8) : [];
      }
      if (items.length) send(ws, { t: 'reward', items });
      return;
    }
    if (m.t === 'del' && m.id && world.objs[m.id]) {
      delete world.objs[m.id];
      if (world.jukes[m.id]) {
        delete world.jukes[m.id];
        broadcastAll({ t: 'juke', id: m.id, stop: 1, from: id });
      }
      broadcastAll({ t: 'del', id: m.id });
      return;
    }
    if (m.t === 'drop') {
      const item = sanitizeItem(m.item);
      if (!item || (!validPos(me.s || {}) && !Array.isArray(m.p)) || Object.keys(world.drops).length >= 2000) return;
      const oid = `d:${now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
      const p = Array.isArray(m.p) && m.p.length >= 3 ? cleanVec(m.p) : [me.s.x, me.s.y + 1, me.s.z];
      if (!validPos({ x: p[0], y: p[1], z: p[2] }) || (validPos(me.s || {}) && distance(me.s, p) > 4)) return;
      const v = Array.isArray(m.v)
        ? [clamp(cleanNum(m.v[0]), -6, 6), clamp(cleanNum(m.v[1], 3), -2, 8), clamp(cleanNum(m.v[2]), -6, 6)]
        : [0, 3, 0];
      const born = now();
      const d = { id: oid, owner: id, item, p, v, born, pickupAfter: born + 600 };
      world.drops[oid] = d;
      broadcastAll({ t: 'drop', d });
      return;
    }
    if (m.t === 'pickup' && m.id && world.drops[m.id]) {
      const d = world.drops[m.id];
      if (now() < (d.pickupAfter || 0) || distance(me.s || {}, d.p) > 3.2) return;
      delete world.drops[m.id];
      send(ws, { t: 'reward', items: [d.item] });
      broadcastAll({ t: 'dropdel', id: m.id });
      return;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    players.delete(id);
    broadcast({ t: 'leave', id });
  });
});

// Server-authoritative dropped-item movement keeps every client in sync and
// makes pickup distance validation use the same position for all players.
let lastDropTick = now();
setInterval(() => {
  const t = now(), dt = clamp((t - lastDropTick) / 1000, 0, .1);
  lastDropTick = t;
  for (const d of Object.values(world.drops)) {
    const oldX = d.p[0], oldY = d.p[1], oldZ = d.p[2];
    d.v[1] = Math.max(-18, d.v[1] - 18 * dt);
    d.v[0] *= Math.exp(-.12 * dt);
    d.v[2] *= Math.exp(-.12 * dt);
    d.p[0] += d.v[0] * dt;
    d.p[1] += d.v[1] * dt;
    d.p[2] += d.v[2] * dt;
    const floor = terrainAt(d.p[0], d.p[2]) + .12;
    if (d.p[1] < floor) {
      d.p[1] = floor;
      if (Math.abs(d.v[1]) > 1.1) d.v[1] = Math.abs(d.v[1]) * .24;
      else d.v[1] = 0;
      d.v[0] *= .62;
      d.v[2] *= .62;
    }
    const moving = Math.hypot(d.v[0], d.v[1], d.v[2]) > .035;
    if (t - (d.lastBroadcast || 0) >= 120 || (!moving && !d.rested)) {
      d.lastBroadcast = t;
      d.rested = !moving;
      broadcastAll({ t: 'dropmove', id: d.id, p: d.p, v: d.v });
    }
    // Avoid needless physics work once an item is fully at rest.
    if (!moving && Math.abs(d.p[0] - oldX) < .0001 && Math.abs(d.p[2] - oldZ) < .0001 && Math.abs(d.p[1] - oldY) < .0001) d.v[1] = 0;
  }
}, 50).unref();

// Drop cleanup: prevents abandoned items from living forever.
setInterval(() => {
  const cutoff = now() - 15 * 60 * 1000;
  for (const [id, d] of Object.entries(world.drops)) {
    if (d.born < cutoff) { delete world.drops[id]; broadcastAll({ t: 'dropdel', id }); }
  }
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`COMMUNITY WORLD server listening on port ${PORT}`));
