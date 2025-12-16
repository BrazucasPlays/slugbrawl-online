const express=require("express");
const http=require("http");
const WebSocket=require("ws");
const path=require("path");

const app=express();
app.use(express.static("public"));
const server=http.createServer(app);
const wss=new WebSocket.Server({server});

const MAP={w:1600,h:900};
let players={},bullets=[],enemies=[],lifes=[],door={x:800,y:450,open:false},zone=0;

function rnd(a,b){return a+Math.random()*(b-a);}
function dist(a,b,c,d){return Math.hypot(a-c,b-d);}

wss.on("connection",ws=>{
  let id=Math.random().toString(36).slice(2,7);
  players[id]={id,x:rnd(300,600),y:rnd(300,600),hp:100,kills:0,ix:0,iy:0};
  ws.send(JSON.stringify({t:"id",id}));

  ws.on("message",msg=>{
    let m=JSON.parse(msg);
    let p=players[id];
    if(!p) return;

    if(m.t==="move"){p.ix=m.x;p.iy=m.y;}
    if(m.t==="shoot"){
      bullets.push({x:p.x,y:p.y,vx:m.ax*8,vy:m.ay*8,from:id});
    }
    if(m.t==="reset"){players={};bullets=[];enemies=[];lifes=[];zone=0;door.open=false;}
  });

  ws.on("close",()=>delete players[id]);
});

setInterval(()=>{
  zone+=0.1;
  if(Math.random()<0.03) enemies.push({x:rnd(100,1500),y:rnd(100,800),hp:50});
  if(Math.random()<0.01) lifes.push({x:rnd(200,1400),y:rnd(200,700)});

  for(let p of Object.values(players)){
    p.x+=p.ix*3; p.y+=p.iy*3;
    if(p.x<zone||p.y<zone||p.x>MAP.w-zone||p.y>MAP.h-zone) p.hp-=0.3;
    if(p.kills>=5) door.open=true;
  }

  bullets.forEach(b=>{
    b.x+=b.vx; b.y+=b.vy;
    enemies.forEach(e=>{
      if(dist(b.x,b.y,e.x,e.y)<20){
        e.hp-=25; b.dead=true;
        if(e.hp<=0 && players[b.from]) players[b.from].kills++;
      }
    });
  });

  bullets=bullets.filter(b=>!b.dead);
  enemies=enemies.filter(e=>e.hp>0);

  lifes.forEach(l=>{
    for(let p of Object.values(players)){
      if(dist(l.x,l.y,p.x,p.y)<25){p.hp=Math.min(100,p.hp+30); l.dead=true;}
    }
  });
  lifes=lifes.filter(l=>!l.dead);

  let state={t:"state",players,enemies,bullets,lifes,door,zone};
  wss.clients.forEach(c=>c.readyState===1&&c.send(JSON.stringify(state)));
},50);

server.listen(process.env.PORT||10000,()=>console.log("Rodando"));
