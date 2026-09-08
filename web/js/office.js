/* Sprite loading + draw helpers. Needs canvas ctx/S/frame from office.js. */
"use strict";

const CHAR_FW=16, CHAR_FH=32, CHAR_ROWS=3, CHAR_COLS=7;
const charSheets=[];
const decorImg={};
const npcImg={};

function charScale(){ return Math.max(2, Math.floor(S/2)); }

function opaqueBox(im){
  if(im._box) return im._box;
  const nw=im.naturalWidth, nh=im.naturalHeight;
  const c=document.createElement("canvas"); c.width=nw; c.height=nh;
  const g=c.getContext("2d"); g.drawImage(im,0,0);
  const d=g.getImageData(0,0,nw,nh).data;
  let minx=nw,miny=nh,maxx=0,maxy=0;
  for(let y=0;y<nh;y++) for(let x=0;x<nw;x++){
    if(d[(y*nw+x)*4+3]>12){ if(x<minx)minx=x; if(y<miny)miny=y; if(x>maxx)maxx=x; if(y>maxy)maxy=y; }
  }
  if(maxx<minx) return im._box={sx:0,sy:0,sw:nw,sh:nh};
  return im._box={sx:minx,sy:miny,sw:maxx-minx+1,sh:maxy-miny+1};
}

(function loadCharSheets(){
  for(let i=0;i<6;i++){
    const img=new Image();
    img.onload=()=>{
      if(img.naturalWidth!==112||img.naturalHeight!==96){
        console.warn("agent-office: bad char sheet char_"+i+".png "+
          img.naturalWidth+"x"+img.naturalHeight+" (want 112x96)");
        return;
      }
      const rows=[];
      for(let r=0;r<CHAR_ROWS;r++){
        const frames=[];
        for(let f=0;f<CHAR_COLS;f++){
          const c=document.createElement("canvas");c.width=CHAR_FW;c.height=CHAR_FH;
          c.getContext("2d").drawImage(img,f*CHAR_FW,r*CHAR_FH,CHAR_FW,CHAR_FH,0,0,CHAR_FW,CHAR_FH);
          frames.push(c);
        }
        rows.push(frames);
      }
      charSheets[i]={down:rows[0],up:rows[1],right:rows[2]};
    };
    img.src="assets/sprites/characters/char_"+i+".png";
  }
})();

DECOR_FILES.forEach(p=>{
  const im=new Image();
  im.src="assets/sprites/"+p;
  decorImg[p.split("/").pop().replace(".png","")]=im;
});
NPC_FILES.forEach(n=>{
  const im=new Image();
  im.src="assets/sprites/npcs/"+n+".png";
  npcImg[n]=im;
});

function spriteFor(a){
  const loaded=charSheets.filter(s=>s&&s.down&&s.down[0]);
  if(!loaded.length)return null;
  const sheet=loaded[hash(a.id)%loaded.length];
  if(!sheet)return null;
  if(!seatedNow(a)){
    const f=1+((frame>>3)%6);
    const face=(typeof chars!=="undefined"&&chars.get(a.id)&&chars.get(a.id).face)||"down";
    if(face==="up")return {cv:sheet.up[f],flip:false};
    if(face==="down")return {cv:sheet.down[f],flip:false};
    return {cv:sheet.right[f],flip:face==="left"};
  }
  return {cv:sheet.down[0],flip:false};
}

function drawDecorImg(name,dx,dy,dw,dh){
  const im=decorImg[name];
  if(!(im&&im.complete&&im.naturalWidth>0)) return false;
  ctx.imageSmoothingEnabled=false;
  const boxW=Math.max(1,dw*S), boxH=Math.max(1,dh*S);
  const boxX=dx*S, boxY=dy*S;
  if(im.naturalWidth===96&&im.naturalHeight===96){
    const fw=16,fh=32;
    const sc=Math.max(1, Math.floor(Math.min(boxW/fw, boxH/fh)));
    const pw=fw*sc, ph=fh*sc;
    const px0=Math.round(boxX + (boxW-pw)/2), py0=Math.round(boxY + boxH - ph);
    ctx.drawImage(im,0,0,fw,fh,px0,py0,pw,ph);
    return true;
  }
  const bb=opaqueBox(im);
  const sc=Math.max(1, Math.floor(Math.min(boxW/bb.sw, boxH/bb.sh)));
  const pw=bb.sw*sc, ph=bb.sh*sc;
  const px0=Math.round(boxX + (boxW-pw)/2), py0=Math.round(boxY + boxH - ph);
  ctx.drawImage(im,bb.sx,bb.sy,bb.sw,bb.sh,px0,py0,pw,ph);
  return true;
}

function drawLogo(plat,x,y){
  if(plat==="opencode"){
    px(x,y,5,4,"#0d3b2e"); px(x+1,y+1,1,2,"#5fce7a"); px(x+2,y+2,2,1,"#5fce7a"); px(x+4,y+3,1,1,"#4aa860");
  }else if(plat==="telegram"){
    px(x,y+1,5,2,"#4fa4d8"); px(x+3,y,2,1,"#a8d4f0"); px(x+4,y+2,1,1,"#2b6fa8");
  }else if(plat==="claude"){
    px(x+2,y,1,4,"#d97746"); px(x,y+2,5,1,"#d97746"); px(x+1,y+1,3,1,"#ff8c5a"); px(x+2,y+2,1,1,"#ff8c5a");
  }else if(plat==="cli"){
    px(x,y,5,4,"#191524"); px(x+1,y+1,1,1,"#5fce7a"); px(x+2,y+2,1,1,"#5fce7a"); px(x+3,y+3,2,1,"#5fce7a");
  }else{
    px(x+2,y,1,4,"#e8c170"); px(x,y+1,5,1,"#e8c170"); px(x,y+3,5,1,"#e8c170");
  }
}

function drawNpcSprite(v, px0, py0){
  const k=v.kind;
  const cs=charScale();
  const dw=20*cs, dh=30*cs;
  const dx=Math.round(px0-dw/2), dy=Math.round(py0-dh);
  ctx.imageSmoothingEnabled=false;
  ctx.fillStyle="rgba(0,0,0,0.28)";
  ctx.fillRect(dx+4*cs, py0-cs, 8*cs, cs);
  const im=npcImg[k.sprite];
  const flip=v.face==="left";
  if(im&&im.complete&&im.naturalWidth){
    if(flip){
      ctx.save(); ctx.translate(dx+dw,0); ctx.scale(-1,1);
      ctx.drawImage(im,0,0,im.naturalWidth,im.naturalHeight, 0, dy, dw, dh);
      ctx.restore();
    }else{
      ctx.drawImage(im,0,0,im.naturalWidth,im.naturalHeight, dx, dy, dw, dh);
    }
  }else{
    ctx.fillStyle=k.id==="mail"?"#4fa4d8":k.id==="cleaner"?"#8fbf6f":"#c98fd8";
    ctx.fillRect(dx+4*cs, dy+10*cs, 8*cs, 14*cs);
    ctx.fillStyle="#e8c49a";
    ctx.fillRect(dx+5*cs, dy+2*cs, 6*cs, 8*cs);
  }
  if(k.box){
    const pk=decorImg.PACKAGE;
    const psz=6*cs;
    if(pk&&pk.complete&&pk.naturalWidth)
      ctx.drawImage(pk,0,0,pk.naturalWidth,pk.naturalHeight, dx+dw-3*cs, dy+16*cs, psz, psz);
    else { ctx.fillStyle="#c4894a"; ctx.fillRect(dx+dw-3*cs, dy+16*cs, psz, psz); }
  }
  return {dx, dy, dw, dh};
}


"use strict";
const IN_VSCODE = typeof acquireVsCodeApi !== "undefined";
const vsapi = IN_VSCODE ? acquireVsCodeApi() : null;
const cv = document.getElementById("c"), ctx = cv.getContext("2d");
let S = 4, agents = [], progress = null, frame = 0, offline = null, platFilter = "every";
let trackQuery = "";
const seenUnlocks = new Set();
try{ (JSON.parse(localStorage.getItem("pixelOfficeSeen")||"[]")||[]).forEach(id=>seenUnlocks.add(id)); }catch(e){}
let focusedId = null;
const _events = [];
const MAX_EVENTS = 20;

const SKIN=["#f0c8a0","#c68b59","#8d5524","#ffdbac","#e0ac69","#a1665e","#f5d0c5","#6d3b2a"];
const SHIRT=["#4fa4d8","#d84f6f","#5fce7a","#c9a227","#9b6fd8","#d87f4f","#3d6b8a","#e8c170"];
const HAIR=["#2b2b2b","#5a3825","#c9a227","#8a8a8a","#7a3030","#4a6741","#1a1a22","#d8c4a0"];
function hash(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0}return Math.abs(h)}
function px(x,y,w,h,col){ctx.fillStyle=col;ctx.fillRect(Math.round(x*S),Math.round(y*S),w*S,h*S)}
function mix(a,b,t){
  const pa=[1,3,5].map(i=>parseInt(a.substr(i,2),16));
  const pb=[1,3,5].map(i=>parseInt(b.substr(i,2),16));
  return "#"+pa.map((v,i)=>Math.round(v*(1-t)+pb[i]*t).toString(16).padStart(2,"0")).join("");
}
function lighten(hex){return mix(hex,"#ffffff",0.13)}
function darken(hex){return mix(hex,"#000000",0.15)}
function night(){ if(window._nightOverride!==null&&window._nightOverride!==undefined)return window._nightOverride; const h=new Date().getHours();return h<6||h>=19}
function seatedNow(a){return a.status!=="gone"&&a.status!=="walking"}
function platOf(a){
  const p=String((a&&a.platform)||"").toLowerCase();
  const lab=String((a&&a.label)||"").toLowerCase();
  const s=p+" "+lab;
  if(s.includes("opencode")) return "opencode";
  if(s.includes("telegram")) return "telegram";
  if(s.includes("claude")) return "claude";
  if(p==="cli"||lab.startsWith("cli")) return "cli";
  if(p==="subagent") return "hermes";
  return "hermes";
}
function trackMatch(a){
  if(!trackQuery) return true;
  const q = trackQuery.toLowerCase();
  return ((a.label||"")+" "+(a.status||"")+" "+(a.tool||"")+" "+(a.detail||"")+" "+(a.platform||"")+" "+(a.id||"")).toLowerCase().includes(q);
}
function shown(){
  if(platFilter==="every") return agents;
  if(platFilter==="hermes") return agents.filter(a=>platOf(a)==="hermes"||platOf(a)==="cli");
  return agents.filter(a=>platOf(a)===platFilter);
}

