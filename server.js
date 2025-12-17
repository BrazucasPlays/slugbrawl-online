
// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 1800, h: 1000 };
let rooms = {}; // Usar let para permitir limpeza total

const rand = (a,b)=>a+Math.random()*(b-a);
const dist = (a,b,c,d)=>Math.hypot(a-c,b-d);

function getRoom(id){
  if(!rooms[id]){
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
      const r = getRoom(rid);
      r.players[pid]={
        id:pid, name:m.name||"Player",
        x:rand(400,600), y:rand(400,600),
        hp:100, max:100, kills:0,
        ix:0, iy:0, alive: true, status: null, color: m.color || "#22c55e" 
      };
      ws.send(JSON.stringify({t:"you",id:pid, lastHp: 100})); 
      return;
    }

    if(m.t==="reset"){
      // ZERA TUDO NA SALA IMEDIATAMENTE
      if(rooms[rid]){
        rooms[rid].enemies = [];
        rooms[rid].bullets = [];
        rooms[rid].lifes = [];
        rooms[rid].zone = 0;
        rooms[rid].door = {x:rand(400,1400),y:rand(300,700),open:false};
        // Remove todos os players para forçar reconexão limpa
        rooms[rid].players = {};
      }
      delete rooms[rid]; 
      return;
    }

    const r = rooms[rid];
    if(!r) return;
    const p = r.players[pid];
    if(!p || !p.alive) return; 

    if(m.t==="move"){ p.ix=m.x; p.iy=m.y; }
    if(m.t==="shoot"){
      r.bullets.push({x:p.x, y:p.y, vx:m.ax*9, vy:m.ay*9, from:pid, life:80});
    }
  });

  ws.on("close",()=>{
    if(rid && pid && rooms[rid] && rooms[rid].players) delete rooms[rid].players[pid];
  });
});

setInterval(()=>{
  for(const rid in rooms){
    const r = rooms[rid];
    r.zone += 0.2; 

    // CORREÇÃO: Inimigos só nascem DENTRO da zona segura (não na área vermelha)
    if(Math.random()<0.03){
      r.enemies.push({
        x: rand(r.zone + 50, MAP.w - r.zone - 50),
        y: rand(r.zone + 50, MAP.h - r.zone - 50),
        hp:60, cd:0
      });
    }

    if(Math.random()<0.01){
      r.lifes.push({x:rand(300,1500),y:rand(300,700)});
    }

    for(const p of Object.values(r.players)){
      if(!p.alive) continue; 
      p.x += p.ix * 7; p.y += p.iy * 7; 
      if(p.x<r.zone || p.y<r.zone || p.x>MAP.w-r.zone || p.y>MAP.h-r.zone) p.hp -= 0.8; 
      if(p.hp<=0){ p.hp=0; p.alive=false; p.status='death'; }
      if(p.kills>=5) r.door.open=true;
      if(r.door.open && dist(p.x, p.y, r.door.x, r.door.y) < 30){ p.alive=false; p.status='victory'; }
    }

    for(const e of r.enemies){
      e.cd = Math.max(0, e.cd-1);
      let target=null, best=99999;
      for(const p of Object.values(r.players)){
        if(!p.alive) continue; 
        const d = dist(e.x,e.y,p.x,p.y);
        if(d<best){best=d; target=p;}
      }
      if(target && best < 300 && e.cd===0){ 
        e.cd=35;
        const dx=target.x-e.x, dy=target.y-e.y, L=Math.hypot(dx,dy)||1;
        r.bullets.push({x:e.x, y:e.y, vx:(dx/L)*7.5, vy:(dy/L)*7.5, from:"e", life:90});
      }
    }

    r.bullets.forEach(b=>{
      b.x+=b.vx; b.y+=b.vy; b.life--;
      if(b.from!=="e"){
        r.enemies.forEach(e=>{
          if(dist(b.x,b.y,e.x,e.y)<20){
            e.hp-=30; b.life=0;
            if(e.hp<=0 && r.players[b.from]) r.players[b.from].kills++;
          }
        });
      } else {
        for(const p of Object.values(r.players)){
          if(p.alive && dist(b.x,b.y,p.x,p.y)<18){ p.hp-=14; b.life=0; break; }
        }
      }
    });
    r.bullets = r.bullets.filter(b=>b.life>0);
    r.enemies = r.enemies.filter(e=>e.hp>0);
    r.lifes.forEach(l=>{
      for(const p of Object.values(r.players)){
        if(p.alive && dist(l.x,l.y,p.x,p.y)<25){ p.hp=Math.min(100,p.hp+40); l.dead=true; }
      }
    });
    r.lifes = r.lifes.filter(l=>!l.dead);
  }

  wss.clients.forEach(c=>{ if(c.readyState===1) c.send(JSON.stringify({t:"state",rooms})); });
},50);

server.listen(process.env.PORT||10000);
