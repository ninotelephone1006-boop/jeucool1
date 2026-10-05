const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const MAX_AUDIO = 20 * 1024 * 1024;
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
  ops: [],
  time: 6000,
  h: new Array(257 * 257).fill(0),
  c: new Array(257 * 257).fill(0)
};

const now = () => Date.now();
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
function cleanNum(v, d = 0) { return Number.isFinite(Number(v)) ? Number(v) : d; }
function cleanVec(v, d = [0, 0, 0]) {
  return Array.isArray(v) && v.length >= 3 ? [cleanNum(v[0]), cleanNum(v[1]), cleanNum(v[2])] : d.slice();
}
function validPos(s) { return s && [s.x, s.y, s.z].every(Number.isFinite); }
function sanitizeItem(it) {
  if (!it || typeof it.k !== 'string') return null;
  const out = { k: it.k.slice(0, 220), n: Math.max(1, Math.min(64, Math.floor(cleanNum(it.n, 1)))) };
  if (it.model && typeof it.model === 'object' && typeof it.model.mdl === 'string') {
    out.model = {
      mdl: it.model.mdl.slice(0, 220),
      fmt: it.model.fmt === 'obj' ? 'obj' : 'glb',
      s: cleanVec(it.model.s, [1, 1, 1]),
      r: cleanVec(it.model.r, [0, 0, 0]),
      name: String(it.model.name || 'Modèle 3D').slice(0, 48),
      tex: typeof it.model.tex === 'string' ? it.model.tex.slice(0, 220) : null,
      tx: Array.isArray(it.model.tx) ? it.model.tx.slice(0, 4).map(Number) : [1, 0, 0, 0]
    };
  }
  return out;
}
function sanitizeObj(o) {
  if (!o || typeof o.type !== 'string') return null;
  const r = {
    type: o.type.slice(0, 80), p: cleanVec(o.p), r: cleanVec(o.r), s: cleanVec(o.s, [1, 1, 1]),
    tx: Array.isArray(o.tx) ? o.tx.slice(0, 4).map(Number) : [1, 0, 0, 0],
    tex: typeof o.tex === 'string' ? o.tex.slice(0, 220) : null,
    mdl: typeof o.mdl === 'string' ? o.mdl.slice(0, 220) : undefined,
    fmt: o.fmt === 'obj' ? 'obj' : 'glb',
    anch: o.anch === 0 ? 0 : 1,
    vis: o.vis === 0 ? 0 : 1,
    tch: o.tch === 0 ? 0 : 1
  };
  if (typeof o.txt === 'string') r.txt = o.txt.slice(0, 56);
  if (typeof o.code === 'string') r.code = o.code.slice(0, 20000);
  if (Array.isArray(o.items)) r.items = o.items.slice(0, 27).map(sanitizeItem);
  if (r.type === 'model' && !r.mdl) return null;
  return r;
}
function distance(a, b) {
  if (!validPos(a) || !Array.isArray(b) || b.length < 3) return Infinity;
  return Math.hypot(a.x - b[0], a.z - b[2], (a.y || 0) - (b[1] || 0));
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
      if (m.s && validPos(m.s)) me.s = {
        x: cleanNum(m.s.x), y: cleanNum(m.s.y), z: cleanNum(m.s.z), ry: cleanNum(m.s.ry),
        sp: cleanNum(m.s.sp), sn: cleanNum(m.s.sn), si: cleanNum(m.s.si), air: cleanNum(m.s.air), vy: cleanNum(m.s.vy),
        atk: cleanNum(m.s.atk), use: cleanNum(m.s.use), fy: cleanNum(m.s.fy), gl: cleanNum(m.s.gl), el: cleanNum(m.s.el), hy: cleanNum(m.s.hy),
        hp: cleanNum(m.s.hp), pg: cleanNum(m.s.pg), dd: cleanNum(m.s.dd)
      };
      broadcast({ t: 'p', id, s: me.s }, ws);
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
      const oid = m.id;
      if (!world.objs[oid] || world.objs[oid].type !== 'jukebox') return;
      if (m.stop) {
        delete world.jukes[oid];
        broadcastAll({ t: 'juke', id: oid, stop: 1, from: id });
        return;
      }
      if (typeof m.data !== 'string' || m.data.length > MAX_AUDIO) return;
      const state = { id: oid, name: String(m.name || 'CD').slice(0, 30), cid: String(m.cid || '' ).slice(0, 120), data: m.data, from: id };
      world.jukes[oid] = state;
      broadcastAll({ t: 'juke', ...state });
      return;
    }

    if (m.t === 'op' && m.o) {
      const o = {
        x: cleanNum(m.o.x), z: cleanNum(m.o.z), r: Math.max(0, cleanNum(m.o.r)), k: String(m.o.k || ''),
        s: Math.max(0, Math.min(1, cleanNum(m.o.s))), y: cleanNum(m.o.y), m: Math.max(0, Math.min(255, cleanNum(m.o.m)))
      };
      if (!['raise', 'lower', 'smooth', 'flatten', 'paint'].includes(o.k)) return;
      world.ops.push(o);
      broadcastAll({ t: 'op', o });
      return;
    }

    if (m.t === 'tex') {
      if (typeof m.id !== 'string' || typeof m.d !== 'string') return;
      if (m.d.length > 30 * 1024 * 1024) return;
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
      const p = m.p || {};
      const target = world.objs[m.id];
      if (p.p) target.p = cleanVec(p.p, target.p);
      if (p.r) target.r = cleanVec(p.r, target.r);
      if (p.s) target.s = cleanVec(p.s, target.s).map(v => Math.max(.02, Math.min(100, v)));
      for (const k of ['anch', 'vis', 'tch']) if (k in p) target[k] = p[k] === 0 ? 0 : 1;
      if (p.tx) target.tx = Array.isArray(p.tx) ? p.tx.slice(0, 4).map(Number) : target.tx;
      if (typeof p.tex === 'string' || p.tex === null) target.tex = p.tex;
      if (typeof p.txt === 'string') target.txt = p.txt.slice(0, 56);
      if (typeof p.code === 'string') target.code = p.code.slice(0, 20000);
      if (Array.isArray(p.items)) target.items = p.items.slice(0, 27).map(sanitizeItem);
      broadcastAll({ t: 'upd', id: m.id, p });
      return;
    }
    if (m.t === 'break' && m.id && world.objs[m.id]) {
      const o = world.objs[m.id];
      if (distance(me.s || {}, o.p) > 16) return;
      delete world.objs[m.id];
      if (o.type === 'jukebox') delete world.jukes[m.id];
      broadcastAll({ t: 'del', id: m.id });
      const items = Array.isArray(m.items) ? m.items.map(sanitizeItem).filter(Boolean).slice(0, 8) : [];
      if (items.length) send(ws, { t: 'reward', items });
      if (o.type === 'model' && o.mdl && !items.length) {
        send(ws, { t: 'reward', items: [{ k: `model:${o.mdl}`, n: 1, model: { mdl: o.mdl, fmt: o.fmt, s: o.s, r: o.r, name: 'Modèle 3D' } }] });
      }
      return;
    }
    if (m.t === 'del' && m.id && world.objs[m.id]) {
      delete world.objs[m.id];
      delete world.jukes[m.id];
      broadcastAll({ t: 'del', id: m.id });
      return;
    }
    if (m.t === 'drop') {
      const item = sanitizeItem(m.item);
      if (!item || !validPos(me.s || {})) return;
      const oid = `d:${now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
      const p = [me.s.x, me.s.y + 1, me.s.z];
      const v = Array.isArray(m.v) ? [cleanNum(m.v[0]), cleanNum(m.v[1], 3), cleanNum(m.v[2])] : [0, 2.2, 0];
      const d = { id: oid, owner: id, item, p, v, born: now() };
      world.drops[oid] = d;
      broadcastAll({ t: 'drop', d });
      return;
    }
    if (m.t === 'pickup' && m.id && world.drops[m.id]) {
      const d = world.drops[m.id];
      if (distance(me.s || {}, d.p) > 3.2) return;
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

// Drop cleanup: prevents abandoned items from living forever.
setInterval(() => {
  const cutoff = now() - 15 * 60 * 1000;
  for (const [id, d] of Object.entries(world.drops)) {
    if (d.born < cutoff) { delete world.drops[id]; broadcastAll({ t: 'dropdel', id }); }
  }
}, 60_000).unref();

server.listen(PORT, () => console.log(`COMMUNITY WORLD server listening on port ${PORT}`));