let _gw=0,_gh=0;
let petBounce=false, petTimer=0;
let soundOn=false, audioCtx=null;
try{soundOn=localStorage.getItem("pixelOfficeSound")==="1"}catch(e){}
let settings = {layout:"open",theme:"default",sound:soundOn,max_chars:4};
function haveUnlock(id){return progress && (progress.catalog||[]).find(c=>c.id===id&&c.have)}
const _DEFAULTS = Object.keys(settings);

function drawPixelSign(x,y){
  const on = night() ? "#ff6ad5" : "#e8c170";
  px(x,y,15,7,"#151022");
  px(x,y+6,15,1,"#3a2f4b");
  const blit=(ox,oy,rows)=>{
    rows.forEach((row,i)=>{ for(let j=0;j<row.length;j++) if(row[j]==="1") px(x+ox+j,y+oy+i,1,1,on); });
  };
  blit(2,1,["01110","10001","11111","10001","10001"]);
  blit(8,1,["01110","10001","10001","10001","01110"]);
}

function drawOffice(w,h,cosmetics){
  cosmetics=cosmetics||window._cosmetics||[];
  const dark=night();
  const themeObj = window._theme || {};
  const geom = LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  const tileA = themeObj.tileA||geom.floor[0];
  const tileB = themeObj.tileB||geom.floor[1];
  const wall  = themeObj.wall||geom.wall;
  const trim  = darken(wall);
  const decor = geom.decor || "open";
  for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2)
    px(x,y,2,2,((x+y)/2)%2?tileA:tileB);
  px(0,0,w,10,wall);
  px(0,10,w,1,trim);

  if(!drawDecorImg("DOOR", 1, 0, 10, 14)){
    px(2,1,7,9,"#5a3a1f"); px(3,2,5,7,"#7a5028"); px(4,3,3,5,"#3c2814");
    px(8,6,1,1,"#e8c170");
  }
  drawDecorImg("CLOCK", 12, 2, 5, 5);

  const signX=Math.max(22, Math.min(w-20, Math.floor(w*0.42)));
  for(let x=19;x<w-10;x+=20){
    if(x<signX+18 && x+12>signX-1) continue;
    px(x,2,12,6,"#151022");
    if(dark){
      px(x+1,3,10,4,"#151a33");
      if((frame>>4)%2)px(x+3,4,1,1,"#e8e0c8");
      if((x/20|0)%2)px(x+8,3,1,1,"#fff8c8");
    }else{
      px(x+1,3,10,4,"#7fa8d8"); px(x+2,3,3,1,"#c8dff8");
    }
    px(x,2,1,6,trim); px(x+11,2,1,6,trim); px(x,7,12,1,trim);
    if(dark && (frame>>5)%2===0){
      ctx.globalAlpha=0.10;
      px(x-2,11,16,4,"#e8c170");
      ctx.globalAlpha=1;
    }
  }
  drawPixelSign(signX, 2);

  const plantX=11, plantY=Math.max(30, h-20);
  drawDecorImg("BOOKSHELF", 2, h-26, 7, 16);
  if(!drawDecorImg("LARGE_PLANT", plantX-1, plantY-10, 7, 13)){
    px(plantX,plantY,4,2,"#4aa860"); px(plantX-1,plantY-2,3,3,"#5fce7a");
    px(plantX+1,plantY+2,2,4,"#8d5524"); px(plantX,plantY+6,4,1,"#54381f");
  }

  const kx=w-26;
  px(kx,h-10,22,1,"#6b4a2f"); px(kx,h-9,22,3,"#54381f");
  if(!drawDecorImg("COFFEE", kx, h-22, 8, 12)){
    px(kx+2,h-19,5,3,"#33283f"); px(kx+3,h-19,1,1,"#d84f6f");
  }
  if((frame>>3)%7<5){
    const ph=(frame>>3)%3, sx=kx+4, sy=h-23;
    if(ph===0)px(sx,sy,1,1,"#c8c8d8");
    else if(ph===1){px(sx-1,sy-1,1,1,"#b8b8cc");px(sx+1,sy,1,1,"#c8c8d8");}
    else {px(sx,sy-2,1,1,"#a8a8c0");}
  }
  if(!drawDecorImg("WATER_COOLER", kx+9, h-22, 6, 12)){
    px(kx+10,h-19,3,3,"#7fa8d8"); px(kx+10,h-16,3,1,"#4a4a5a");
  }
  drawDecorImg("LAMP", kx+16, h-18, 6, 8);

  if(decor==="bullpen"){
    drawDecorImg("BIN", Math.floor(w/2)-2, h-9, 4, 5);
    drawDecorImg("CACTUS", 10, h-18, 5, 10);
  }

  if(cosmetics.includes("fish_tank")){
    drawDecorImg("FISH_TANK", w-22, h-8, 10, 7);
  }
  if(cosmetics.includes("office_cat")){
    drawDecorImg("sleep_cat", kx-9, h-8, 8, 5);
  }
  drawDecorImg("claudio_idle", kx-4, h-16, 6, 10);
  if(haveUnlock("pet_dog")){
    drawDecorImg("gitcat_idle", 18, h-16, 6, 10);
  }
  if(petBounce){petTimer--; if(petTimer<=0)petBounce=false;}

  if(dark){
    ctx.fillStyle="rgba(8,6,20,0.42)";
    ctx.fillRect(0,0,w*S,h*S);
    ctx.globalCompositeOperation="lighter";
    const pool=(x,y,r,c)=>{
      const g=ctx.createRadialGradient(x*S,y*S,1,x*S,y*S,r*S);
      g.addColorStop(0,c); g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=g; ctx.fillRect(x*S-r*S,y*S-r*S,2*r*S,2*r*S);
    };
    const flick=(frame>>3)%5===0?0.8:1;
    pool(signX+8,5,26,"rgba(232,120,200,"+(0.22*flick)+")");
    pool(w-17,h-14,20,"rgba(255,190,90,0.20)");
    pool(plantX+2,plantY,12,"rgba(120,220,150,0.10)");
    for(const d of (window._deskAnchors||[])){ pool(d[0]+4,d[1]-2,14,"rgba(110,180,255,0.14)"); }
    ctx.globalCompositeOperation="source-over";
  }
}

function drawDesk(x,y,a,cosmetics,frontOnly){
  const gold=cosmetics.includes("gold_monitor");
  let h=0; for(const c of a.id) h=(h*31+c.charCodeAt(0))>>>0;
  const finishes=[
    {top:"#c4894a",slab:"#8d5524",front:"#6b3e1c",leg:"#3c2814",edge:"#e8c170"},
    {top:"#d4a05a",slab:"#b08040",front:"#8d6530",leg:"#4a3420",edge:"#f0d090"},
    {top:"#6a5a7a",slab:"#4a3a5a",front:"#2c2138",leg:"#1e1628",edge:"#9b8ab0"},
  ];
  const fin = finishes[h % finishes.length];
  if(!frontOnly){
    px(x+2,y+8,7,1,fin.leg);
    px(x+2,y+9,1,6,fin.leg); px(x+8,y+9,1,6,fin.leg);
    px(x+3,y+14,5,2,fin.front);
    px(x+1,y+17,2,3,fin.leg); px(x+15,y+17,2,3,fin.leg);
  }
  px(x,y+11,18,1,fin.edge);
  px(x,y+12,18,2,fin.top);
  px(x,y+14,18,3,fin.slab);
  px(x,y+17,18,1,fin.front);
  px(x+3,y+12,7,2,"#2a2438"); px(x+4,y+12,5,1,"#4a4460");
  px(x+11,y+3,7,8, gold?"#5a4010":"#0c0a12");
  px(x+12,y+4,5,6, gold?"#c9a227":"#1a3d28");
  px(x+13,y+11,3,1,"#4a4a5a");
  px(x+12,y+12,5,1,"#3a3a48");
  if(cosmetics.includes("mug")){px(x+10,y+10,2,2,"#d84f6f");px(x+12,y+10,1,1,"#d84f6f")}
  if(cosmetics.includes("fern")){px(x+1,y+8,1,1,"#3a7a4a");px(x,y+9,3,1,"#5fce7a");px(x,y+11,3,1,"#8d5524")}
  else if(cosmetics.includes("plant")){px(x+1,y+9,2,3,"#5fce7a");px(x+1,y+12,2,1,"#8d5524")}
}

