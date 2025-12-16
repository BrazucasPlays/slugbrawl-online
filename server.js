const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAP = { w: 2200, h: 1400 };
const TICK_MS = 50;
const ROOMS = new Map();

const rand = (a,b)=>a+Math.random()*(b-a);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const d2=(ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy};
const rid=()=>Math.random().toString(36).slice(2,10);

function newDoor(){
  return {x:rand(260,MAP.w-260),y:rand(260,MAP.h-260),r:48,open:false};
}
function getRoom(id){
  if(!ROOMS.has(id)){
    ROOMS.set(id,{
      players:{},clients:new Map(),
      bullets:[],enemies:[],lifes:[],
      close:0,startedAt:Date.now(),
      lastEnemyAt:0,lastLifeAt:0,
      door:newDoor(),result:null
    });
  }
  return ROOMS.get(id);
}
function broadcast(roomId,data){
  const r=ROOMS.get(roomId); if(!r) return;
  const msg=JSON.stringify(data);
  for(const ws of r.clients.keys()){
    if(ws.readyState===WebSocket.OPEN) ws.send(msg);
  }
}

function spawnEnemy(r){
  r.enemies.push({x:rand(220,MAP.w-220),y:rand(220,MAP.h-220),hp:70,cd:0,vx:0,vy:0});
}
function spawnLife(r){
  r.lifes.push({x:rand(240,MAP.w-240),y:rand(240,MAP.h-240),r:14});
}

function tickRoom(roomId,r){
  const now=Date.now();

  if(Object.keys(r.players).length===0) return;

  if(now-r.startedAt>3000) r.close=Math.min(560,r.close+0.4);

  if(now-r.lastEnemyAt>1300){spawnEnemy(r);r.lastEnemyAt=now;}
  if(now-r.lastLifeAt>3500){spawnLife(r);r.lastLifeAt=now;}

  for(const p of Object.values(r.players)){
    if(!p.alive) continue;
    const sp=p.cls==="tank"?2.2:2.8;
    let ix=clamp(p.ix||0,-1,1), iy=clamp(p.iy||0,-1,1);
    const l=Math.hypot(ix,iy); if(l>1){ix/=l;iy/=l;}
    p.x=clamp(p.x+ix*sp,18,MAP.w-18);
    p.y=clamp(p.y+iy*sp,18,MAP.h-18);

    const L=r.close,T=r.close,R=MAP.w-r.close,B=MAP.h-r.close;
    if(p.x<L||p.x>R||p.y<T||p.y>B){
      p.hp-=0.45;
      if(p.hp<=0){p.hp=0;p.alive=false;}
    }
    if(p.kills>=5) r.door.open=true;
  }

  for(const e of r.enemies){
    const alive=Object.values(r.players).filter(p=>p.alive);
    if(!alive.length) break;

    let t=alive[0],best=d2(e.x,e.y,t.x,t.y);
    for(const p of alive){
      const dd=d2(e.x,e.y,p.x,p.y);
      if(dd<best){best=dd;t=p;}
    }

    const dx=t.x-e.x, dy=t.y-e.y;
    const dist=Math.hypot(dx,dy)||1;
    const ux=dx/dist, uy=dy/dist;
    e.vx=ux*1.25; e.vy=uy*1.25;
    e.x=clamp(e.x+e.vx,18,MAP.w-18);
    e.y=clamp(e.y+e.vy,18,MAP.h-18);

    if(dist<36){
      t.hp-=0.45;
      if(t.hp<=0){t.hp=0;t.alive=false;}
    }

    e.cd=Math.max(0,e.cd-1);
    if(dist<420 && e.cd===0){
      e.cd=35;
      r.bullets.push({x:e.x,y:e.y,vx:ux*7,vy:uy*7,from:"e",life:85});
    }
  }

  for(let i=r.bullets.length-1;i>=0;i--){
    const b=r.bullets[i];
    b.x+=b.vx; b.y+=b.vy; b.life--;
    let dead=b.life<=0||b.x<0||b.y<0||b.x>MAP.w||b.y>MAP.h;

    if(!dead && b.from==="e"){
      for(const p of Object.values(r.players)){
        if(!p.alive) continue;
        if(d2(b.x,b.y,p.x,p.y)<20*20){
          p.hp-=10;
          if(p.hp<=0){p.hp=0;p.alive=false;}
          dead=true; break;
        }
      }
    }

    if(!dead && b.from?.startsWith("p:")){
      for(const e of r.enemies){
        if(d2(b.x,b.y,e.x,e.y)<28*28){ // HIT MAIOR (CORRIGE “não morre”)
          e.hp-=22;
          if(e.hp<=0){
            const owner=b.from.split(":")[1];
            if(r.players[owner]) r.players[owner].kills++;
          }
          dead=true; break;
        }
      }
    }

    if(dead) r.bullets.splice(i,1);
  }
  r.enemies=r.enemies.filter(e=>e.hp>0);

  for(let i=r.lifes.length-1;i>=0;i--){
    const l=r.lifes[i];
    for(const p of Object.values(r.players)){
      if(!p.alive) continue;
      if(d2(l.x,l.y,p.x,p.y)<(l.r+18)**2){
        p.hp=Math.min(p.max,p.hp+45);
        r.lifes.splice(i,1); break;
      }
    }
  }

  const alive=Object.values(r.players).filter(p=>p.alive);
  r.result=null;
  if(alive.length===0) r.result={lose:true};

  if(!r.result && r.door.open && alive.length){
    const inDoor=alive.filter(p=>d2(p.x,p.y,r.door.x,r.door.y)<(r.door.r+22)**2);
    if(inDoor.length===alive.length){
      let win=inDoor[0];
      for(const p of inDoor) if(p.kills>win.kills) win=p;
      r.result={win:win.id};
    }
  }
  if(!r.result && r.close>=560) r.result={lose:true};

  broadcast(roomId,{
    t:"snapshot",
    map:{w:MAP.w,h:MAP.h,close:r.close,door:r.door},
    players:r.players,enemies:r.enemies,bullets:r.bullets,lifes:r.lifes,
    result:r.result
  });
}

