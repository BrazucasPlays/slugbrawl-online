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

const MAP = { w: 2000, h: 1200 };
const ROOMS = new Map();

const rand = (a,b)=>a+Math.random()*(b-a);
const d2 = (ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;};

function getRoom(id){
  if(!ROOMS.has(id)){
    ROOMS.set(id,{
      players:{}, bullets:[], enemies:[], lifes:[],
      close:0, door:{x:rand(300,1700),y:rand(300,900),open:false}
    });
  }
  return ROOMS.get(id);
}

wss.on("connection", ws=>{
  let pid=null, rid=null;

  ws.on("message", raw=>{
    const m = JSON.parse(raw);

    if(m.t==="join"){
      rid=m.room||"sala1";
      pid=Math.random().toString(36).slice(2,8);
      const r=getRoom(rid);
      r.players[pid]={
        id:pid,name:m.name||"Player",cls:m.cls||"soldier",
        x:rand(400,600),y:rand(400,600),
        hp:120,max:120,ix:0,iy:0,aimX:1,aimY:0,kills:0
      };
      ws.send(JSON.stringify({t:"you",id:pid}));
      return;
    }

    const r=getRoom(rid);
    const p=r.players[pid];
    if(!p) return;

    if(m.t==="input"){
      p.ix=m.ix; p.iy=m.iy;
      if(m.aimX||m.aimY){p.aimX=m.aimX;p.aimY=m.aimY;}
    }

    if(m.t==="shoot"){
      r.bullets.push({
        x:p.x+p.aimX*26,y:p.y+p.aimY*26,
        vx:p.aimX*8,vy:p.aimY*8,from:pid,life:90
      });
    }

    if(m.t==="reset"){
      ROOMS.delete(rid);
    }
  });

  ws.on("close",()=>{
    if(rid&&pid){
      const r=getRoom(rid);
      delete r.players[pid];
    }
  });
});

setInterval(()=>{
  for(const r of ROOMS.values()){
    r.close=Math.min(500,r.close+0.25);

    if(Math.random()<0.02){
      r.enemies.push({x:rand(200,1800),y:rand(200,1000),hp:80});
    }
    if(Math.random()<0.01){
      r.lifes.push({x:rand(200,1800),y:rand(200,1000)});
    }

    for(const p of Object.values(r.players)){
      p.x+=p.ix*3; p.y+=p.iy*3;
      if(p.x<r.close||p.y<r.close||p.x>MAP.w-r.close||p.y>MAP.h-r.close){
        p.hp-=0.4;
      }
      if(p.kills>=5) r.door.open=true;
    }

    for(const b of r.bullets){
      b.x+=b.vx; b.y+=b.vy; b.life--;
      for(const e of r.enemies){
        if(d2(b.x,b.y,e.x,e.y)<900){
          e.hp-=25; b.life=0;
          if(e.hp<=0){
            if(r.players[b.from]) r.players[b.from].kills++;
          }
        }
      }
    }
    r.bullets=r.bullets.filter(b=>b.life>0);
    r.enemies=r.enemies.filter(e=>e.hp>0);

    for(const l of r.lifes){
      for(const p of Object.values(r.players)){
        if(d2(l.x,l.y,p.x,p.y)<900){
          p.hp=Math.min(p.max,p.hp+40);
          l.dead=true;
        }
      }
    }
    r.lifes=r.lifes.filter(l=>!l.dead);
  }
},50);

setInterval(()=>{
  for(const [rid,r] of ROOMS.entries()){
    const msg=JSON.stringify({t:"snap",r});
    wss.clients.forEach(ws=>{
      if(ws.readyState===1) ws.send(msg);
    });
  }
},50);

server.listen(process.env.PORT||10000,()=>{
  console.log("Servidor rodando");
});