function deskScreen(x,y,a){
  const t=frame>>3;
  let col="#3ecf6a";
  if(a){
    if(a.activity==="running")col=(t%4<2)?"#5fce7a":"#2a8a44";
    else if(a.activity==="browsing")col=(t%6<3)?"#6ab0ff":"#3a70c0";
    else if(a.activity==="typing")col=(t%2)?"#b8ff9a":"#3ecf6a";
    else if(a.status==="waiting")col="#d84f6f";
    else if(a.status==="idle")col="#1a4a30";
  }
  px(x+12,y+4,5,6,col);
}
function drawHealthBar(a,x,y){
  if(focusedId !== a.id) return;
  const fill = a.status==="working"?0.6:a.status==="thinking"?0.4:
               a.status==="waiting"?0.1:a.status==="done"?1.0:0.2;
  const col = a.status==="waiting"?"#d84f6f":
              a.status==="working"?"#5fce7a":
              a.status==="done"?"#9b6fd8":"#c9a227";
  ctx.fillStyle="#1a1423";
  ctx.fillRect(x*S, (y-2)*S, 18*S, 2*S);
  ctx.fillStyle=col;
  ctx.fillRect(x*S, (y-2)*S, Math.max(1,18*fill)*S, 2*S);
}
function drawChar(a,fx,fy,seated,cosmetics){
  cosmetics=cosmetics||[];
  const h=hash(a.id), skin=SKIN[h%SKIN.length], shirt=SHIRT[(h>>3)%SHIRT.length],
        hair=HAIR[(h>>6)%HAIR.length], t=frame>>4;
  const walking=!seated, bob=(walking&&(t%2))?1:0;
  const x=fx, y=fy+bob;
  if(a.status==="gone")ctx.globalAlpha=0.35;
  const spr=spriteFor(a);
  if(spr){
    ctx.fillStyle="rgba(0,0,0,0.30)";
    const cs = charScale();
    ctx.fillRect(Math.round((x+1)*S), Math.round((y+14)*S), 8*cs, 1*cs);
    ctx.imageSmoothingEnabled=false;
    const sx0 = Math.round((x+1)*S), sy0 = Math.round((y+12)*S - CHAR_FH*cs);
    if(cosmetics.includes("cape") && walking){
      ctx.fillStyle="rgba(122,48,48,0.88)";
      ctx.fillRect(sx0+1*cs, sy0+14*cs, 2*cs, 12*cs);
    }
    const pw=CHAR_FW*cs, ph=CHAR_FH*cs;
    if(spr.flip){
      ctx.save(); ctx.translate(Math.round(sx0+pw/2),0); ctx.scale(-1,1);
      ctx.drawImage(spr.cv, 0,0,CHAR_FW,CHAR_FH, -pw/2, sy0, pw, ph);
      ctx.restore();
    } else {
      ctx.drawImage(spr.cv, 0,0,CHAR_FW,CHAR_FH, sx0, sy0, pw, ph);
    }
    const hx = (sx0 + 4*cs)/S, hy = (sy0 + 0)/S;
    if(cosmetics.includes("crown")){px(hx,hy,5*cs/S,2*cs/S,"#e8c170");px(hx+1,hy-cs/S,cs/S,cs/S,"#e8c170");px(hx+3,hy-cs/S,cs/S,cs/S,"#e8c170")}
    else if(cosmetics.includes("beanie")){px(hx-1,hy,7*cs/S,2*cs/S,"#d84f6f");px(hx+1,hy-cs/S,3*cs/S,cs/S,"#d84f6f")}
    if(cosmetics.includes("orange_scarf")){ctx.fillStyle="#d97a3a";ctx.fillRect(sx0+2*cs,sy0+9*cs,12*cs,2*cs);}
    ctx.globalAlpha=1;
    return;
  }
  if(cosmetics.includes("cape") && walking){px(x,y+5,8,6,"#7a3030")}
  px(x+2,y,5,3,hair);
  if(h%3===0)px(x+1,y+1,1,3,hair);
  px(x+3,y+1,1,1,lighten(hair));
  if(cosmetics.includes("crown")){px(x+2,y-2,5,2,"#e8c170")}
  else if(cosmetics.includes("beanie")){px(x+1,y-1,6,2,"#d84f6f")}
  else if(cosmetics.includes("visor") && a.platform==="opencode"){px(x+1,y+1,6,1,"#4fa4d8")}
  if(cosmetics.includes("headphones")){px(x+1,y+1,1,3,"#2b2b2b");px(x+7,y+1,1,3,"#2b2b2b");px(x+2,y,5,1,"#2b2b2b")}
  px(x+2,y+2,5,3,skin);
  px(x+3,y+3,1,1,"#111");px(x+6,y+3,1,1,"#111");
  px(x+1,y+5,7,5,shirt);
  if(a.kind==="subagent"||cosmetics.includes("gold_trim"))px(x+1,y+5,7,1,"#e8c170");
  if(cosmetics.includes("orange_scarf")){px(x+1,y+5,7,1,"#d97a3a")}
  px(x+0,y+6,1,3,skin); px(x+8,y+6,1,3,skin);
  if(walking){
    if(t%2){px(x+2,y+10,2,3,"#2d2d3d");px(x+5,y+11,2,2,"#2d2d3d")}
    else{px(x+2,y+11,2,2,"#2d2d3d");px(x+5,y+10,2,3,"#2d2d3d")}
  }else{
    px(x+2,y+10,2,3,"#2d2d3d"); px(x+5,y+10,2,3,"#2d2d3d");
  }
  if(seated){
    if(a.activity==="typing"&&(frame>>2)%2)px(x+8,y+8,2,1,skin);
    else if(a.activity==="running"&&t%2)px(x+8,y+8,2,1,skin);
    else if(a.activity==="reading"){px(x+8,y+7,3,2,"#e8e0c8")}
  }
  ctx.globalAlpha=1;
}
function drawBubble(a,x,y){
  const t=frame>>4;
  if(a.status==="waiting"){
    const by=y-6-((frame>>3)%2);
    px(x+1,by,6,4,"#f5e6c8"); px(x+2,by+4,1,1,"#f5e6c8");
    px(x+4,by+1,1,2,"#c9302f"); px(x+4,by+3,1,1,"#c9302f");
    ctx.save();
    ctx.font="9px ui-monospace,monospace";
    ctx.textAlign="left";
    const txt = (a.detail||"approval!").slice(0,10);
    if(txt){
      const tx2 = (x>=8) ? (x-12) : (x+8);
      ctx.fillStyle="#f5e6c8";
      ctx.fillRect(tx2*S, (by-1)*S, 12*S, 5*S);
      ctx.fillStyle="#1a1423";
      ctx.fillText(txt,(tx2+1)*S,(by+2)*S);
    }
    ctx.restore();
  }else if(a.status==="working"&&a.tool){
    ctx.fillStyle="#e8c170";
    ctx.fillRect((x+16)*S-4, (y+3)*S, 4, 4);
  }else if(a.status==="thinking"){
    const mood = (a.activity==="delegating") ? "#d84f6f"
              : (a.activity==="reading") ? "#9b6fd8"
              : (a.activity==="typing") ? "#e8c170"
              : "#cfc4e8";
    if((frame>>5)%2){ px(x+2,y-4,2,1,mood); px(x+3,y-2,2,1,mood); }
    else { px(x+2,y-3,1,2,mood); px(x+4,y-3,1,2,mood); }
  }else if(a.status==="done"){
    px(x+2,y-4,1,1,"#5fce7a");px(x+3,y-3,1,1,"#5fce7a");
    px(x+4,y-4,1,1,"#5fce7a");px(x+5,y-5,1,1,"#5fce7a");
  }else if(a.status==="idle"&&(t%8)<4){
    px(x+6,y-4,1,1,"#7a6f8f");px(x+7,y-5,1,1,"#7a6f8f");
  }
}
function label(a,x,y){
  const cx=(x+9)*S;
  const colW=18*S;
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.round(x*S), Math.round((y+19)*S), colW, 8*S);
  ctx.clip();
  ctx.font=(S>=8?"10px":"11px")+" ui-monospace,monospace";ctx.textAlign="center";
  const name=a.label.slice(0,14);
  ctx.fillStyle=a.kind==="subagent"?"#3a2a10":"#2a2038";
  ctx.fillRect(Math.round((x+2)*S), Math.round((y+19)*S), (colW-4*S), 6*S);
  ctx.fillStyle=a.kind==="subagent"?"#ffd98a":"#ffffff";
  ctx.fillText(name,cx,(y+22)*S);
  ctx.fillStyle="#8a7fa8";
  const st=a.status==="waiting"?"needs input!"
        :a.status==="working"?(a.tool||"working"):a.status;
  ctx.fillText(st.slice(0,14),cx,(y+24)*S);
  ctx.restore();
  drawLogo(platOf(a),x+1,y+13);
}

