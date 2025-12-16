const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* ===== CONFIG ===== */
const MAP = { w: 2200, h: 1400 };
const TICK = 50;
const ROOMS = new Map();

/* ===== HELPERS ===== */
const rand = (a, b) => a + Math.random() * (b - a);
const rid = () => Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const d2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

/* ===== ROOM ===== */
function newDoor() {
  return {
    x: rand(300, MAP.w - 300),
    y: rand(300, MAP.h - 300),
    r: 46,
    open: false
  };
}

function roomGet(id) {
  if (!ROOMS.has(id)) {
    ROOMS.set(id, {
      players: {},
      clients: new Map(),
      bullets: [],
      enemies: [],
      lifes: [],
      close: 0,
      startedAt: Date.now(),
      lastEnemyAt: 0,
      lastLifeAt: 0,
      door: newDoor(),
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

/* ===== SPAWNS ===== */
function spawnEnemy(r) {
  r.enemies.push({
    x: rand(200, MAP.w - 200),
    y: rand(200, MAP.h - 200),
    hp: 70,
    cd: 0
  });
}

function spawnLife(r) {
  r.lifes.push({
    x: rand(220, MAP.w - 220),
    y: rand(220, MAP.h - 220),
    r: 14
  });
}

/* ===== GAME LOOP ===== */
function tickRoom(roomId, r) {
  const now = Date.now();

  /* FECHAR MAPA */
  if (now - r.startedAt > 3000) {
    r.close = Math.min(560, r.close + 0.45);
  }

  /* SPAWNS */
  if (now - r.lastEnemyAt > 1300) {
    spawnEnemy(r);
    r.lastEnemyAt = now;
  }

  if (now - r.lastLifeAt > 3500) {
    spawnLife(r);
    r.lastLifeAt = now;
  }

  /* PLAYER */
  for (const p of Object.values(r.players)) {
    if (!p.alive) continue;
    const speed = p.cls === "tank" ? 2.2 : 2.8;

    let ix = clamp(p.ix || 0, -1, 1);
    let iy = clamp(p.iy || 0, -1, 1);
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }

    p.x = clamp(p.x + ix * speed, 18, MAP.w - 18);
    p.y = clamp(p.y + iy * speed, 18, MAP.h - 18);

    /* DANO FORA DA ZONA */
    const L = r.close, T = r.close;
    const R = MAP.w - r.close, B = MAP.h - r.close;
    if (p.x < L || p.y < T || p.x > R || p.y > B) {
      p.hp -= 0.4;
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
      }
    }
  }

  /* INIMIGOS */
  for (const e of r.enemies) {
    const alive = Object.values(r.players).filter(p => p.alive);
    if (!alive.length) break;

    let t = alive[0];
    let best = d2(e.x, e.y, t.x, t.y);
    for (const p of alive) {
      const dd = d2(e.x, e.y, p.x, p.y);
      if (dd < best) { best = dd; t = p; }
    }

    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;

    e.x += (dx / d) * 1.3;
    e.y += (dy / d) * 1.3;

    /* CONTATO */
    if (d < 34) {
      t.hp -= 0.4;
      if (t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
      }
    }

    /* TIRO SÓ PERTO */
    e.cd = Math.max(0, e.cd - 1);
    if (d < 420 && e.cd === 0) {
      e.cd = 35;
      r.bullets.push({
        x: e.x,
        y: e.y,
        vx: (dx / d) * 7,
        vy: (dy / d) * 7,
        from: "e",
        life: 80
      });
    }
  }

  /* BALAS */
  for (let i = r.bullets.length - 1; i >= 0; i--) {
    const b = r.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    let dead = b.life <= 0;

    if (!dead && b.from === "e") {
      for (const p of Object.values(r.players)) {
        if (!p.alive) continue;
        if (d2(b.x, b.y, p.x, p.y) < 20 * 20) {
          p.hp -= 10;
          if (p.hp <= 0) { p.hp = 0; p.alive = false; }
          dead = true;
          break;
        }
      }
    }

    if (!dead && b.from?.startsWith("p:")) {
      for (const e of r.enemies) {
        if (d2(b.x, b.y, e.x, e.y) < 20 * 20) {
          e.hp -= 22;
          if (e.hp <= 0) {
            const owner = b.from.split(":")[1];
            if (r.players[owner]) r.players[owner].kills++;
          }
          dead = true;
          break;
        }
      }
    }

    if (dead) r.bullets.splice(i, 1);
  }

  r.enemies = r.enemies.filter(e => e.hp > 0);

  /* COLETAR VIDA */
  for (let i = r.lifes.length - 1; i >= 0; i--) {
    const l = r.lifes[i];
    for (const p of Object.values(r.players)) {
      if (!p.alive) continue;
      if (d2(l.x, l.y, p.x, p.y) < (l.r + 18) ** 2) {
        p.hp = Math.min(p.max, p.hp + 45);
        r.lifes.splice(i, 1);
        break;
      }
    }
  }

  /* ABRIR PORTA APÓS 5 KILLS */
  for (const p of Object.values(r.players)) {
    if (p.kills >= 5) r.door.open = true;
  }

  /* VITÓRIA / DERROTA */
  const alive = Object.values(r.players).filter(p => p.alive);
  r.result = null;

  if (alive.length === 0) r.result = { lose: true };

  if (r.door.open && alive.length) {
    const inDoor = alive.filter(p =>
      d2(p.x, p.y, r.door.x, r.door.y) < (r.door.r + 20) ** 2
    );
    if (inDoor.length === alive.length) {
      let win = inDoor[0];
      for (const p of inDoor) if (p.kills > win.kills) win = p;
      r.result = { win: win.id };
    }
  }

  broadcast(roomId, {
    t: "snapshot",
    map: { w: MAP.w, h: MAP.h, close: r.close, door: r.door },
    players: r.players,
    enemies: r.enemies,
    bullets: r.bullets,
    lifes: r.lifes,
    result: r.result
  });
}

setInterval(() => {
  for (const [id, r] of ROOMS) tickRoom(id, r);
}, TICK);

/* ===== WS ===== */
wss.on("connection", ws => {
  const id = rid();

  ws.on("message", raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === "join") {
      const roomId = String(m.room || "sala1").slice(0, 24);
      ws.roomId = roomId;
      const r = roomGet(roomId);
      r.clients.set(ws, id);

      const cls = m.cls === "tank" ? "tank" : "soldier";
      const max = cls === "tank" ? 160 : 110;

      r.players[id] = {
        x: rand(300, 500),
        y: rand(300, 500),
        ix: 0, iy: 0,
        aimX: 1, aimY: 0,
        hp: max, max,
        alive: true,
        cls,
        name: String(m.name || id).slice(0, 14),
        kills: 0
      };

      ws.send(JSON.stringify({ t: "you", id, roomId }));
      return;
    }

    const r = ROOMS.get(ws.roomId);
    if (!r) return;
    const p = r.players[id];
    if (!p) return;

    if (m.t === "input") {
      p.ix = clamp(m.ix || 0, -1, 1);
      p.iy = clamp(m.iy || 0, -1, 1);
      p.aimX = m.aimX || p.aimX;
      p.aimY = m.aimY || p.aimY;
    }

    if (m.t === "shoot" && p.alive) {
      const len = Math.hypot(p.aimX, p.aimY) || 1;
      r.bullets.push({
        x: p.x + (p.aimX / len) * 28,
        y: p.y + (p.aimY / len) * 28,
        vx: (p.aimX / len) * 9,
        vy: (p.aimY / len) * 9,
        from: `p:${id}`,
        life: 75
      });
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
