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

const MAP = { w: 1600, h: 1000 };
const ROOMS = {};

function rand(a,b){return a+Math.random()*(b-a);}
function dist2(a,b,c,d){const x=a-c,y=b-d;return x*x+y*y;}
function room(id){
  if(!ROOMS[id]){
    ROOMS[id]={
      players:{}, bullets:[], enemies:[],
      door:{x:rand(300,1300),y:rand(300,700),open:false}
    };
  }
  return ROOMS[id];
}

wss.on("connection", ws=>{
  let pid=null, rid=null;

  ws.on("message", raw=>{
    const m=JSON.parse(raw);

    if(m.t==="join"){
      rid=m.room||"sala1";
      pid=Math.random().toString(36).slice(2,8);
      const r=room(rid);
      r.players[pid]={
        id:pid,name:m.name||"Player",
        x:rand(200,400),y:rand(200,400),
        hp:100,kills:0,ix:0,iy:0
      };
      ws.send(JSON.stringify({t:"you",id:pid}));
      return;
    }

    const r=room(rid);
    const p=r.players[pid];
    if(!p) return;

    if(m.t==="input"){p.ix=m.ix;p.iy=m.iy;}
    if(m.t==="shoot"){
      r.bullets.push({x:p.x,y:p.y,vx:10,vy:0,from:pid});
    }
  });

  ws.on("close",()=>{
    if(rid&&pid) delete room(rid).players[pid];
  });
});

setInterval(()=>{
  for(const r of Object.values(ROOMS)){
    for(const p of Object.values(r.players)){
      p.x+=p.ix*4; p.y+=p.iy*4;
    }
    for(const b of r.bullets){
      b.x+=b.vx;
    }
  }
},50);

setInterval(()=>{
  for(const [rid,r] of Object.entries(ROOMS)){
    const snap={t:"snap",r};
    wss.clients.forEach(ws=>{
      if(ws.readyState===1) ws.send(JSON.stringify(snap));
    });
  }
},50);

server.listen(process.env.PORT||10000,()=>{
  console.log("Servidor rodando");
});