const chars = new Map();
const WALK = 0.55;
let nextPairAt=2400+((Math.random()*3600)|0);
function seatPos(i,perRow,geom,padLeft,rowStep,padTop){
  const g = geom || LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  const rs = rowStep || g.rowStep;
  const y0 = (padTop==null ? g.labelY : padTop);
  return {x:(padLeft==null?10:padLeft)+(i%perRow)*g.colStep, y:y0+Math.floor(i/perRow)*rs};
}
function computeGrid(list, gw, gh, maxc){
  const geom = LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  let perRow = Math.min(maxc, Math.max(1, Math.floor((gw-2)/geom.colStep)));
  let rows = Math.ceil(Math.max(1,list.length)/Math.max(1,perRow));
  const availH = gh - geom.labelY - 22;
  while(perRow < maxc && rows * geom.rowStep + 18 > availH && perRow < list.length){
    perRow++; rows = Math.ceil(list.length/Math.max(1,perRow));
  }
  if(geom.perRow >= rows || rows * geom.rowStep + 18 <= availH){
    perRow = Math.max(geom.perRow, Math.min(perRow, maxc));
  }
  perRow = Math.max(1, Math.min(perRow, Math.max(1, list.length)));
  rows = Math.ceil(Math.max(1,list.length)/perRow);
  const dynRowStep = Math.min(geom.rowStep, Math.max(22, Math.floor(availH/Math.max(1,rows))));
  let padLeft = Math.max(12, Math.floor((gw - perRow*geom.colStep)/2));
  if(list.length===1) padLeft = Math.max(10, Math.floor((gw - 18)/2));
  const clusterH = rows * dynRowStep + 10;
  const floorTop = geom.labelY + 2;
  const floorBot = gh - 22;
  const padTop = Math.max(floorTop, floorTop + Math.floor(Math.max(0, floorBot-floorTop-clusterH)/2));
  return {geom, perRow, rows, dynRowStep, padLeft, padTop};
}
function layoutGrid(list, W, H){
  const geom = LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  const maxc=Math.max(2,settings.max_chars||4);
  const sCap = 8;
  const usableW=W-16, usableH=H-72;
  let tile=Math.max(2, Math.min(sCap, Math.floor(usableW/((geom.perRow||3)*geom.colStep))));
  let gw=Math.floor(W/tile), gh=Math.floor(H/tile);
  let g=computeGrid(list, gw, gh, maxc);
  tile=Math.max(2, Math.min(sCap, Math.floor(Math.min(
    usableW/(g.perRow*geom.colStep), usableH/(g.rows*g.dynRowStep)))));
  gw=Math.floor(W/tile); gh=Math.floor(H/tile);
  g=computeGrid(list, gw, gh, maxc);
  return {S:tile, gw, gh, ...g};
}
function stepChars(grid){
  if(!grid)return;
  const seen=new Set();
  if(frame>=nextPairAt && agents.length>=2){
    const seated=agents.filter(a=>{const c=chars.get(a.id);return c&&c.phase==="seated"&&!c.pair;});
    if(seated.length>=2){
      const visitor=seated[(Math.random()*seated.length)|0];
      const others=seated.filter(a=>a.id!==visitor.id);
      const host=others[(Math.random()*others.length)|0];
      const vc=chars.get(visitor.id);
      vc.pair={host:host.id, until:frame+900+((Math.random()*1200)|0)};
      nextPairAt=frame+3600+((Math.random()*7200)|0);
    }
    else nextPairAt=frame+600;
  }
  const {perRow, padLeft, geom, dynRowStep, padTop}=grid;
  agents.forEach((a,i)=>{
    seen.add(a.id);
    const seat=seatPos(i,perRow,geom,padLeft,dynRowStep,padTop);
    let c=chars.get(a.id);
    if(!c){ c={x:2,y:2,seat,phase:"in",lastStatus:a.status}; chars.set(a.id,c); }
    c.seat=seat;
    if(c.pair&&(frame>=c.pair.until))c.pair=null;
    let tx,ty;
    if(c.pair){
      const hc=chars.get(c.pair.host);
      if(hc){tx=hc.seat.x+6; ty=hc.seat.y;}
      else {c.pair=null; tx=c.seat.x+3; ty=c.seat.y;}
    }
    else {tx=c.phase==="out"?2:c.seat.x+3; ty=c.phase==="out"?2:c.seat.y;}
    const dx=tx-c.x, dy=ty-c.y, d=Math.hypot(dx,dy);
    if(d>=WALK){
      if(Math.abs(dx)>Math.abs(dy))c.face=dx<0?"left":"right";
      else if(Math.abs(dy)>0.05)c.face=dy<0?"up":"down";
      c.x+=dx/d*WALK; c.y+=dy/d*WALK;
    } else { c.x=tx;c.y=ty; if(c.phase==="in")c.phase="seated"; }
    if(c.lastStatus!==a.status){
      if(a.status==="waiting")chime([880,660,880]);
      else if(a.status==="done"&&a.kind==="subagent")chime([520,780]);
      c.lastStatus=a.status;
    }
  });
  for(const [id,c] of chars){
    if(!seen.has(id)){
      c.phase="out";
      const dx=2-c.x, dy=2-c.y, d=Math.hypot(dx,dy);
      if(d<WALK)chars.delete(id);
      else{c.x+=dx/d*WALK;c.y+=dy/d*WALK;}
    }
  }
}

function chime(notes){
  if(!soundOn)return;
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    notes.forEach((f,i)=>{
      const o=audioCtx.createOscillator(),g=audioCtx.createGain();
      o.type="square";o.frequency.value=f;
      g.gain.setValueAtTime(0.06,audioCtx.currentTime+i*0.12);
      g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+i*0.12+0.11);
      o.connect(g);g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime+i*0.12);o.stop(audioCtx.currentTime+i*0.12+0.12);
    });
  }catch(e){}
}

const visitors=[];
let nextVisitorAt=600+((Math.random()*1800)|0);
function floorBand(gh){ return Math.max(28, gh-16); }
function visitorX(gw){
  const left=10+((Math.random()*Math.max(6,gw*0.28))|0);
  const right=Math.floor(gw*0.68)+((Math.random()*Math.max(6,gw*0.22))|0);
  return Math.random()<0.5?left:Math.min(gw-10,right);
}
function stepVisitors(gw,gh){
  if(frame>=nextVisitorAt && visitors.length<2){
    const kind=VISITOR_KINDS[(Math.random()*VISITOR_KINDS.length)|0];
    const fy=floorBand(gh);
    visitors.push({x:4,y:6,tx:visitorX(gw),ty:fy, face:"right",
                   phase:"in",dwell:400+((Math.random()*600)|0),kind,seed:(Math.random()*9999)|0,wp:null});
    if(soundOn)chime([392,523]);
    nextVisitorAt=frame+1800+((Math.random()*5400)|0);
  }
  for(let i=visitors.length-1;i>=0;i--){
    const v=visitors[i];
    const speed=0.06;
    function nextWp(v,gw,gh){
      const floorY=floorBand(gh);
      if(v.phase==="out") return {x:4, y:floorY};
      if(v.y<floorY-1) return {x:v.x, y:floorY};
      return {x:v.tx, y:Math.min(Math.max(v.ty, floorY), gh-18)};
    }
    function arrived(v){
      const floorY=floorBand(gh);
      return v.phase==="in" ? (Math.abs(v.x-v.tx)<0.5 && Math.abs(v.y-v.ty)<0.5)
                            : (v.x<8 && v.y<=floorY+1);
    }
    if(v.phase==="in"||v.phase==="out"){
      if(arrived(v)){
        if(v.phase==="in"){ v.phase="dwell"; v.wp=null; }
        else { if(soundOn)chime([523,392]); visitors.splice(i,1); }
      }else{
        if(!v.wp||Math.hypot(v.wp.x-v.x,v.wp.y-v.y)<0.5) v.wp=nextWp(v,gw,gh);
        const dx=v.wp.x-v.x, dy=v.wp.y-v.y, d=Math.hypot(dx,dy);
        if(d>=0.5){
          if(Math.abs(dx)>0.2) v.face=dx<0?"left":"right";
          v.x+=dx/d*speed; v.y+=dy/d*speed;
        }
      }
    }else if(v.phase==="dwell"){
      if(--v.dwell<=0){
        v.phase="out"; v.tx=4; v.ty=floorBand(gh); v.wp=null;
      }
      else if(v.dwell>240 && v.dwell%180===0){ v.tx=Math.max(8,Math.min(gw-8,v.tx+(((Math.random()*10)|0)-5))); v.phase="in"; v.dwell+=120; v.wp=null; }
    }
  }
}
function drawVisitors(){
  for(const v of visitors){
    const walking=v.phase!=="dwell";
    const bob=(walking&&(frame>>3)%2)?1:0;
    const k=v.kind;
    const px0=Math.round(v.x*S), py0=Math.round((v.y+bob)*S);
    const pos=drawNpcSprite(v, px0, py0);
    ctx.font=Math.max(10,S)+"px ui-monospace,monospace"; ctx.textAlign="center";
    ctx.fillStyle="rgba(207,196,232,0.95)";
    ctx.fillText(k.name, px0, Math.max(12, pos.dy-4));
    if(v.phase==="dwell"){
      const line=k.lines[(v.seed+((frame/300)|0))%k.lines.length];
      ctx.font=Math.max(10,S+1)+"px ui-monospace,monospace";
      const tw=ctx.measureText(line).width;
      const bx=Math.max(4, px0-tw/2-5), by=Math.max(14, pos.dy-22);
      ctx.fillStyle="rgba(255,255,255,0.94)";
      ctx.fillRect(bx,by,tw+10,16);
      ctx.fillStyle="#241c33";
      ctx.fillText(line, bx+tw/2+5, by+12);
    }
  }
}

function drawSeasonal(w,gh){
  if(new Date().getMonth()!==9) return;
  const jx=11, jy=Math.max(20,gh-10);
  px(jx,jy,4,3,"#e8802a");
  px(jx+1,jy+3,2,1,"#54381f");
  px(jx+1,jy+1,1,1,"#f0d060");px(jx+3,jy+1,1,1,"#f0d060");
  px(jx+1+(frame>>4)%2,jy+2,2,1,"#f0d060");
}

