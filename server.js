const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 2200, h: 1400 };
const TICK = 50;
const ROOMS = new Map();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rid = () => Math.random().toString(36).slice(2, 8);
const d2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function newRoom() {
  return {
    players: {},
    bullets: [],
    enemies: [],
    lifes: [],
    close: 0,
    door: {
      x: rand(300, MAP.w - 300),
      y: rand(300, MAP.h - 300),
      r: 46,
      open: false
    },
    lastEnemy: 0,
    lastLife: 0,
    start: Date.now(),
    result: null
  };
}

function tick(room) {
  const now = Date.now();

  if (now - room.start > 3000)
    room.close = Math.min(560, room.close + 0.4);

  if (now - room.lastEnemy > 1400) {
    room.enemies.push({
      x: rand(200, MAP.w - 200),
      y: rand(200, MAP.h - 200),
      hp: 70,
      cd: 0
    });
    room.lastEnemy = now;
  }

  if (now - room.lastLife > 4000) {
    room.lifes.push({
      x: rand(220, MAP.w - 220),
      y: rand(220, MAP.h - 220)
    });
    room.lastLife = now;
  }

  Object.values(room.players).forEach(p => {
    if (!p.alive) return;

    const sp = p.cls === "tank" ? 2.1 : 2.7;
    p.x = clamp(p.x + p.ix * sp, 0, MAP.w);
    p.y = clamp(p.y + p.iy * sp, 0, MAP.h);

    const L = room.close;
    const R = MAP.w - room.close;
    const T = room.close;
    const B = MAP.h - room.close;

    if (p.x < L || p.x > R || p.y < T || p.y > B) {
      p.hp -= 0.5;
      if (p.hp <= 0) p.alive = false;
    }

    if (p.kills >= 5) room.door.open = true;
  });

  room.enemies.forEach(e => {
    const alive = Object.values(room.players).filter(p => p.alive);
    if (!alive.length) return;
    const t = alive[0];
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;

    e.x += (dx / d) * 1.3;
    e.y += (dy / d) * 1.3;

    if (d < 40) t.hp -= 0.4;

    e.cd = Math.max(0, e.cd - 1);
    if (d < 420 && e.cd === 0) {
      e.cd = 35;
      room.bullets.push({
        x: e.x,
        y: e.y,
        vx: (dx / d) * 7,
        vy: (dy / d) * 7,
        from: "e",
        life: 80
      });
    }
  });

  room.bullets = room.bullets.filter(b => {
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    return b.life > 0;
  });
}

setInterval(() => {
  for (const room of ROOMS.values()) tick(room);
}, TICK);

wss.on("connection", ws => {
  const id = rid();
  let room;

  ws.on("message", raw => {
    const m = JSON.parse(raw);

    if (m.t === "join") {
      room = ROOMS.get(m.room) || newRoom();
      ROOMS.set(m.room, room);

      room.players[id] = {
        x: rand(400, 600),
        y: rand(400, 600),
        ix: 0,
        iy: 0,
        hp: m.cls === "tank" ? 160 : 110,
        max: m.cls === "tank" ? 160 : 110,
        alive: true,
        kills: 0,
        cls: m.cls
      };

      ws.send(JSON.stringify({ t: "you", id }));
    }

    if (m.t === "input" && room.players[id]) {
      room.players[id].ix = m.ix;
      room.players[id].iy = m.iy;
    }
  });

  ws.on("close", () => {
    if (room) delete room.players[id];
  });

  setInterval(() => {
    if (!room) return;
    ws.send(JSON.stringify({ t: "state", room }));
  }, 50);
});

server.listen(process.env.PORT || 10000);
