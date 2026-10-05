const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
  res.end('COMMUNITY WORLD WebSocket server is running.');
});

const wss = new WebSocketServer({ server });

let nextId = 1;
const players = new Map();
const world = {
  objs: {},
  tex: {},
  h: new Array(257 * 257).fill(0),
  c: new Array(257 * 257).fill(0)
};

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except = null) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws !== except && p.ws.readyState === 1) p.ws.send(data);
  }
}

function cleanName(v) {
  return String(v || 'Joueur').slice(0, 16);
}

wss.on('connection', (ws) => {
  const id = nextId++;
  let me = null;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.t === 'join') {
      me = {
        id,
        name: cleanName(m.name),
        skin: m.skin || null,
        eyes: m.eyes || null,
        s: null
      };
      players.set(id, { ws, p: me });

      const plist = {};
      for (const [pid, p] of players) plist[pid] = p.p;

      send(ws, {
        t: 'init',
        id,
        pos: null,
        players: plist,
        objs: world.objs,
        tex: world.tex,
        h: world.h,
        c: world.c
      });

      broadcast({ t: 'join', p: me }, ws);
      return;
    }

    if (!me) return;

    // Player state
    if (m.t === 'p') {
      me.s = m.s;
      broadcast({ t: 'p', id, s: m.s }, ws);
      return;
    }

    if (m.t === 'eyes') {
      me.eyes = m.e;
      broadcast({ t: 'eyes', id, e: m.e }, ws);
      return;
    }

    if (m.t === 'skin') {
      me.skin = m.skin;
      broadcast({ t: 'skin', id, skin: m.skin }, ws);
      return;
    }

    if (m.t === 'chat') {
      broadcast({
        t: 'chat',
        id,
        n: me.name,
        m: String(m.m || '').slice(0, 200)
      });
      return;
    }

    if (m.t === 'voice') {
      // Voice packets are relayed as-is to other connected players.
      broadcast({ t: 'voice', id, d: m.d, l: m.l, a: m.a }, ws);
      return;
    }

    if (m.t === 'ping') {
      send(ws, { t: 'ping', id, ts: m.ts });
      return;
    }

    if (m.t === 'time') {
      broadcast(m);
      return;
    }

    if (m.t === 'hit') {
      broadcast({ ...m, from: m.from ?? id });
      return;
    }

    if (m.t === 'juke') {
      broadcast({ ...m, from: id }, ws);
      return;
    }

    if (m.t === 'op') {
      // Terrain edit.
      if (m.o) {
        broadcast(m, ws);
      }
      return;
    }

    if (m.t === 'tex') {
      if (m.id && m.d) world.tex[m.id] = m.d;
      broadcast(m, ws);
      return;
    }

    if (m.t === 'add' && m.o) {
      const oid = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      m.o.id = oid;
      world.objs[oid] = m.o;
      broadcast({ t: 'add', o: m.o, by: id });
      return;
    }

    if (m.t === 'upd' && m.id) {
      if (world.objs[m.id]) Object.assign(world.objs[m.id], m.p || {});
      broadcast(m, ws);
      return;
    }

    if (m.t === 'del' && m.id) {
      delete world.objs[m.id];
      broadcast(m, ws);
      return;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    players.delete(id);
    broadcast({ t: 'leave', id });
  });
});

server.listen(PORT, () => {
  console.log(`COMMUNITY WORLD server listening on port ${PORT}`);
});