setInterval(()=>{for(const [id,r] of ROOMS) tickRoom(id,r);},TICK_MS);

wss.on("connection",(ws)=>{
  const id=rid();

  ws.on("message",(raw)=>{
    let m; try{m=JSON.parse(raw);}catch{return;}

    if(m.t==="join"){
      const roomId=String(m.room||"sala1").slice(0,24);
      ws.roomId=roomId; ws.playerId=id;
      const r=getRoom(roomId);
      r.clients.set(ws,id);

      const cls=m.cls==="tank"?"tank":"soldier";
      const max=cls==="tank"?160:110;

      r.players[id]={
        id,
        name:(m.name||"Player").slice(0,14),
        cls,
        x:rand(320,520),y:rand(320,520),
        ix:0,iy:0,aimX:1,aimY:0,
        hp:max,max,
        alive:true,kills:0,shootCD:0
      };

      ws.send(JSON.stringify({t:"you",id,roomId}));
      return;
    }

    const r=ROOMS.get(ws.roomId); if(!r) return;
    const p=r.players[id]; if(!p) return;

    if(m.t==="input"){
      p.ix=clamp(Number(m.ix)||0,-1,1);
      p.iy=clamp(Number(m.iy)||0,-1,1);
      p.aimX=Number(m.aimX)||p.aimX;
      p.aimY=Number(m.aimY)||p.aimY;
    }

    if(m.t==="shoot" && p.alive){
      if(p.shootCD>0) return;
      p.shootCD=(p.cls==="tank")?10:7;

      const l=Math.hypot(p.aimX,p.aimY)||1;
      const ux=p.aimX/l, uy=p.aimY/l;

      r.bullets.push({
        x:p.x+ux*28,y:p.y+uy*28,
        vx:ux*8,vy:uy*8,       // velocidade levemente menor (acerto consistente)
        from:`p:${id}`,life:80
      });
    }

    if(m.t==="reset"){
      r.bullets=[]; r.enemies=[]; r.lifes=[];
      r.close=0; r.startedAt=Date.now(); r.door=newDoor(); r.result=null;
      for(const pp of Object.values(r.players)){
        pp.hp=pp.max; pp.alive=true; pp.kills=0;
        pp.x=rand(320,520); pp.y=rand(320,520);
        pp.ix=0; pp.iy=0; pp.aimX=1; pp.aimY=0; pp.shootCD=0;
      }
    }
  });

  ws.on("close",()=>{
    const r=ROOMS.get(ws.roomId); if(!r) return;
    r.clients.delete(ws); delete r.players[id];
    if(r.clients.size===0) ROOMS.delete(ws.roomId);
  });
});

setInterval(()=>{
  for(const r of ROOMS.values()){
    for(const p of Object.values(r.players)){
      p.shootCD=Math.max(0,(p.shootCD||0)-1);
    }
  }
},TICK_MS);

server.listen(process.env.PORT||10000,()=>console.log("Servidor rodando"));