function render(){
  if(document.querySelector(".sheet[style*=\"display: block\"]")){
    if(!render._sheetTick || performance.now()-render._sheetTick>250){ render._sheetTick=performance.now(); }
    else { requestAnimationFrame(render); return; }
  }
  if(document.hidden){ requestAnimationFrame(render); return; }
  frame++;
  const W=cv.clientWidth,H=cv.clientHeight;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  const list=shown();
  const grid=layoutGrid(list, W, H);
  S=grid.S; _gw=grid.gw; _gh=grid.gh;
  window._grid=grid;
  applyTheme(settings.theme);
  drawOffice(grid.gw, grid.gh);
  drawSeasonal(grid.gw, grid.gh);
  const cosmetics=((progress&&progress.cosmetics)||[]).filter(c=>RETIRED_COS.indexOf(c)<0);
  window._cosmetics=cosmetics;
  const {geom, perRow, dynRowStep, padLeft, padTop, rows}=grid;
  const prev=agents; agents=list; stepChars(grid); agents=prev;
  if(list.length){
    const seats=list.map((_,i)=>seatPos(i,perRow,geom,padLeft,dynRowStep,padTop));
    const minx=Math.min.apply(null,seats.map(s=>s.x))-3;
    const maxx=Math.max.apply(null,seats.map(s=>s.x))+21;
    const miny=Math.min.apply(null,seats.map(s=>s.y))+8;
    if(settings.layout!=="bullpen"){
      const rw=maxx-minx, rh=10;
      px(minx,miny,rw,rh, night()?"#2a1838":"#32243f");
      px(minx+1,miny+1,rw-2,rh-2, night()?"#3a2048":"#3a2f4b");
      px(minx+2,miny,1,rh,"#e8c170"); px(minx+rw-3,miny,1,rh,"#e8c170");
    }
    if(settings.layout==="bullpen"){
      for(let r=0;r<rows;r++){
        const y=padTop + r*dynRowStep + 8;
        for(let c=1;c<perRow;c++){
          const x=padLeft + c*geom.colStep - 5;
          px(x, y, 1, 14, (window._theme&&window._theme.wall)||"#34384a");
        }
      }
    }
  }
  window._deskAnchors=[];
  list.forEach((a,i)=>{
    const seat=seatPos(i,perRow,geom,padLeft,dynRowStep,padTop);
    window._deskAnchors[i]=[seat.x,seat.y];
    drawDesk(seat.x,seat.y,a,cosmetics); deskScreen(seat.x,seat.y,a);
    drawHealthBar(a,seat.x,seat.y);
  });
  list.forEach((a,i)=>{
    const c=chars.get(a.id); if(!c)return;
    const seated=c.phase==="seated";
    drawChar(a,c.x,c.y,seated,cosmetics);
    if(c.pair){
      ctx.fillStyle="#5fce7a";
      ctx.fillRect((c.x+3)*S, (c.y-1)*S, 2*S, 2*S);
      ctx.fillRect((c.x+6)*S, (c.y-1)*S, 2*S, 2*S);
    }
    if(seated){
      const seat=seatPos(i,perRow,geom,padLeft,dynRowStep,padTop);
      drawDesk(seat.x,seat.y,a,cosmetics,true); deskScreen(seat.x,seat.y,a);
      if(night() && a.status==="idle" && (frame>>4)%3!==2){
        const zx=seat.x+13, zy=seat.y-2+((frame>>4)%3);
        ctx.font="bold "+Math.max(5,S)+"px ui-monospace,monospace";
        ctx.fillStyle="rgba(232,224,200,"+(0.9-((frame>>4)%3)*0.25)+")";
        ctx.fillText("z", zx*S, zy*S);
      }
      drawBubble(a,seat.x+2,seat.y); label(a,seat.x,seat.y);
    }
    if(focusedId===a.id){
      const seat=seatPos(i,perRow,geom,padLeft,dynRowStep,padTop);
      ctx.strokeStyle="#e8c170";
      ctx.lineWidth=2;
      ctx.strokeRect((seat.x-1)*S, (seat.y-1)*S, 20*S, 22*S);
      ctx.lineWidth=1;
    }
  });
  for(const [id,c] of chars){
    if(c.phase==="out"&&!list.find(a=>a.id===id))
      drawChar({id,kind:"main",status:"gone",activity:"",platform:""},c.x,c.y,false,cosmetics);
  }
  stepVisitors(grid.gw, grid.gh);
  drawVisitors();

  ctx.font="11px ui-monospace";ctx.textAlign="left";
  if(settings.layout && settings.layout!=="open"){
    ctx.fillStyle="#cfc4e8";
    ctx.fillText(" · " + settings.layout + " ·", 6, H-6);
  }
  if(_events.length){
    const visible=_events.slice(-5);
    ctx.textAlign="right";
    ctx.font="10px ui-monospace,monospace";
    let y=Math.min(12*S, H-30);
    const xRight = Math.max(60, W-6);
    visible.slice().reverse().forEach(e=>{
      const age=frame-e.frame;
      ctx.globalAlpha=Math.max(0.3, 1-age/240);
      ctx.fillStyle={session_start:"#5fce7a",tool_start:"#cfc4e8",
                     approval_request:"#d84f6f",subagent_start:"#c9a227"}[e.kind]||"#9b6fd8";
      const txt = e.text.length>30 ? e.text.slice(0,29)+"…" : e.text;
      ctx.fillText(txt, xRight, y);
      y+=11;
    });
    ctx.globalAlpha=1;
  }
  ctx.textAlign="center";
  if(offline){
    ctx.fillStyle="#cfc4e8";
    ctx.fillText("office unreachable — "+offline,W/2,H/2);
    ctx.fillStyle="#7a6f8f";
    ctx.fillText("run python3 demo_feed.py  ·  or start a Hermes / OpenCode session",W/2,H/2+20);
  }else if(!list.length){
    ctx.fillStyle="#7a6f8f";
    ctx.fillText(agents.length?"no agents on this filter":"empty floor — run Hermes, OpenCode, or Claude Code",W/2,H/2);
  }
  requestAnimationFrame(render);
}

function applyTheme(id){
  const theme = THEMES.find(t=>t.id===id) || THEMES[0];
  const dark = night();
  const tileA = (dark && theme.id==="default") ? "#231c2e" : theme.tileA;
  const tileB = (dark && theme.id==="default") ? "#1c1626" : theme.tileB;
  const wall  = (dark && theme.id==="default") ? "#2a2038" : theme.wall;
  const prev = window._theme;
  window._theme = {id:theme.id, tileA, tileB, wall, isDark:dark};
  if(prev && prev.id===theme.id && prev.isDark===dark && prev.tileA===tileA) return;
  cv.style.background = theme.bg;
  const root=document.documentElement;
  root.setAttribute("data-theme", theme.id);
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--panel", theme.panel||"#1a1423");
  root.style.setProperty("--line", theme.line||"#3a2f4b");
  root.style.setProperty("--ink", theme.ink||"#cfc4e8");
}

async function saveSettings(){
  try{
    await fetch("settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)});
  }catch(e){}
  try{
    const n=parseInt(localStorage.getItem("themeSwitches")||"0",10);
    if(settings.theme!==(localStorage.getItem("lastTheme")||"default")){
      localStorage.setItem("themeSwitches",String(n+1));
      localStorage.setItem("lastTheme",settings.theme);
    }
  }catch(e){}
}
async function loadSettings(){
  try{
    const r=await fetch("settings");
    const o=await r.json();
    Object.keys(o||{}).forEach(k=>{ if(k in _DEFAULTS) settings[k]=o[k]; });
  }catch(e){}
  const RETIRED_LAYOUTS={lounge:"open",library:"open"};
  if(RETIRED_LAYOUTS[settings.layout]){ settings.layout="open"; saveSettings(); }
  const RETIRED_THEMES={forest:"default",ocean:"default"};
  if(RETIRED_THEMES[settings.theme]){ settings.theme="default"; saveSettings(); }
  if(progress){
    const L = LAYOUTS.find(x=>x.id===settings.layout);
    if(L && L.require && !haveUnlock(L.require)) {
      settings.layout = "open";
      saveSettings();
    }
  }
  if(!THEMES.find(t=>t.id===settings.theme)){
    settings.theme = "default";
    saveSettings();
  }
}
async function loadManifest(){
  try{const r=await fetch("assets-manifest");window.__assets=await r.json();}catch(e){}
}
async function updateSetting(k,v){settings[k]=v;await saveSettings(); if(typeof fillLayout==="function") fillLayout(); if(typeof fillSettings==="function") fillSettings();}

function applyState(state){
  offline=null; agents=(state&&state.agents)||[];
  if(state&&state.settings){
    Object.keys(state.settings).forEach(k=>{ if(k in _DEFAULTS) settings[k]=state.settings[k]; });
  }
  window._stateEvents = state&&state.events || [];
  if(typeof applyProgress==="function") applyProgress(state&&state.progress);
  if(typeof fillRoster==="function") fillRoster();
  if(typeof fillLayout==="function") fillLayout();
  if(typeof fillSettings==="function") fillSettings();
  if(typeof fillEvents==="function") fillEvents();
  if(typeof fillInspector==="function") fillInspector();
  const insp=document.getElementById("inspectorbtn");
  if(insp) insp.style.display = focusedId ? "" : "none";
  const n=agents.length, w=agents.filter(a=>a.status==="waiting").length;
  const cnt=document.getElementById("count");
  if(cnt){
    cnt.textContent=n+" agent"+(n===1?"":"s")+(w?" · "+w+" waiting!":"");
    if(!cnt.dataset.wired){cnt.dataset.wired="1";cnt.style.cursor="pointer";cnt.title="open roster";
      cnt.onclick=()=>{fillRoster();fillStats();toggleSheet("sheet-floor");};}
  }
  const ev=(state&&state.events)||[];
  ev.slice(-30).forEach(e=>{
    if(_events.find(x=>x.key===e.ts+"-"+e.event))return;
    let text="";
    if(e.event==="session_start")text="+ "+(e.platform||"agent")+" session";
    else if(e.event==="tool_start")text=e.tool_name+" "+(e.platform||"");
    else if(e.event==="approval_request")text="! approval: "+(e.command||"");
    else if(e.event==="subagent_start")text="↳ subagent: "+((e.child_goal||"goal").slice(0,18));
    if(text)_events.push({key:e.ts+"-"+e.event,kind:e.event,text,frame:frame});
  });
  while(_events.length>MAX_EVENTS)_events.shift();
  if(focusedId && !agents.find(a=>a.id===focusedId)){
    focusedId=null; if(insp) insp.style.display="none";
  }
}

if(IN_VSCODE){
  window.addEventListener("message",(ev)=>{
    const m=ev.data||{};
    if(m.type==="state")applyState(m.state);
    else if(m.type==="offline"){offline=m.url;agents=[];
      document.getElementById("count").textContent="offline";}
  });
}else{
  (async function poll(){
    try{const r=await fetch("state");applyState(await r.json());}
    catch(e){offline=String(location.host);agents=[];
      const c=document.getElementById("count"); if(c) c.textContent="offline";}
    setTimeout(poll,1500);
  })();
}
loadSettings();loadManifest();
render();

function toast(msg){
  const host=document.getElementById("toast");
  if(!host) return;
  const el=document.createElement("div");
  el.className="card";
  el.innerHTML="<b>"+msg+"</b>";
  host.appendChild(el);
  setTimeout(()=>el.remove(),1800);
}
function copyAgent(a){
  const txt=a.label?a.label+(a.detail?" — "+a.detail:""):a.detail||"";
  if(txt && navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast("copied: "+txt.slice(0,40)))
      .catch(()=>toast(txt.slice(0,60)));
  }
}
cv.addEventListener("click", (ev)=>{
  const r=cv.getBoundingClientRect();
  const tx=Math.floor((ev.clientX-r.left)/S);
  const ty=Math.floor((ev.clientY-r.top)/S);
  if(tx>_gw-12 && ty>_gh-8){
    petBounce=true; petTimer=120; chime([520,780]);
  } else {
    const list=shown();
    const g=window._grid || computeGrid(list,_gw,_gh,Math.max(2,settings.max_chars||4));
    let best=null,bestD=99999;
    list.forEach((a,i)=>{
      const s=seatPos(i,g.perRow,g.geom,g.padLeft,g.dynRowStep,g.padTop);
      const d=Math.hypot(tx-s.x-4, ty-s.y-6);
      if(d<bestD){bestD=d;best=a;}
    });
    if(best && bestD<14){
      const wasFocused = focusedId===best.id;
      focusedId = wasFocused ? null : best.id;
      const insp=document.getElementById("inspectorbtn");
      if(insp) insp.style.display = focusedId ? "" : "none";
      if(focusedId){
        fillInspector();toggleSheet("sheet-inspector");
      }
      if(!wasFocused) copyAgent(best);
    }
  }
});

