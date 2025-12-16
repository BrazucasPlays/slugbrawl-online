const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* ====== GAME CONFIG ====== */
const MAP = { w: 2200, h: 1400 };
const TICK_MS = 50; // 20Hz
const ROOMS = new Map();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hypot = Math.hypot;
const d2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
const id8 = () => Math.random().toString(36).slice(2, 10);

function newDoor() {
  return { x: rand(260, MAP.w - 260), y: rand(260, MAP.h - 260), r: 52, open: false };
}

function newRoom() {
  return {
    clients: new Map(),      // ws -> pid
    players: {},             // pid -> player
    bullets: [],             // bullets
    enemies: [],
    lifes: [],
    close: 0,                // closing border thickness
    startedAt: Date.now(),
    lastEnemyAt: 0,
    lastLifeAt: 0,
    door: newDoor(),
    result: null
  };
}

function getRoom(rid) {
  if (!ROOMS.has(rid)) ROOMS.set(rid, newRoom());
  return ROOMS.get(rid);
}

function broadcast(rid, payload) {
  const r = ROOMS.get(rid);
  if (!r) return;
  const msg = JSON.stringify(payload);
  for (const ws of r.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function spawnEnemy(r) {
  r.enemies.push({
    x: rand(220, MAP.w - 220),
    y: rand(220, MAP.h - 220),
    hp: 80,
    cd: 0,
    vx: 0,
    vy: 0
  });
}

function spawnLife(r) {
  r.lifes.push({ x: rand(240, MAP.w - 240), y: rand(240, MAP.h - 240), r: 16 });
}

function resetRoom(r) {
  r.bullets = [];
  r.enemies = [];
  r.lifes = [];
  r.close = 0;
  r.startedAt = Date.now();
  r.lastEnemyAt = 0;
  r.lastLifeAt = 0;
  r.door = newDoor();
  r.result = null;
  for (const p of Object.values(r.players)) {
    p.x = rand(320, 520);
    p.y = rand(320, 520);
    p.hp = p.max;
    p.alive = true;
    p.kills = 0;
    p.ix = 0; p.iy = 0;
    p.aimX = 1; p.aimY = 0;
    p.shootCD = 0;
  }
}

function tickRoom(rid, r) {
  const now = Date.now();
  if (Object.keys(r.players).length === 0) return;

  // closing zone starts after 3s
  if (now - r.startedAt > 3000) r.close = Math.min(560, r.close + 0.40);

  // spawns
  if (now - r.lastEnemyAt > 1200) { spawnEnemy(r); r.lastEnemyAt = now; }
  if (now - r.lastLifeAt > 3500) { spawnLife(r); r.lastLifeAt = now; }

  // players move + zone damage
  for (const p of Object.values(r.players)) {
    if (!p.alive) continue;

    const speed = p.cls === "tank" ? 2.25 : 2.9;

    let ix = clamp(p.ix || 0, -1, 1);
    let iy = clamp(p.iy || 0, -1, 1);
    const len = hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }

    p.x = clamp(p.x + ix * speed, 18, MAP.w - 18);
    p.y = clamp(p.y + iy * speed, 18, MAP.h - 18);

    // zone bounds
    const L = r.close, T = r.close;
    const R = MAP.w - r.close, B = MAP.h - r.close;
    if (p.x < L || p.x > R || p.y < T || p.y > B) {
      p.hp -= 0.55;
      if (p.hp <= 0) { p.hp = 0; p.alive = false; }
    }

    // door open condition: ANY player in room has >= 5 kills
    if (p.kills >= 5) r.door.open = true;

    // cooldown
    p.shootCD = Math.max(0, (p.shootCD || 0) - 1);
  }

  // enemies AI
  for (const e of r.enemies) {
    const alivePlayers = Object.values(r.players).filter(p => p.alive);
    if (!alivePlayers.length) break;

    // nearest
    let t = alivePlayers[0];
    let best = d2(e.x, e.y, t.x, t.y);
    for (const p of alivePlayers) {
      const dd = d2(e.x, e.y, p.x, p.y);
      if (dd < best) { best = dd; t = p; }
    }

    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const dist = hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;

    e.vx = ux * 1.25;
    e.vy = uy * 1.25;
    e.x = clamp(e.x + e.vx, 18, MAP.w - 18);
    e.y = clamp(e.y + e.vy, 18, MAP.h - 18);

    // melee
    if (dist < 36) {
      t.hp -= 0.65;
      if (t.hp <= 0) { t.hp = 0; t.alive = false; }
    }

    // shoot only close-ish
    e.cd = Math.max(0, e.cd - 1);
    if (dist < 420 && e.cd === 0) {
      e.cd = 35;
      r.bullets.push({
        x: e.x, y: e.y,
        vx: ux * 7.5, vy: uy * 7.5,
        from: "e",
        life: 90
      });
    }
  }

  // bullets
  for (let i = r.bullets.length - 1; i >= 0; i--) {
    const b = r.bullets[i];
    b.x += b.vx; b.y += b.vy; b.life--;

    let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h;

    if (!dead && b.from === "e") {
      for (const p of Object.values(r.players)) {
        if (!p.alive) continue;
        if (d2(b.x, b.y, p.x, p.y) < (22 * 22)) {
          p.hp -= 12;
          if (p.hp <= 0) { p.hp = 0; p.alive = false; }
          dead = true; break;
        }
      }
    }

    if (!dead && typeof b.from === "string" && b.from.startsWith("p:")) {
      for (const e of r.enemies) {
        if (d2(b.x, b.y, e.x, e.y) < (30 * 30)) { // hit maior => inimigo morre consistente
          e.hp -= 26;
          if (e.hp <= 0) {
            const owner = b.from.slice(2);
            if (r.players[owner]) r.players[owner].kills++;
          }
          dead = true; break;
        }
      }
    }

    if (dead) r.bullets.splice(i, 1);
  }
  r.enemies = r.enemies.filter(e => e.hp > 0);

  // lifes pickup
  for (let i = r.lifes.length - 1; i >= 0; i--) {
    const l = r.lifes[i];
    for (const p of Object.values(r.players)) {
      if (!p.alive) continue;
      if (d2(l.x, l.y, p.x, p.y) < (l.r + 18) ** 2) {
        p.hp = Math.min(p.max, p.hp + 55);
        r.lifes.splice(i, 1);
        break;
      }
    }
  }

  // results
  const alive = Object.values(r.players).filter(p => p.alive);
  r.result = null;

  if (alive.length === 0) r.result = { lose: true };

  // win: door open + all alive reach door
  if (!r.result && r.door.open && alive.length > 0) {
    const inside = alive.filter(p => d2(p.x, p.y, r.door.x, r.door.y) < (r.door.r + 22) ** 2);
    if (inside.length === alive.length) {
      // who killed more
      let winner = inside[0];
      for (const p of inside) if (p.kills > winner.kills) winner = p;
      r.result = { win: winner.id };
    }
  }

  if (!r.result && r.close >= 560) r.result = { lose: true };

  // snapshot
  broadcast(rid, {
    t: "snapshot",
    map: { w: MAP.w, h: MAP.h, close: r.close, door: r.door },
    players: r.players,
    enemies: r.enemies,
    bullets: r.bullets,
    lifes: r.lifes,
    result: r.result
  });
}

/* ====== LOOP ====== */
setInterval(() => {
  for (const [rid, r] of ROOMS.entries()) tickRoom(rid, r);
}, TICK_MS);

/* ====== WS ====== */
wss.on("connection", (ws) => {
  const pid = id8();
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === "join") {
      const rid = String(m.room || "sala1").slice(0, 24);
      ws.rid = rid;

      const r = getRoom(rid);
      r.clients.set(ws, pid);

      const cls = (m.cls === "tank") ? "tank" : "soldier";
      const max = (cls === "tank") ? 170 : 115;

      r.players[pid] = {
        id: pid,
        name: String(m.name || "Player").slice(0, 14),
        cls,
        x: rand(320, 520),
        y: rand(320, 520),
        ix: 0, iy: 0,
        aimX: 1, aimY: 0,
        hp: max, max,
        alive: true,
        kills: 0,
        shootCD: 0
      };

      ws.send(JSON.stringify({ t: "you", id: pid, room: rid }));
      return;
    }

    const r = ROOMS.get(ws.rid);
    if (!r) return;
    const p = r.players[pid];
    if (!p) return;

    if (m.t === "input") {
      p.ix = clamp(Number(m.ix) || 0, -1, 1);
      p.iy = clamp(Number(m.iy) || 0, -1, 1);

      // aim comes from client (usually direction of movement)
      const ax = Number(m.aimX);
      const ay = Number(m.aimY);
      if (Number.isFinite(ax) && Number.isFinite(ay) && (Math.abs(ax) + Math.abs(ay) > 0.01)) {
        const l = hypot(ax, ay) || 1;
        p.aimX = ax / l; p.aimY = ay / l;
      }
    }

    if (m.t === "shoot") {
      if (!p.alive) return;
      if (p.shootCD > 0) return;
      p.shootCD = (p.cls === "tank") ? 10 : 7;

      const ux = p.aimX || 1;
      const uy = p.aimY || 0;

      r.bullets.push({
        x: p.x + ux * 28,
        y: p.y + uy * 28,
        vx: ux * 8.2,
        vy: uy * 8.2,
        from: `p:${pid}`,
        life: 90
      });
    }

    if (m.t === "reset") {
      resetRoom(r);
    }
  });

  ws.on("close", () => {
    const r = ROOMS.get(ws.rid);
    if (!r) return;
    r.clients.delete(ws);
    delete r.players[pid];
    if (r.clients.size === 0) ROOMS.delete(ws.rid);
  });
});

// keep ws stable
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(process.env.PORT || 10000, () => {
  console.log("Servidor rodando na porta", process.env.PORT || 10000);
});
