const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 2200, h: 1400 };
const TICK = 50;
const ROOMS = new Map();

const rand = (a, b) => a + Math.random() * (b - a);
const rid = () => Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const d2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

function roomGet(id) {
  if (!ROOMS.has(id)) {
    ROOMS.set(id, {
      players: {}, clients: new Map(),
      bullets: [], enemies: [], lifes: [],
      close: 0, startedAt: Date.now(),
      lastEnemyAt: 0, lastLifeAt: 0,
      door: { x: MAP.w - 260, y: MAP.h - 220, r: 44 },
      result: null
    });
  }
  return ROOMS.get(id);
}

function broadcast(roomId, data) {
  const r = ROOMS.get(roomId);
  if (!r) return;
  const msg = JSON.stringify(data);
  for (const ws of r.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function spawnEnemy(r) {
  r.enemies.push({ x: rand(240, MAP.w - 240), y: rand(240, MAP.h - 240), hp: 70, cd: 0 });
}
function spawnLife(r) {
  r.lifes.push({ x: rand(220, MAP.w - 220), y: rand(220, MAP.h - 220), r: 14 });
}

function tickRoom(roomId, r) {
  const now = Date.now();

  if (now - r.startedAt > 4000) r.close = Math.min(520, r.close + 0.45);

  if (now - r.lastEnemyAt > 1400) { spawnEnemy(r); r.lastEnemyAt = now; }
  if (now - r.lastLifeAt > 4000) { spawnLife(r); r.lastLifeAt = now; }

  for (const p of Object.values(r.players)) {
    if (!p.alive) continue;
    const speed = p.cls === "tank" ? 2.2 : 2.8;
    let ix = clamp(p.ix || 0, -1, 1), iy = clamp(p.iy || 0, -1, 1);
    const len = Math.hypot(ix, iy); if (len > 1) { ix /= len; iy /= len; }
    p.x = clamp(p.x + ix * speed, 18, MAP.w - 18);
    p.y = clamp(p.y + iy * speed, 18, MAP.h - 18);
  }

  broadcast(roomId, {
    t: "snapshot",
    map: { w: MAP.w, h: MAP.h, close: r.close, door: r.door },
    players: r.players, enemies: r.enemies, bullets: r.bullets, lifes: r.lifes,
    result: r.result
  });
}

setInterval(() => {
  for (const [id, r] of ROOMS) tickRoom(id, r);
}, TICK);

wss.on("connection", (ws) => {
  const id = rid();

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === "join") {
      const roomId = String(m.room || "sala1").slice(0, 24);
      ws.roomId = roomId; ws.playerId = id;
      const r = roomGet(roomId);
      r.clients.set(ws, id);
      const cls = (m.cls === "tank") ? "tank" : "soldier";
      const max = (cls === "tank") ? 160 : 110;
      r.players[id] = {
        x: rand(300, 500), y: rand(300, 500),
        ix: 0, iy: 0, aimX: 1, aimY: 0,
        hp: max, max, alive: true, cls,
        name: String(m.name || id).slice(0, 14),
        kills: 0
      };
      ws.send(JSON.stringify({ t: "you", id, roomId }));
    }
  });

  ws.on("close", () => {
    const r = ROOMS.get(ws.roomId);
    if (!r) return;
    r.clients.delete(ws);
    delete r.players[id];
    if (r.clients.size === 0) ROOMS.delete(ws.roomId);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