/* Sheets, settings, roster, usage, keyboard. Shares globals from office.js. */
"use strict";

function fillLayout(){
  const box=document.getElementById("layoutbox");
  if(!box) return;
  box.innerHTML="";
  LAYOUTS.forEach(L=>{
    const locked = L.require && !haveUnlock(L.require);
    const row = document.createElement("div");
    row.className="row";
    row.innerHTML="<div style='flex:1'><div class='n'>"+
      L.name+(locked?" <span class='h'>\u{1F512}</span>":"")+"</div>"+
      "<div class='h'>"+L.hint+"</div></div>"+
      (locked
        ? "<span class='h' style='align-self:center'>locked</span>"
        : "<button type='button' class='btn "+(settings.layout===L.id?"on":"")+"'>"+
          (settings.layout===L.id?"active":"use")+"</button>");
    if(!locked) row.querySelector(".btn").onclick=()=>updateSetting("layout",L.id);
    else row.style.opacity="0.55";
    box.appendChild(row);
  });
}

function nightMode(){
  return window._nightOverride===null||window._nightOverride===undefined?"auto":(window._nightOverride?"night":"day");
}
function cycleNight(){
  const cur=nightMode();
  const next=cur==="auto"?"night":cur==="night"?"day":"auto";
  if(next==="auto"){window._nightOverride=null;try{localStorage.removeItem("pixelOfficeNight")}catch(e){}}
  else{window._nightOverride=next==="night";try{localStorage.setItem("pixelOfficeNight",window._nightOverride?"1":"0")}catch(e){}}
  chime([520,next==="night"?390:660]);
  fillSettings();
}

function fillSettings(){
  const box=document.getElementById("settingsbox");
  if(!box) return;
  box.innerHTML="";
  const th=document.createElement("div");th.className="row";
  th.innerHTML="<div style='flex:1'><div class='n'>theme</div></div>";
  const seg=document.createElement("span");seg.className="seg";
  THEMES.forEach(t=>{
    const s=document.createElement("span");
    s.textContent=t.name;
    if(settings.theme===t.id) s.className="on";
    s.onclick=()=>{settings.theme=t.id;saveSettings();applyTheme(t.id);fillSettings();syncThemeBtn();};
    seg.appendChild(s);
  });
  th.appendChild(seg);
  box.appendChild(th);
  const dn=document.createElement("div");dn.className="row";
  const mode=nightMode();
  dn.innerHTML="<div style='flex:1'><div class='n'>day / night</div></div>";
  const dseg=document.createElement("span");dseg.className="seg";
  ["auto","day","night"].forEach(m=>{
    const s=document.createElement("span");
    s.textContent=m;
    if(mode===m) s.className="on";
    s.onclick=()=>{
      if(m==="auto"){window._nightOverride=null;try{localStorage.removeItem("pixelOfficeNight")}catch(e){}}
      else{window._nightOverride=m==="night";try{localStorage.setItem("pixelOfficeNight",window._nightOverride?"1":"0")}catch(e){}}
      fillSettings();
    };
    dseg.appendChild(s);
  });
  dn.appendChild(dseg);
  box.appendChild(dn);
  const r=document.createElement("div");r.className="row";
  r.innerHTML="<div style='flex:1'><div class='n'>desks per row</div></div>"+
    "<input class='txt' type='number' id='mc' name='max_chars' min='2' max='8' value='"+settings.max_chars+"' style='width:60px' aria-label='desks per row'>";
  box.appendChild(r);
  document.getElementById("mc").onchange=(e)=>{settings.max_chars=Math.max(2,Math.min(8,+e.target.value||4));saveSettings()};
  const rst=document.createElement("div");rst.className="row";
  rst.innerHTML="<div style='flex:1'><div class='n'>reset everything</div><div class='h'>wipe XP, badges, history</div></div>";
  const rbtn=document.createElement("button");rbtn.type="button";rbtn.className="btn";rbtn.textContent="reset";
  rbtn.onclick=()=>{
    if(!confirm("Reset ALL office progress? XP, badges and history will be wiped. This cannot be undone."))return;
    fetch("/state",{method:"DELETE"}).then(r=>r.json()).then(()=>{
      localStorage.removeItem("pixelOfficeSeen");
      location.reload();
    }).catch(()=>console.error("reset failed — is the office server running?"));
  };
  rst.appendChild(rbtn);
  box.appendChild(rst);
}

function syncSheetBtns(openId){
  document.querySelectorAll("#hdr [data-sheet]").forEach(b=>{
    const on=!!openId && b.getAttribute("data-sheet")===openId;
    b.setAttribute("aria-expanded", on?"true":"false");
    b.classList.toggle("on", on);
  });
}
function closeSheets(){
  document.querySelectorAll(".sheet").forEach(el=>el.style.display="none");
  syncSheetBtns(null);
}
function toggleSheet(id){
  const el=document.getElementById(id);
  if(!el)return;
  const open=el.style.display==="block";
  closeSheets();
  if(!open){
    el.style.display="block";
    syncSheetBtns(id);
  }
}

function fillLegend(){
  const box=document.getElementById("legendbox");if(!box)return;
  box.innerHTML=
    "<p class='h'>status</p>"+
    ["working: tool running","thinking: between tools","waiting: approval needed",
     "done: subagent finished","idle: nothing recent","gone: session ended"]
       .map(s=>"<div class='kv'><span>"+s.split(":")[0]+"</span><b>"+s.split(":")[1]+"</b></div>").join("")+
    "<p class='h' style='margin-top:10px'>activity</p>"+
    ["typing: write/edit","reading: read/search","browsing: web_extract",
     "running: terminal","delegating: subagent","working: other"]
       .map(s=>"<div class='kv'><span>"+s.split(":")[0]+"</span><b>"+s.split(":")[1]+"</b></div>").join("")+
    "<p class='h' style='margin-top:10px'>platforms</p>"+
    PLATFORMS.map(p=>{
      const ok=(progress&&progress.stats&&(progress.stats.platforms||[]).includes(p.id))||p.id==="hermes"||p.id==="cli";
      return "<div class='kv'><img src='assets/"+p.icon+".svg' width='14' height='14' style='vertical-align:middle;margin-right:4px' alt=''>"
        +"<span>"+p.name+(ok?" <span class='h' style='color:#5fce7a'>· live</span>":"")+"</span>"
        +"<b style='font-size:11px;color:#9b6fd8'>"+p.what+"</b></div>";
    }).join("")+
    "<p class='h' style='margin-top:10px'>shortcuts</p>"+
    ["R floor","U floor","B badges","S settings","E live","? legend","T theme","N day/night","esc close"]
       .map(s=>"<div class='kv'><span><code>"+s.split(" ")[0]+"</code></span><b>"+s.split(" ").slice(1).join(" ")+"</b></div>").join("");
}

function fmtDur(srv, fallbackTs){
  let s = (typeof srv==="number") ? Math.max(0,Math.floor(srv)) : null;
  if(s===null && fallbackTs){ s=Math.max(0,Math.floor(Date.now()/1000-fallbackTs)); }
  if(s===null) return "—";
  return s<60 ? s+"s" : Math.floor(s/60)+"m "+(s%60)+"s";
}
function fillInspector(){
  const box=document.getElementById("inspectorbox");if(!box)return;
  if(!focusedId){
    box.innerHTML="<p class='h'>click a character to inspect</p>";return;
  }
  const a=agents.find(x=>x.id===focusedId);
  if(!a){
    box.innerHTML="<p class='h'>agent "+(focusedId||"").slice(-6)+" gone</p>";return;
  }
  const evs=(window._stateEvents||[]).filter(e=>{
    const sid=e.session_id||e.child_session_id||"";
    return sid===focusedId;
  }).slice(-10);
  const rows=[
    ["agent",a.label],["platform",platOf(a)],["kind",a.kind],["status",a.status],
    ["tool",a.tool||"—"],["detail",a.detail||"—"],["id",a.id],["activity",a.activity||"—"],
    ["session time", fmtDur(a.duration_s, a.first_seen)],
    ["idle / blocked", fmtDur(a.idle_s, a.updated_at)],
  ];
  const hist=(window._stateEvents||[]).filter(e=>{
    const sid=e.session_id||e.child_session_id||"";
    return sid===focusedId && e.event==="tool_start";
  });
  const counts={};
  hist.forEach(e=>{ const t=e.tool_name||"?"; counts[t]=(counts[t]||0)+1; });
  const topTools=Object.entries(counts).sort((x,y)=>y[1]-x[1]).slice(0,5)
    .map(([k,v])=>k+" ×"+v).join(", ")||"—";
  box.innerHTML="<div class='n' style='margin-bottom:8px'>inspector</div>"+
    rows.map(([k,v])=>"<div class='kv'><span>"+k+"</span><b>"+v+"</b></div>").join("")+
    "<div class='kv'><span>tools used ("+hist.length+")</span><b>"+topTools+"</b></div>"+
    "<p class='h' style='margin-top:10px'>recent events</p>"+
    (evs.length ? evs.map(e=>"<div class='kv'><span>"+e.event+"</span><b>"+(e.tool_name||e.command||e.child_goal||"")+"</b></div>").join("") : "<p class='h'>no recent events</p>");
}

