const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 2200, h: 1400 };
const TICK_MS = 50; // 20Hz
const ROOMS = new Map();

const rand = (a, b) => a + Math.random() * (b - a);
const rid = () => Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

function roomGet(roomId) {
  if (!ROOMS.has(roomId)) {
    ROOMS.set(roomId, {
      players: {},        // id -> player
      clients: new Map(), // ws -> id
      bullets: [],
      enemies: [],
      lifes: [],
      close: 0,
      door: { x: MAP.w - 260, y: MAP.h - 220, r: 44 },
      startedAt: Date.now(),
      lastEnemyAt: 0,
      lastLifeAt: 0,
      msg: ""
    });
  }
  return ROOMS.get(roomId);
}

function broadcast(roomId, obj) {
  const r = ROOMS.get(roomId);
  if (!r) return;
  const msg = JSON.stringify(obj);
  for (const ws of r.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function spawnEnemy(r) {
  r.enemies.push({
    x: rand(240, MAP.w - 240),
    y: rand(240, MAP.h - 240),
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

function insideClosingBorder(r, p) {
  const left = r.close;
  const top = r.close;
  const right = MAP.w - r.close;
  const bottom = MAP.h - r.close;
  return (p.x < left || p.y < top || p.x > right || p.y > bottom);
}

function allAliveInDoor(r) {
  const ids = Object.keys(r.players);
  if (ids.length < 2) return false;
  for (const id of ids) {
    const p = r.players[id];
    if (!p?.alive) return false;
    if (dist2(p.x, p.y, r.door.x, r.door.y) > (r.door.r + 20) ** 2) return false;
  }
  return true;
}

function tickRoom(roomId, r) {
  const now = Date.now();
  const elapsed = (now - r.startedAt) / 1000;

  // começa a fechar após alguns segundos
  if (elapsed > 4) r.close = Math.min(520, r.close + 0.45);

  // spawns
  if (now - r.lastEnemyAt > 1400) { spawnEnemy(r); r.lastEnemyAt = now; }
  if (now - r.lastLifeAt > 5000) { spawnLife(r); r.lastLifeAt = now; }

  // MOVIMENTO SERVER-AUTHORITATIVE (SEM TREMER)
  for (const p of Object.values(r.players)) {
    if (!p.alive) continue;
    const speed = p.cls === "tank" ? 2.2 : 2.8;
    const ix = clamp(p.ix || 0, -1, 1);
    const iy = clamp(p.iy || 0, -1, 1);
    // normalize diagonal
    const len = Math.hypot(ix, iy);
    const nx = len > 1 ? ix / len : ix;
    const ny = len > 1 ? iy / len : iy;

    p.x = clamp(p.x + nx * speed, 18, MAP.w - 18);
    p.y = clamp(p.y + ny * speed, 18, MAP.h - 18);
  }

  // dano na borda que fecha
  for (const p of Object.values(r.players)) {
    if (!p.alive) continue;
    if (insideClosingBorder(r, p)) {
      p.hp -= 0.35;
      if (p.hp <= 0) { p.hp = 0; p.alive = false; r.msg = "Um jogador morreu"; }
    }
  }

  // IA inimigos: perseguir + melee + tiro
  for (const e of r.enemies) {
    const alivePlayers = Object.values(r.players).filter(p => p.alive);
    if (!alivePlayers.length) break;

    // escolhe alvo mais próximo
    let target = alivePlayers[0];
    let best = dist2(e.x, e.y, target.x, target.y);
    for (const p of alivePlayers) {
      const d = dist2(e.x, e.y, p.x, p.y);
      if (d < best) { best = d; target = p; }
    }

    const dx = target.x - e.x, dy = target.y - e.y;
    const d = Math.hypot(dx, dy) || 1;

    // move
    const speed = d < 140 ? 1.6 : 1.25;
    e.x = clamp(e.x + (dx / d) * speed, 18, MAP.w - 18);
    e.y = clamp(e.y + (dy / d) * speed, 18, MAP.h - 18);

    // melee
    if (d < 34) {
      target.hp -= 0.35;
      if (target.hp <= 0) { target.hp = 0; target.alive = false; r.msg = "Um jogador morreu"; }
    }

    // shoot
    e.cd = Math.max(0, e.cd - 1);
    if (d < 560 && e.cd === 0) {
      e.cd = 25;
      const vx = (dx / d) * 8.2;
      const vy = (dy / d) * 8.2;
      r.bullets.push({ x: e.x, y: e.y, vx, vy, from: "e", life: 95 });
    }
  }

  // bullets move + colisões
  for (let i = r.bullets.length - 1; i >= 0; i--) {
    const b = r.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    let dead = (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h);

    if (!dead && b.from === "e") {
      for (const p of Object.values(r.players)) {
        if (!p.alive) continue;
        if (dist2(b.x, b.y, p.x, p.y) < 20 * 20) {
          p.hp -= 10;
          if (p.hp <= 0) { p.hp = 0; p.alive = false; r.msg = "Um jogador morreu"; }
          dead = true;
          break;
        }
      }
    }

    if (!dead && String(b.from).startsWith("p:")) {
      for (const e of r.enemies) {
        if (dist2(b.x, b.y, e.x, e.y) < 20 * 20) {
          e.hp -= 22;
          dead = true;
          break;
        }
      }
    }

    if (dead) r.bullets.splice(i, 1);
  }

  // remove inimigos mortos
  r.enemies = r.enemies.filter(e => e.hp > 0);

  // pickup vida
  for (let i = r.lifes.length - 1; i >= 0; i--) {
    const l = r.lifes[i];
    for (const p of Object.values(r.players)) {
      if (!p.alive) continue;
      if (dist2(l.x, l.y, p.x, p.y) < (l.r + 18) ** 2) {
        p.hp = Math.min(p.max, p.hp + 45);
        r.lifes.splice(i, 1);
        break;
      }
    }
  }

  // win/lose
  const ids = Object.keys(r.players);
  const enoughPlayers = ids.length >= 2;
  const someoneDead = Object.values(r.players).some(p => p && !p.alive);

  let result = null;
  if (enoughPlayers && someoneDead) result = "LOSE";
  if (enoughPlayers && allAliveInDoor(r)) result = "WIN";

  broadcast(roomId, {
    t: "snapshot",
    map: { w: MAP.w, h: MAP.h, close: r.close, door: r.door },
    players: r.players,
    enemies: r.enemies,
    bullets: r.bullets,
    lifes: r.lifes,
    result,
    msg: r.msg || ""
  });
}

setInterval(() => {
  for (const [roomId, r] of ROOMS) tickRoom(roomId, r);
}, TICK_MS);

wss.on("connection", (ws) => {
  const playerId = rid();

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.t === "join") {
      const roomId = String(msg.room || "sala1").slice(0, 24);
      ws.roomId = roomId;
      ws.playerId = playerId;

      const r = roomGet(roomId);
      r.clients.set(ws, playerId);

      const cls = (msg.cls === "tank") ? "tank" : "soldier";
      const max = cls === "tank" ? 160 : 110;

      r.players[playerId] = {
        x: rand(260, 460),
        y: rand(260, 460),
        aimX: 1, aimY: 0,
        ix: 0, iy: 0,
        hp: max, max,
        alive: true,
        cls,
        name: String(msg.name || playerId).slice(0, 14)
      };

      ws.send(JSON.stringify({ t: "you", id: playerId, roomId }));
      r.msg = `${r.players[playerId].name} entrou`;
      return;
    }

    const roomId = ws.roomId;
    if (!roomId) return;
    const r = ROOMS.get(roomId);
    if (!r) return;
    const p = r.players[playerId];
    if (!p) return;

    if (msg.t === "input") {
      p.ix = clamp(Number(msg.ix) || 0, -1, 1);
      p.iy = clamp(Number(msg.iy) || 0, -1, 1);
      p.aimX = Number(msg.aimX) || p.aimX;
      p.aimY = Number(msg.aimY) || p.aimY;
      return;
    }

    if (msg.t === "shoot") {
      if (!p.alive) return;

      const ax = Number(msg.aimX) || p.aimX || 1;
      const ay = Number(msg.aimY) || p.aimY || 0;
      const len = Math.hypot(ax, ay) || 1;
      const dx = ax / len, dy = ay / len;

      const speed = (p.cls === "tank") ? 8.0 : 9.2;
      r.bullets.push({
        x: p.x + dx * 28,
        y: p.y + dy * 28,
        vx: dx * speed,
        vy: dy * speed,
        from: `p:${playerId}`,
        life: 75
      });
      return;
    }

    if (msg.t === "reset") {
      r.close = 0;
      r.enemies = [];
      r.bullets = [];
      r.lifes = [];
      r.startedAt = Date.now();
      r.msg = "Reset";
      for (const pp of Object.values(r.players)) {
        pp.hp = pp.max;
        pp.alive = true;
        pp.ix = 0; pp.iy = 0;
        pp.x = rand(260, 460);
        pp.y = rand(260, 460);
      }
      return;
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    if (!roomId) return;
    const r = ROOMS.get(roomId);
    if (!r) return;

    r.clients.delete(ws);
    delete r.players[playerId];
    r.msg = `${playerId} saiu`;

    if (r.clients.size === 0) ROOMS.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
