const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 1600, h: 900 };
let players = {};
let bullets = [];
let enemies = [];
let lifes = [];
let zone = 0;
let door = { x: 800, y: 450, open: false };

const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b, c, d) => Math.hypot(a - c, b - d);

wss.on("connection", ws => {
  const id = Math.random().toString(36).slice(2, 7);
  players[id] = {
    id, x: rand(300, 600), y: rand(300, 600),
    hp: 100, kills: 0, ix: 0, iy: 0
  };

  ws.send(JSON.stringify({ t: "id", id }));

  ws.on("message", msg => {
    const m = JSON.parse(msg);
    const p = players[id];
    if (!p) return;

    if (m.t === "move") {
      p.ix = m.x; p.iy = m.y;
    }

    if (m.t === "shoot") {
      bullets.push({
        x: p.x, y: p.y,
        vx: m.ax * 8, vy: m.ay * 8,
        from: id, life: 80
      });
    }

    if (m.t === "reset") {
      players = {}; bullets = []; enemies = [];
      lifes = []; zone = 0; door.open = false;
    }
  });

  ws.on("close", () => delete players[id]);
});

setInterval(() => {
  zone += 0.15;

  if (Math.random() < 0.03)
    enemies.push({ x: rand(100, 1500), y: rand(100, 800), hp: 60 });

  if (Math.random() < 0.01)
    lifes.push({ x: rand(200, 1400), y: rand(200, 700) });

  for (const p of Object.values(players)) {
    p.x += p.ix * 3;
    p.y += p.iy * 3;

    if (
      p.x < zone || p.y < zone ||
      p.x > MAP.w - zone || p.y > MAP.h - zone
    ) p.hp -= 0.4;

    if (p.kills >= 5) door.open = true;
  }

  bullets.forEach(b => {
    b.x += b.vx; b.y += b.vy; b.life--;
    enemies.forEach(e => {
      if (dist(b.x, b.y, e.x, e.y) < 20) {
        e.hp -= 30; b.life = 0;
        if (e.hp <= 0 && players[b.from]) players[b.from].kills++;
      }
    });
  });

  bullets = bullets.filter(b => b.life > 0);
  enemies = enemies.filter(e => e.hp > 0);

  lifes.forEach(l => {
    for (const p of Object.values(players)) {
      if (dist(l.x, l.y, p.x, p.y) < 25) {
        p.hp = Math.min(100, p.hp + 40);
        l.dead = true;
      }
    }
  });
  lifes = lifes.filter(l => !l.dead);

  const state = { t: "state", players, enemies, bullets, lifes, door, zone };
  wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(state)));
}, 50);

server.listen(process.env.PORT || 10000, () =>
  console.log("Servidor rodando")
);