function fillRoster(){
  const box=document.getElementById("roster");
  if(!box) return;
  box.innerHTML="";
  const sWrap=document.createElement("div");
  sWrap.className="row";
  sWrap.innerHTML="<input class='txt' id='trackSearch' name='trackSearch' placeholder='filter agents… (status/tool/name)' value='"+trackQuery.replace(/'/g,"&#39;")+"' style='flex:1' aria-label='filter agents'>";
  box.appendChild(sWrap);
  const sInput=sWrap.querySelector("#trackSearch");
  sInput.oninput=(e)=>{trackQuery=e.target.value||""; fillRoster();};
  const list = agents.filter(trackMatch);
  if(!agents.length){box.innerHTML+="<p class='h'>empty floor — start Hermes, OpenCode, or Claude Code</p>";return}
  if(!list.length){box.innerHTML+="<p class='h'>no agents match '"+trackQuery+"'</p>";return}
  const _waiting = list.filter(a=>a.status==="waiting");
  if(_waiting.length){
    const _hdr=document.createElement("div");
    _hdr.className="row";
    _hdr.innerHTML="<div style='flex:1'><div class='n' style='color:#d84f6f'>● "+
      _waiting.length+" waiting"+(_waiting.length===1?"":"s")+" — unblock first</div>"+
      "<div class='h'>"+_waiting.map(a=>a.label||a.id).slice(0,4).join(" · ")+
      (_waiting.length>4?" · +"+(_waiting.length-4)+" more":"")+"</div></div>";
    box.appendChild(_hdr);
  }
  const rank=a=>a.status==="waiting"?0:a.status==="working"?1:a.status==="thinking"?2:a.status==="done"?4:3;
  const teams = {};
  const main = [];
  list.forEach(a=>{
    if(a.kind==="subagent" && a.parent && agents.find(x=>x.id===a.parent)){
      (teams[a.parent]=teams[a.parent]||[]).push(a);
    } else if(!a.parent){
      main.push(a);
    }
  });
  main.sort((a,b)=>rank(a)-rank(b));
  main.forEach(a=>{
    const d=document.createElement("div");
    d.className="row";
    const port=document.createElement("canvas");
    port.width=16;port.height=20;port.style.cssText="width:24px;height:30px;image-rendering:pixelated;border:1px solid #3a2f4b;background:#151022";
    port._a=a;
    d.appendChild(port);
    const info=document.createElement("div");info.style.flex="1";
    const plats=String(a.platform||"").toLowerCase();
    const _platIcons={hermes:"hermes",cli:"cli",telegram:"telegram",opencode:"opencode",claude:"claude","claude-code":"claude",gateway:"hermes"};
    const platIcon="assets/"+(_platIcons[plats]||"hermes")+".svg";
    const _dur = (typeof a.duration_s==="number") ? a.duration_s
      : (a.first_seen ? Math.max(0,Math.floor(Date.now()/1000-a.first_seen)) : null);
    let elapsed="";
    if(_dur!==null){ const s=Math.max(0,Math.floor(_dur));
      elapsed = s<60 ? s+"s" : Math.floor(s/60)+"m "+(s%60)+"s"; }
    const attn = a.status==="waiting" ? " <span style='color:#d84f6f'>● NEEDS INPUT</span>" : "";
    info.innerHTML="<div class='n'>"+(a.label||a.id)+
      (a.kind==="subagent"?" <span class='h'>(sub)</span>":"")+
      " <img src='"+platIcon+"' width='10' height='10' style='vertical-align:middle' alt=''>"+
      "</div><div class='h'>"+a.status+
      (a.tool?" · "+a.tool:"")+
      (elapsed?" · "+elapsed:"")+
      (a.detail?" · "+a.detail:"")+attn+
      "</div>";
    d.appendChild(info);
    box.appendChild(d);
    if(teams[a.id]){
      const team=document.createElement("div");
      team.className="row";
      team.style.paddingLeft="22px";
      team.innerHTML="<span class='h'>team ("+teams[a.id].length+" subagents)</span>";
      box.appendChild(team);
      teams[a.id].forEach(sub=>{
        const sd=document.createElement("div");
        sd.className="row";
        sd.style.paddingLeft="22px";
        sd.innerHTML="<span class='h'>↳ "+(sub.label||sub.id)+" · "+sub.status+
          (sub.detail?" · "+sub.detail:"")+"</span>";
        box.appendChild(sd);
      });
    }
  });
  if(document.getElementById("sheet-floor")?.style.display==="block"){
    if(!window._portraitRAF)renderPortraits();
  }
}
function renderPortraits(){
  if(document.getElementById("sheet-floor")?.style.display!=="block"){
    window._portraitRAF=null; return;
  }
  document.querySelectorAll("#roster canvas").forEach(cv=>{
    const a=cv._a;if(!a)return;
    const cx=cv.getContext("2d");
    cx.clearRect(0,0,16,20);
    const h=a.id.split("").reduce((x,c)=>(x*31+c.charCodeAt(0))|0,0);
    const skin=["#f0c8a0","#c68b59","#8d5524","#ffdbac","#e0ac69"][Math.abs(h)%5];
    const shirt=["#4fa4d8","#d84f6f","#5fce7a","#c9a227","#9b6fd8"][Math.abs(h>>3)%5];
    const hair=["#2b2b2b","#5a3825","#c9a227","#8a8a8a"][Math.abs(h>>6)%4];
    const y=a.status==="working"?-1:0;
    cx.fillStyle=hair;cx.fillRect(2,1+y,5,2);
    cx.fillStyle=skin;cx.fillRect(2,3+y,5,3);
    cx.fillStyle=shirt;cx.fillRect(1,6+y,7,5);
    if(a.kind==="subagent"){cx.fillStyle="#e8c170";cx.fillRect(1,6+y,7,1);}
    cx.fillStyle="#111";cx.fillRect(3,4+y,1,1);cx.fillRect(6,4+y,1,1);
    cx.fillStyle={working:"#5fce7a",thinking:"#c9a227",idle:"#7a6f8f",
                  waiting:"#d84f6f",done:"#5fce7a",gone:"#555"}[a.status]||"#7a6f8f";
    cx.fillRect(0,11,3,1);
  });
  window._portraitRAF = requestAnimationFrame(renderPortraits);
}

function fillStats(){
  const box=document.getElementById("statbox");if(!box)return;
  const s=(progress&&progress.stats)||{};
  const byt=s.by_tool||{};
  const short=k=>k.replace(/^mcp__[a-z0-9]+__/i,"").replace(/^mcp__/,"");
  const top=Object.entries(byt).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([k,v])=>short(k)+": "+v).join(" · ")||"—";
  const byp=s.by_platform||{};
  const plats=Object.entries(byp).filter(([k])=>k!=="subagent")
    .map(([k,v])=>k+": "+v).join(" · ")||"—";
  const tools=s.tools||0, sessions=s.sessions||0, errors=s.errors||0;
  const errRate = tools? (100*errors/tools).toFixed(1)+"%" : "—";
  const tps = sessions? (tools/sessions).toFixed(1)+" tools/session" : "—";
  const mix={}; agents.forEach(a=>{mix[a.status]=(mix[a.status]||0)+1;});
  const mixStr = Object.entries(mix).map(([k,v])=>k+": "+v).join(" · ")||"—";
  const waiting = agents.filter(a=>a.status==="waiting")
    .map(a=>a.label||a.id).join(", ")||"none";
  let oldestWait="—";
  const waits=agents.filter(a=>a.status==="waiting"&&a.updated_at);
  if(waits.length){
    const o=waits.slice().sort((a,b)=>a.updated_at-b.updated_at)[0];
    const sec=Math.max(0,Math.floor(Date.now()/1000-o.updated_at));
    oldestWait=(o.label||o.id)+" · waiting "+(sec<60?sec+"s":Math.floor(sec/60)+"m");
  }
  const rows=[
    ["attention needed", waiting],
    ["longest blocked", oldestWait],
    ["live now", agents.length+" ("+mixStr+")"],
    ["rank", (progress&&progress.rank)||"intern"],
    ["xp", (progress&&progress.xp)||0],
    ["sessions", sessions],
    ["tools", tools+" ("+tps+")"],
    ["reads / writes", (s.reads||0)+" / "+(s.writes||0)],
    ["browse / shell", (s.browses||0)+" / "+(s.shells||0)],
    ["subagents", s.subagents||0],
    ["approvals", s.approvals||0],
    ["errors", errors+" ("+errRate+")"],
    ["peak concurrent", s.max_concurrent||0],
    ["by runtime", plats],
    ["top tools", top],
  ];
  let html=rows.map(([k,v])=>
    "<div class='kv'><span>"+k+"</span><b>"+v+"</b></div>").join("");
  const tracked = agents.filter(trackMatch);
  if(agents.length){
    const rankA=a=>a.status==="waiting"?0:a.status==="working"?1:2;
    const sortedA=[...tracked].sort((a,b)=>rankA(a)-rankA(b));
    html+="<p class='h' style='margin-top:10px'>agents ("+tracked.length+"/"+agents.length+(trackQuery?" · filter '"+trackQuery+"'":"")+")</p>"+
      (sortedA.length? sortedA.map(a=>{
        const el=(typeof a.duration_s==="number")?Math.max(0,Math.floor(a.duration_s))
          : (a.first_seen?Math.max(0,Math.floor(Date.now()/1000-a.first_seen)):0);
        const els=el<60?el+"s":Math.floor(el/60)+"m";
        let blocked="";
        if(a.status==="waiting"){
          const bs=(typeof a.idle_s==="number")?Math.max(0,Math.floor(a.idle_s))
            : (a.updated_at?Math.max(0,Math.floor(Date.now()/1000-a.updated_at)):0);
          blocked=" · blocked "+(bs<60?bs+"s":Math.floor(bs/60)+"m");
        }
        const dot=a.status==="waiting"?"#d84f6f":a.status==="working"?"#5fce7a":"#7a6f8f";
        return "<div class='kv'><span><span style='color:"+dot+"'>●</span> "+
          (a.label||a.id).slice(0,18)+" <span class='h'>"+a.status+
          (a.tool?" · "+a.tool:"")+(a.detail?" · "+(a.detail||"").slice(0,24):"")+blocked+"</span></span><b>"+els+"</b></div>";
      }).join("") : "<p class='h'>no match</p>");
  }
  box.innerHTML=html;
  const btn=document.createElement("button");
  btn.type="button"; btn.className="btn"; btn.id="exportTrack";
  btn.textContent="export csv"; btn.style.marginTop="10px";
  btn.onclick=()=>{
    const rows=[["agent","platform","status","tool","detail","elapsed_s","blocked_s"]];
    agents.forEach(a=>{
      const el=(typeof a.duration_s==="number")?Math.max(0,Math.floor(a.duration_s))
        : (a.first_seen?Math.max(0,Math.floor(Date.now()/1000-a.first_seen)):0);
      const bl=(a.status==="waiting")
        ? ((typeof a.idle_s==="number")?Math.max(0,Math.floor(a.idle_s))
          : (a.updated_at?Math.max(0,Math.floor(Date.now()/1000-a.updated_at)):0)) : 0;
      rows.push([a.label||a.id, platOf(a), a.status, a.tool||"", (a.detail||"").slice(0,60), el, bl]);
    });
    const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(",")).join("\n");
    const u=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const link=document.createElement("a");
    link.href=u; link.download="agent-office-tracking.csv"; link.click();
    setTimeout(()=>URL.revokeObjectURL(u), 2000);
  };
  box.appendChild(btn);
}

