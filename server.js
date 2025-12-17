// server.js (Sem alterações desde a última correção, mas garantindo o alcance e o reset)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 1800, h: 1000 };
const rooms = {};

const rand = (a,b)=>a+Math.random()*(b-a);
const dist = (a,b,c,d)=>Math.hypot(a-c,b-d);

function getRoom(id){
  if(!rooms[id]){
    // NOVO MAPA É CRIADO AQUI (RESET TOTAL)
    rooms[id]={
      players:{},
      bullets:[],
      enemies:[],
      lifes:[],
      zone:0,
      door:{x:rand(400,1400),y:rand(300,700),open:false}
    };
  }
  return rooms[id];
}

wss.on("connection",ws=>{
  let pid=null, rid=null;

  ws.on("message",msg=>{
    const m = JSON.parse(msg);

    if(m.t==="join"){
      rid = m.room || "solo";
      pid = Math.random().toString(36).slice(2,7);
      const r = getRoom(rid); // Cria a sala se não existir

      r.players[pid]={
        id:pid,
        name:m.name||"Player",
        x:rand(400,600),
        y:rand(400,600),
        hp:100,
        max:100,
        kills:0, // KILLS ZERADAS NO NOVO JOGADOR
        ix:0, iy:0,
        alive: true,
        status: null,
        color: m.color || "#22c55e" 
      };
      ws.send(JSON.stringify({t:"you",id:pid, lastHp: 100})); 
      return;
    }

    const r = getRoom(rid);
    const p = r.players[pid];
    if(!p || !p.alive) return; 

    if(m.t==="move"){ p.ix=m.x; p.iy=m.y; }

    if(m.t==="shoot"){
      r.bullets.push({
        x:p.x, y:p.y,
        vx:m.ax*9, vy:m.ay*9,
        from:pid, life:80
      });
    }

    if(m.t==="reset"){
      // COMANDO CRÍTICO: DELETA A SALA. O PRÓXIMO JOIN CRIA UMA NOVA.
      delete rooms[rid];
      pid = null; 
      rid = null;
    }
  });

  ws.on("close",()=>{
    if(rid && pid){
      const r=getRoom(rid);
      if (r && r.players) {
        delete r.players[pid];
      }
    }
  });
});

setInterval(()=>{
  for(const r of Object.values(rooms)){
    r.zone += 0.2; 

    // Spawn de Inimigos e Vidas
    if(Math.random()<0.03){
      r.enemies.push({x:rand(200,1600),y:rand(200,800),hp:60,cd:0});
    }

    if(Math.random()<0.01){
      r.lifes.push({x:rand(300,1500),y:rand(300,700)});
    }

    for(const p of Object.values(r.players)){
      if(!p.alive) continue; 

      const moveFactor = Math.hypot(p.ix, p.iy);
      if (moveFactor > 1) { 
          p.ix /= moveFactor;
          p.iy /= moveFactor;
      }
      p.x += p.ix * 7; 
      p.y += p.iy * 7; 

      if(p.x<r.zone || p.y<r.zone || p.x>MAP.w-r.zone || p.y>MAP.h-r.zone){
        p.hp -= 0.8; 
      }

      if(p.hp<=0){
        p.hp=0;
        p.alive=false;
        p.status='death';
      }

      if(p.kills>=5) {
        r.door.open=true;
      }
      if(r.door.open && dist(p.x, p.y, r.door.x, r.door.y) < 30){
        p.alive=false;
        p.status='victory';
      }
    }

    // Lógica de Inimigos (Alcance 300)
    for(const e of r.enemies){
      e.cd = Math.max(0, e.cd-1);
      let target=null, best=99999;
      for(const p of Object.values(r.players)){
        if(p.hp<=0 || !p.alive) continue; 
        const d = dist(e.x,e.y,p.x,p.y);
        if(d<best){best=d; target=p;}
      }
      if(target && best < 300 && e.cd===0){ 
        e.cd=35;
        const dx=target.x-e.x, dy=target.y-e.y;
        const L=Math.hypot(dx,dy)||1;
        r.bullets.push({
          x:e.x, y:e.y,
          vx:(dx/L)*7.5,
          vy:(dy/L)*7.5,
          from:"e",
          life:90
        });
      }
    }

    // Lógica de Balas
    r.bullets.forEach(b=>{
      b.x+=b.vx; b.y+=b.vy; b.life--;

      if(b.from!=="e"){
        r.enemies.forEach(e=>{
          if(dist(b.x,b.y,e.x,e.y)<20){
            e.hp-=30; b.life=0;
            if(e.hp<=0 && r.players[b.from] && r.players[b.from].alive){
              r.players[b.from].kills++;
            }
          }
        });
      }

      if(b.from==="e"){
        for(const p of Object.values(r.players)){
          if(p.alive && dist(b.x,b.y,p.x,p.y)<18){ 
            p.hp-=14; b.life=0;
            if(p.hp<0) p.hp=0;
            break;
          }
        }
      }
    });

    r.bullets = r.bullets.filter(b=>b.life>0);
    r.enemies = r.enemies.filter(e=>e.hp>0);

    // Lógica de Vidas
    r.lifes.forEach(l=>{
      for(const p of Object.values(r.players)){
        if(p.alive && dist(l.x,l.y,p.x,p.y)<25){
          p.hp=Math.min(p.max,p.hp+40);
          l.dead=true;
        }
      }
    });
    r.lifes = r.lifes.filter(l=>!l.dead);
  }

  const snap={t:"state",rooms};
  wss.clients.forEach(c=>{
    if(c.readyState===1) c.send(JSON.stringify(snap));
  });
},50);

server.listen(process.env.PORT||10000,()=>console.log("Servidor ON"));