function toastUnlock(u){
  const el=document.createElement("div");
  el.className="card";
  const isMajor = (u.id||"").includes("layout_") || (u.id||"").includes("pet_") || (u.id==="corner_office");
  if(isMajor) el.style.cssText = "border:2px solid #e8c170;background:#241c30;animation:burst .6s ease-out";
  el.innerHTML="<b>UNLOCKED · "+(u.name||u.id)+"</b><span>"+(u.hint||"new drip")+"</span>";
  document.getElementById("toast").appendChild(el);
  chime([660,880,1100]);
  setTimeout(()=>el.remove(),4200);
}

function applyProgress(p){
  progress=p||null;
  if(!p)return;
  const next=p.next?(" → "+p.next.rank+" @ "+p.next.need):" · max rank";
  const rankEl=document.getElementById("rank");
  if(rankEl){ rankEl.textContent=(p.rank||"intern")+" · "+(p.xp||0)+" xp"; rankEl.title=next.trim(); }
  if(p.next){
    const need=p.next.need;
    const prev=RANKS_THRESHOLDS[p.rank]||0;
    const pct=Math.min(100, Math.max(0, ((p.xp||0)-prev)/(need-prev)*100));
    const fill=document.getElementById("xpfill");
    if(fill)fill.style.width=pct.toFixed(1)+"%";
  }
  const chips=document.getElementById("chips");
  if(chips){
    const plats=(p.stats&&p.stats.platforms&&p.stats.platforms.length)
      ? p.stats.platforms.filter(pl=>pl && pl!=="subagent")
      : ["hermes"];
    const icon={hermes:"hermes",cli:"cli",telegram:"telegram",opencode:"opencode",claude:"claude","claude-code":"claude",gateway:"hermes","main":"hermes"};
    chips.innerHTML=plats.map(pl=>{
      const n=icon[pl]||"hermes";
      return "<img src='assets/"+n+".svg' title='"+pl+"' alt='"+pl+"'>";
    }).join("");
  }
  const grid=document.getElementById("achgrid");
  if(grid){
    grid.innerHTML="";
    const retired=new Set(RETIRED_BADGES||[]);
    const cats=(p.catalog||[]).filter(c=>!retired.has(c.id));
    cats.sort((a,b)=>(b.have?1:0)-(a.have?1:0));
    cats.forEach(c=>{
      const d=document.createElement("div");
      d.className="ach"+(c.have?" have":" locked");
      const pct = c.progress || 0;
      d.innerHTML="<div class='n'>"+(c.have?"★ ":"○ ")+c.name+"</div>"+
        "<div class='h'>"+c.hint+(pct?" · "+pct+"%":"")+"</div>"+
        "<div style='height:3px;background:#151022;margin-top:4px;border:1px solid #3a2f4b'>"+
        "<div style='height:100%;width:"+pct+"%;background:"+(c.have?"#5fce7a":"#e8c170")+
        ";transition:width .3s'></div></div>";
      grid.appendChild(d);
    });
  }
  (p.recent||[]).forEach(u=>{
    if(!u.id||seenUnlocks.has(u.id))return;
    if((RETIRED_BADGES||[]).indexOf(u.id)>=0)return;
    seenUnlocks.add(u.id);
    toastUnlock(u);
  });
  try{localStorage.setItem("pixelOfficeSeen",JSON.stringify([...seenUnlocks]))}catch(e){}
  fillStats();
}

function fillEvents(){
  const box=document.getElementById("eventbox");
  if(!box)return;
  box.innerHTML="";
  const sWrap=document.createElement("div");
  sWrap.className="row";
  sWrap.innerHTML="<input class='txt' id='eventSearch' name='eventSearch' placeholder='search events… (tool/session/text)' style='flex:1' aria-label='search events'>";
  box.appendChild(sWrap);
  const list=document.createElement("div");
  box.appendChild(list);
  const draw=(q)=>{
    list.innerHTML="";
    const ql=(q||"").toLowerCase();
    const evs=_events.slice().reverse().filter(e=>!ql||(e.kind+" "+e.text).toLowerCase().includes(ql));
    if(!evs.length){list.innerHTML="<p class='h'>no matching activity</p>";return}
    evs.slice(0,40).forEach(e=>{
      const d=document.createElement("div");d.className="row";
      d.innerHTML="<span class='n'>"+e.kind.replace("_"," ")+"</span><span class='h'>"+e.text+"</span>";
      list.appendChild(d);
    });
  };
  sWrap.querySelector("#eventSearch").oninput=(e)=>draw(e.target.value);
  draw("");
}

function syncThemeBtn(){
  const b=document.getElementById("themeNextbtn"); if(!b)return;
  const t=THEMES.find(x=>x.id===settings.theme);
  b.textContent=t?t.name.toLowerCase():(settings.theme||"theme");
  b.title="theme · click to cycle (T)";
}
function syncSoundBtn(){
  const sBtn=document.getElementById("sound"); if(!sBtn)return;
  sBtn.textContent="sound";
  sBtn.classList.toggle("on",soundOn);
  sBtn.setAttribute("aria-pressed",soundOn?"true":"false");
}
document.querySelectorAll(".sheet").forEach(el=>{
  const h=el.querySelector("h2");if(!h)return;
  if(h.querySelector(".x"))return;
  const x=document.createElement("button");
  x.type="button";
  x.className="x";
  x.textContent="✕";
  x.setAttribute("aria-label","close");
  x.onclick=closeSheets;
  h.appendChild(x);
});

const $ = id => document.getElementById(id);
function openFloor(){ fillRoster(); fillStats(); toggleSheet("sheet-floor"); }
$("achbtn").onclick=()=>toggleSheet("sheet-unlocks");
$("floorbtn").onclick=openFloor;
$("settingsbtn").onclick=()=>{fillLayout();fillSettings();toggleSheet("sheet-settings");};
$("debugbtn").onclick=()=>{
  $("debugbox").textContent = JSON.stringify({agents:agents.length, progress:progress, settings:settings},null,2);
  toggleSheet("sheet-debug");
};
$("inspectorbtn").onclick=()=>{fillInspector();toggleSheet("sheet-inspector");};
if(/[?&]debug=1\b/.test(location.search)){
  setTimeout(()=>{const b=$("debugbox");if(b)b.textContent=JSON.stringify({agents:agents.length,progress,settings},null,2);toggleSheet("sheet-debug");},800);
}

$("themeNextbtn").onclick=()=>{
  const ids=THEMES.map(t=>t.id);
  const i=ids.indexOf(settings.theme);
  const next=THEMES[(i+1)%THEMES.length].id;
  settings.theme=next;
  saveSettings();
  applyTheme(next);
  fillSettings();
  applyProgress(progress);
  syncThemeBtn();
};
$("filterbtn").onclick=()=>{
  platFilter=FILTERS[(FILTERS.indexOf(platFilter)+1)%FILTERS.length];
  $("filterbtn").textContent=platFilter;
  $("filterbtn").classList.toggle("on", platFilter!=="every");
};
$("sound").onclick=()=>{
  soundOn=!soundOn;
  try{localStorage.setItem("pixelOfficeSound",soundOn?"1":"0")}catch(e){}
  if(soundOn)chime([660]); syncSoundBtn();
};
try{const n=localStorage.getItem("pixelOfficeNight");if(n!==null)window._nightOverride=n==="1"}catch(e){}

if(IN_VSCODE){
  $("spawn").style.display="";
  $("spawn").onclick=()=>vsapi.postMessage({type:"spawnAgent"});
}

document.addEventListener("keydown",(e)=>{
  if(e.target.tagName==="INPUT")return;
  const k=e.key.toLowerCase();
  const map={r:"sheet-floor",u:"sheet-floor",b:"sheet-unlocks",l:"sheet-settings",
             s:"sheet-settings",d:"sheet-debug",e:"sheet-events","?":"sheet-legend",
             t:"themeNext",n:"dayNight"};
  if(k==="escape"){closeSheets();return;}
  const id=map[k];if(!id)return;
  e.preventDefault();
  if(!id.startsWith("sheet-")){
      if(id==="themeNext") $("themeNextbtn").click();
      else if(id==="dayNight") cycleNight();
      return;
  }
  if(id==="sheet-floor"){ fillRoster(); fillStats(); }
  if(id==="sheet-settings"){ fillLayout(); fillSettings(); }
  if(id==="sheet-legend")fillLegend();
  if(id==="sheet-events")fillEvents();
  if(id==="sheet-debug"){
    $("debugbox").textContent=JSON.stringify({agents:agents.length,progress:progress,settings:settings},null,2);
  }
  toggleSheet(id);
});

syncSoundBtn();
syncThemeBtn();
fillLayout();
fillSettings();
