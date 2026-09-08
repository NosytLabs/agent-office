
"use strict";
const IN_VSCODE = typeof acquireVsCodeApi !== "undefined";
const vsapi = IN_VSCODE ? acquireVsCodeApi() : null;
const cv = document.getElementById("c"), ctx = cv.getContext("2d");
let S = 4, agents = [], progress = null, frame = 0, offline = null, platFilter = "every";
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
const FILTERS = ["every","hermes","opencode","claude","telegram","cli"];
function shown(){
  if(platFilter==="every") return agents;
  if(platFilter==="hermes") return agents.filter(a=>platOf(a)==="hermes"||platOf(a)==="cli");
  return agents.filter(a=>platOf(a)===platFilter);
}
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

// ═══ sprite-sheet characters (from pixel-agents, MIT — see ATTRIBUTION.md) ═══
// 112×96 sheet: 3 rows (down,up,right) × 7 frames of 16×32. walk=4f, typing/reading=2f.
const CHAR_FW=16, CHAR_FH=32, CHAR_ROWS=3, CHAR_COLS=7;
const charSheets=[];   // charSheets[i] = {down:[7 canvases], up:[...], right:[...]}
(function loadCharSheets(){
  for(let i=0;i<6;i++){
    const img=new Image();
    img.onload=()=>{
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
function spriteFor(a){
  const loaded=charSheets.filter(s=>s&&s.down&&s.down[0]);
  if(!loaded.length)return null;
  const sheet=loaded[hash(a.id)%loaded.length];
  if(!sheet)return null;
  // sheet layout (verified): col 0 = idle stand, cols 1-6 = 6-frame walk. no typing frames.
  // walking uses the row matching the agent's facing (tracked in stepChars);
  // left = mirrored right row since the sheet has no left row.
  if(!seatedNow(a)){
    const f=1+((frame>>3)%6);
    const face=(typeof chars!=="undefined"&&chars.get(a.id)&&chars.get(a.id).face)||"down";
    if(face==="up")return {cv:sheet.up[f],flip:false};
    if(face==="down")return {cv:sheet.down[f],flip:false};
    return {cv:sheet.right[f],flip:face==="left"};
  }
  // seated: idle stand, no foot-slide. typing/reading energy comes from the
  // monitor glow + 1px bob in drawChar, not walk frames.
  return {cv:sheet.down[0],flip:false}; // idle
}
function seatedNow(a){return a.status!=="gone"&&a.status!=="walking"}
function drawClock(x,y){
  px(x,y,5,5,"#1a1423"); px(x+1,y+1,3,3,"#e8e0d0");
  px(x+2,y+2,1,1,"#3a2f4b"); px(x+2,y+1,1,1,"#1a1423"); px(x+3,y+2,1,1,"#1a1423");
}

// ═══ decor sprite images (pets + furniture, from pixel-agents MIT) ═══
// only sheets actually drawn: pets, door, bookshelf, sofa, plants, coffee, bins, parcel
const decorImg={};  // name -> HTMLImageElement
["pets/claudio.png","pets/gitcat.png","furniture/LARGE_PLANT.png","furniture/CACTUS.png",
 "furniture/BOOKSHELF.png","furniture/SOFA_FRONT.png","furniture/BIN.png",
 "furniture/DOOR.png","furniture/COFFEE.png","furniture/PACKAGE.png"]
 .forEach(p=>{const im=new Image();im.src="assets/sprites/"+p;decorImg[p.split("/")[1].replace(".png","")]=im;});
function drawDecorImg(name,dx,dy,dw,dh){
  const im=decorImg[name];
  if(im&&im.complete&&im.naturalWidth>0){
    ctx.imageSmoothingEnabled=false;
    const boxW=Math.max(1,dw*S), boxH=Math.max(1,dh*S);
    const boxX=dx*S, boxY=dy*S;
    // pet sheets are 96x96 = 6 cols x 3 rows of 16x32 — cols 0-5 only.
    // idle = col 0; walking cycles cols 1-5.
    if(im.naturalWidth===96&&im.naturalHeight===96){
      const fw=16,fh=32;
      const stepping=(frame>>4)%2;
      const col=stepping?1+((frame>>3)%5):0;
      const sx=col*fw, sy=0;
      const pcs = charScale();
      const pw = fw*pcs, ph = fh*pcs;
      const px0 = Math.round(boxX + boxW/2 - pw/2), py0 = Math.round(boxY + boxH - ph);
      ctx.drawImage(im,sx,sy,fw,fh,px0,py0,pw,ph);
      return true;
    }
    // furniture: integer nearest-neighbor scale, contain, bottom-center.
    // crop transparent padding first — cactus/plant sheets are half-empty and
    // otherwise render as tiny blobs in a huge dest box.
    const bb=opaqueBox(im);
    const sc=Math.max(1, Math.floor(Math.min(boxW/bb.sw, boxH/bb.sh)));
    const pw=bb.sw*sc, ph=bb.sh*sc;
    const px0=Math.round(boxX + (boxW-pw)/2), py0=Math.round(boxY + boxH - ph);
    ctx.drawImage(im,bb.sx,bb.sy,bb.sw,bb.sh,px0,py0,pw,ph);
    return true;
  }
  return false;
}

let _gw=0,_gh=0;
function drawOffice(w,h,cosmetics){
  cosmetics=cosmetics||window._cosmetics||[];
  const dark=night();
  const themeObj = window._theme || {};
  const geom = LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  // theme sets the palette directly — no blending math, what you pick is what you get
  const tileA = themeObj.tileA||geom.floor[0];
  const tileB = themeObj.tileB||geom.floor[1];
  const wall  = themeObj.wall||geom.wall;
  const isMidnight = themeObj.id==="midnight";
  const isForest = themeObj.id==="forest";
  for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4)
    px(x,y,4,4,((x+y)/4)%2?tileA:tileB);
  // back wall + trim + wainscoting
  px(0,0,w,8,wall); px(0,8,w,1,"#1a1423"); px(0,18,w,1,"#221c2e");
  // windows
  for(let x=22;x<Math.min(w-14, _gw-10);x+=22){
    px(x,2,12,5,"#151022");
    if(dark){
      px(x+1,3,10,3,"#151a33");
      if((frame>>4)%2)px(x+3,4,1,1,"#e8e0c8");
      if((x/22|0)%2)px(x+8,3,1,1,"#fff8c8");
    }else{
      px(x+1,3,10,3,"#7fa8d8"); px(x+2,3,3,1,"#c8dff8");
    }
    px(x,6,12,1,"#3a2f4b"); px(x,2,1,5,"#3a2f4b"); px(x+11,2,1,5,"#3a2f4b");
    if(dark && (frame>>5)%2===0){
      // warm lamplight pooling on the floor below the window
      ctx.globalAlpha=0.10;
      px(x-2,10,16,4,"#e8c170");
      ctx.globalAlpha=1;
    }
  }
  // door
  {
    // use the DOOR sprite if available (better detail than procedural drawing)
    if(drawDecorImg("DOOR", 2, 2, 9, 9)){
      // knob already drawn in sprite; just add a small shadow underneath
      px(2,11,9,1,"#1a1423");
    } else {
      // fallback procedural door
      const doorWood = isMidnight ? "#1a1423" : isForest ? "#3a2810" : "#5a3a1f";
      const doorFrame = isMidnight ? "#2a1f3a" : isForest ? "#4a3a20" : "#7a5028";
      const doorInner = isMidnight ? "#1a1428" : isForest ? "#3a2a14" : "#3c2814";
      const doorPanel = isMidnight ? "#3a2a5a" : isForest ? "#5a4a2a" : "#a07040";
      px(2,2,9,9,doorWood); px(3,3,1,7,"#1a1423"); px(10,3,1,7,"#1a1423");
      px(3,3,8,8,doorFrame); px(4,4,6,6,doorPanel); px(5,5,4,4,doorInner);
      px(10,6,1,1,"#e8c170"); px(10,7,1,1,"#c9a227");
    }
  }
  // neon sign — kept fully inside the wall (top-left corner of office)
  // position AFTER the 2nd bookshelf (x=24..33) to avoid overlap
  const nx=Math.max(2,Math.min(w-26, 36));
  px(nx,2,24,5,"#151022"); px(nx,6,24,1,"#3a2f4b");
  ctx.font="10px ui-monospace"; ctx.textAlign="left";
  ctx.fillStyle=dark?"#ff6ad5":"#e8c170";
  ctx.fillText("AGENT",(nx+1)*S,(6)*S);
  // rug — varies per layout decor
  const decor = LAYOUT_GEOMETRY[settings.layout]?.decor || "rug";
  if(decor==="library"){
    // bookshelves along the back wall — start AFTER the door at x=2 (door spans 2..10)
    drawDecorImg("BOOKSHELF",12,4,10,5);
    drawDecorImg("BOOKSHELF",24,4,10,5);
    drawDecorImg("BOOKSHELF",w-30,4,10,5);  // before kitchenette
    const rugY = Math.max(20, h-7);
    const rw=Math.min(28,w-16); px((w-rw)/2,rugY,rw,2,"#4a3020");
    px((w-rw)/2+1,rugY+1,rw-2,1,"#5c3e2a");
    drawDecorImg("BIN",w-12,h-8,3,3);
  }else if(decor==="lounge"){
    // sofa + wall clock + plant corner — chill room
    // place sofa in the bottom band so it doesn't fight agent chairs
    const sofaY = Math.max(20, h-12);
    drawDecorImg("SOFA_FRONT",w/2-14,sofaY,28,10);
    drawClock(w-14, 2);
    drawDecorImg("CACTUS",Math.max(14, w-34),h-16,6,12);
    const rw=Math.min(40,w-12); px((w-rw)/2,sofaY-3,rw,3,"#2f4a42");
    px((w-rw)/2+1,sofaY-2,rw-2,2,"#3a5c50");
  }else if(decor==="bullpen"){
    // utilitarian: bins between desk clusters + one cactus
    drawDecorImg("BIN",w/2-1,h-9,3,3);
    drawDecorImg("CACTUS",w-14,h-16,4,8);
  }else if(decor==="rug"){
    const rw=Math.min(28,w-12); px((w-rw)/2,h-13,rw,6,dark?"#3a2048":"#3a2f4b");
    px((w-rw)/2+1,h-12,rw-2,4,dark?"#4a2860":"#443358");
  }
  // kitchenette against the right wall: counter + coffee sprite + cooler, grouped
  const kx=w-24;
  // counter top
  px(kx,h-10,14,1,"#6b4a2f"); px(kx,h-9,14,3,"#54381f");
  // coffee machine — use the sprite for clarity
  if(!drawDecorImg("COFFEE",kx,h-20,6,8)){
    // fallback procedural coffee machine if sprite fails to load
    px(kx+2,h-19,5,3,"#33283f"); px(kx+3,h-18,3,1,"#3e334f");
    px(kx+3,h-19,1,1,"#d84f6f"); px(kx+5,h-18,1,1,"#e8c170");
  }
  // steam wisps rising from the machine (animated, 3-frame drift)
  if((frame>>3)%7<5){
    const ph=(frame>>3)%3;
    const sx=kx+4, sy=h-21;
    if(ph===0)px(sx,sy,1,1,"#c8c8d8");
    else if(ph===1){px(sx-1,sy-1,1,1,"#b8b8cc");px(sx+1,sy,1,1,"#c8c8d8");}
    else {px(sx,sy-2,1,1,"#a8a8c0");px(sx-2,sy-1,1,1,"#b8b8cc");px(sx+2,sy-1,1,1,"#c8c8d8");}
  }
  px(kx+9,h-19,3,3,"#7fa8d8"); px(kx+10,h-20,1,1,"#a8c8e8");       // cooler jug
  px(kx+9,h-16,3,1,"#4a4a5a");                                      // cooler base
  // plant (left wall) — sprite version when loaded, procedural fallback
  const plantX = Math.max(4, 2);
  const plantY = Math.max(20, h-26);
  if(!drawDecorImg("LARGE_PLANT",plantX-1,plantY-9,8,12)){
    px(plantX,plantY,4,2,"#4aa860"); px(plantX-1,plantY-2,3,3,"#5fce7a");
    px(plantX+2,plantY-1,3,2,"#4aa860"); px(plantX-1,plantY,1,2,"#5fce7a");
    px(plantX+1,plantY+2,2,4,"#8d5524"); px(plantX,plantY+6,4,1,"#54381f"); px(plantX+1,plantY+5,1,1,"#6b4a2f");
  }
  // small flower
  if((frame>>4)%2) px(plantX,plantY-2,1,1,"#e8c170");
  // fish tank — left of the cat, on the floor (bigger + more visible)
  if(cosmetics && cosmetics.includes("fish_tank")){
    const fx = Math.max(2, w-22), fy = h-4;
    // tank body (glass) - bigger
    px(fx,fy-8,8,7,"#4fa4d8");
    px(fx+1,fy-8,6,1,"#7fa8d8");        // water surface highlight
    px(fx+7,fy-8,1,7,"#2b6fa8");        // glass edge
    px(fx,fy-9,8,1,"#5a5040");          // tank top rim
    px(fx,fy-1,8,1,"#3c2814");          // tank base
    // fish silhouette (animated)
    const fcol = (frame>>5)%3;
    px(fx+2+fcol,fy-5,2,1,"#e8c170");    // gold fish body
    px(fx+1+fcol,fy-5,1,1,"#e8c170");    // tail
    px(fx+3+fcol,fy-5,1,1,"#1a1a1a");    // eye
    // bubbles rising
    px(fx+5,fy-7-(frame>>4)%3,1,1,"#a8c8e8");
    px(fx+3,fy-3-(frame>>3)%2,1,1,"#a8c8e8");
  }
  // storm lamp (weather_storm unlock): small red warning lamp by the door
  if(cosmetics && cosmetics.includes("storm_lamp")){
    const lx=12, ly=9;
    px(lx,ly,2,2,(frame>>4)%2?"#d84f6f":"#7a2020");
    px(lx,ly+2,2,1,"#3a2f4b");
  }
  // cat — bottom-right corner, ON the floor line (feet at h-4)
  // office_cat cosmetic (pet_cat unlock): a second cat lounges by the kitchenette
  const cx=Math.max(16, w-6), cy=h-5;
  if(cosmetics && cosmetics.includes("office_cat")){
    const ox=kx-8, oy=h-5;
    px(ox,oy,4,2,"#8a6a4a"); px(ox-1,oy+1,6,1,"#6a4a2a");          // curled body
    px(ox+3,oy-1,2,2,"#8a6a4a"); px(ox+3,oy-2,1,1,"#6a4a2a");      // head + ear
    if((frame>>6)%8) px(ox+4,oy,1,1,"#1a1423");                    // eye, mostly closed (sleeping)
    px(ox-2,oy-1,1,3,"#8a6a4a");                                    // tail curled up
  }
  if(!drawDecorImg("claudio",cx-5,cy-8,8,8)){
    // body
    px(cx-2,cy-1,5,3,"#c9a227"); px(cx-2,cy+1,6,1,"#a0801a");
    px(cx-1,cy,1,1,"#a0801a"); px(cx+1,cy,1,1,"#a0801a"); px(cx+3,cy,1,1,"#a0801a");
    // head
    px(cx+2,cy-3,4,3,"#c9a227");
    // ears
    px(cx+2,cy-4,1,1,"#a0801a"); px(cx+4,cy-4,1,1,"#a0801a");
    // eyes (open during day / when awake)
    if(!dark||(frame>>5)%2){px(cx+3,cy-2,1,1,"#1a1423");px(cx+5,cy-2,1,1,"#1a1423");}
    // tail with tip
    px(cx-3,cy-1,1,2,"#c9a227"); px(cx-4,cy-2,1,1,"#a0801a");
  }
  // dog companion (left wall) — gitcat sprite when loaded, procedural fallback
  if(haveUnlock && haveUnlock("pet_dog")){
    const dx=18, dy=h-6;   // right of LARGE_PLANT, not on top of it
    if(!drawDecorImg("gitcat",dx-2,dy-6,6,6)){
      px(dx,dy,5,3,"#d97746"); px(dx+1,dy-1,1,1,"#d97746"); px(dx+3,dy-1,1,1,"#d97746");
      px(dx+4,dy,1,1,"#d97746"); px(dx+1,dy+1,1,1,"#a04020"); px(dx+4,dy+1,1,1,"#a04020");
      if(((frame>>3)%2)) px(dx+5,dy-1,2,1,"#a04020");
    }
  }
  // (fish tank renders once above via the fish_tank cosmetic — no duplicate here)
  // bob animation when petted
  const bob = petBounce ? ((petTimer>>1)%2) : 0;
  if(bob && !decorImg.claudio?.complete){px(cx+2,cy-5,4,1,"#fff8c8");}
  if(petBounce){petTimer--; if(petTimer<=0)petBounce=false;}
  // ── night lighting pass ──
  // dim the whole scene, then punch warm light pools back in around light sources
  if(dark){
    ctx.fillStyle="rgba(8,6,20,0.42)";                 // ambient night dim
    ctx.fillRect(0,0,w*S,h*S);
    ctx.globalCompositeOperation="lighter";             // additive glow
    const pool=(x,y,r,c)=>{                             // radial light pool
      const g=ctx.createRadialGradient(x*S,y*S,1,x*S,y*S,r*S);
      g.addColorStop(0,c); g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=g; ctx.fillRect(x*S-r*S,y*S-r*S,2*r*S,2*r*S);
    };
    const flick=(frame>>3)%5===0?0.8:1;                 // subtle neon flicker
    pool(nx+12,5,26,"rgba(232,120,200,"+(0.22*flick)+")");  // AGENT neon sign
    pool(w-17,h-14,20,"rgba(255,190,90,0.20)");             // kitchenette
    pool(plantX+2,plantY,12,"rgba(120,220,150,0.10)");      // plant uplight
    // monitor glow from each seated agent desk
    for(const d of (window._deskAnchors||[])){ pool(d[0]+4,d[1]-2,14,"rgba(110,180,255,0.14)"); }
    ctx.globalCompositeOperation="source-over";
  }
}

function drawDesk(x,y,a,cosmetics,frontOnly){
  const gold=cosmetics.includes("gold_monitor");
  // 3 unlockable desk types (were granted but never rendered):
  // wood = warm wide desk, standing = taller legs + higher slab, glass = blue top.
  const standing=cosmetics.includes("desk_standing");
  const glass=cosmetics.includes("desk_glass");
  const wood=!standing&&!glass&&cosmetics.includes("desk_wood");
  const lift=standing?2:0;
  let h=0; for(const c of a.id) h=(h*31+c.charCodeAt(0))>>>0;
  const finishes=[
    {top:"#c4894a",slab:"#8d5524",front:"#6b3e1c",leg:"#3c2814",edge:"#e8c170"},
    {top:"#d4a05a",slab:"#b08040",front:"#8d6530",leg:"#4a3420",edge:"#f0d090"},
    {top:"#6a5a7a",slab:"#4a3a5a",front:"#2c2138",leg:"#1e1628",edge:"#9b8ab0"},
  ];
  const fin = finishes[h%3];
  const top = glass?"#7fb8d8":wood?"#e0aa5e":fin.top;
  const slab = glass?"#4a88b0":fin.slab;
  if(!frontOnly){
    // chair: seat + back, behind the sitter
    px(x+2,y+8,7,1,fin.leg);
    px(x+2,y+9,1,6,fin.leg); px(x+8,y+9,1,6,fin.leg);
    px(x+3,y+14,5,2,fin.front); // seat
    if(standing){ px(x+1,y+15,2,5,fin.leg); px(x+15,y+15,2,5,fin.leg); }
    else { px(x+1,y+17,2,3,fin.leg); px(x+15,y+17,2,3,fin.leg); }
  }
  // desk body — thick enough to read as furniture, not a brown stamp
  px(x,y+11-lift,18,1,glass?"#cfe8f5":fin.edge);
  px(x,y+12-lift,18,2,top);
  px(x,y+14-lift,18,3,slab);
  px(x,y+17,18,1,fin.front);
  // keyboard
  px(x+3,y+12-lift,7,2,"#2a2438"); px(x+4,y+12-lift,5,1,"#4a4460");
  // monitor: bezel + lit screen (must contrast with the dark room)
  px(x+11,y+3,7,8, gold?"#5a4010":"#0c0a12");
  px(x+12,y+4,5,6, gold?"#c9a227":"#1a3d28");
  px(x+13,y+11,3,1,"#4a4a5a"); // stand
  px(x+12,y+12,5,1,"#3a3a48");
  if(cosmetics.includes("mug")){px(x+10,y+10,2,2,"#d84f6f");px(x+12,y+10,1,1,"#d84f6f")}
  // fern replaces the smaller plant — stacking both was a green blob on the desk
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
  // health bar shows waiting vs working progress; only for focused agent
  if(focusedId !== a.id) return;
  const barW=18;
  const fill = a.status==="working"?0.6:a.status==="thinking"?0.4:
               a.status==="waiting"?0.1:a.status==="done"?1.0:0.2;
  const col = a.status==="waiting"?"#d84f6f":
              a.status==="working"?"#5fce7a":
              a.status==="done"?"#9b6fd8":"#c9a227";
  ctx.fillStyle="#1a1423";
  ctx.fillRect(x*S, (y-2)*S, barW*S, 2*S);
  ctx.fillStyle=col;
  ctx.fillRect(x*S, (y-2)*S, Math.max(1,barW*fill)*S, 2*S);
}
function drawChar(a,fx,fy,seated,cosmetics){
  cosmetics=cosmetics||[];
  const h=hash(a.id), skin=SKIN[h%SKIN.length], shirt=SHIRT[(h>>3)%SHIRT.length],
        hair=HAIR[(h>>6)%HAIR.length], t=frame>>4;
  const walking=!seated, bob=((a.status==="working"||walking)&&(t%2))?1:0;
  const x=fx, y=fy+bob;
  if(a.status==="gone")ctx.globalAlpha=0.35;
  // ── sprite-sheet path: real 16×32 pixel-art frames when loaded ──
  const spr=spriteFor(a);
  if(spr){
    // drop shadow (polish cue from upstream)
    ctx.fillStyle="rgba(0,0,0,0.30)";
    // 16×32 source. Cap at 3× so S=8 → 48×96: head above the slab, not eating the desk.
    const cs = charScale();
    ctx.fillRect(Math.round((x+1)*S), Math.round((y+14)*S), 8*cs, 1*cs);
    ctx.imageSmoothingEnabled=false;
    const sx0 = Math.round((x+1)*S), sy0 = Math.round((y+12)*S - CHAR_FH*cs);
    // cape BEHIND the sprite — overlaying a 10×12 block was the "glitched agent" look
    if(cosmetics.includes("cape")){
      ctx.fillStyle="rgba(122,48,48,0.92)";
      ctx.fillRect(sx0+0*cs, sy0+12*cs, 3*cs, 16*cs);
      ctx.fillRect(sx0+13*cs, sy0+12*cs, 3*cs, 16*cs);
    }
    const pw=CHAR_FW*cs, ph=CHAR_FH*cs;
    if(spr.flip){
      // sheet has no left row — mirror the right row
      ctx.save(); ctx.translate(Math.round(sx0+pw/2),0); ctx.scale(-1,1);
      ctx.drawImage(spr.cv, 0,0,CHAR_FW,CHAR_FH, -pw/2, sy0, pw, ph);
      ctx.restore();
    } else {
      ctx.drawImage(spr.cv, 0,0,CHAR_FW,CHAR_FH, sx0, sy0, pw, ph);
    }
    const hx = (sx0 + 4*cs)/S, hy = (sy0 + 0)/S;   // head-top in tile coords
    if(cosmetics.includes("crown")){px(hx,hy,5*cs/S,2*cs/S,"#e8c170");px(hx+1,hy-cs/S,cs/S,cs/S,"#e8c170");px(hx+3,hy-cs/S,cs/S,cs/S,"#e8c170")}
    else if(cosmetics.includes("beanie")){px(hx-1,hy,7*cs/S,2*cs/S,"#d84f6f");px(hx+1,hy-cs/S,3*cs/S,cs/S,"#d84f6f")}
    if(cosmetics.includes("orange_scarf")){ctx.fillStyle="#d97a3a";ctx.fillRect(sx0+2*cs,sy0+9*cs,12*cs,2*cs);}
    ctx.globalAlpha=1;
    return;
  }
  // ── procedural fallback (sheets still loading) ──
  // cape / cloak
  if(cosmetics.includes("cape")){px(x,y+5,8,6,"#7a3030");px(x+1,y+6,1,2,"#8a4040")}
  // hair with highlight
  px(x+2,y,5,3,hair);
  if(h%3===0)px(x+1,y+1,1,3,hair);
  if(h%5===0)px(x+2,y-1,5,1,hair);
  px(x+3,y+1,1,1,lighten(hair));
  // hats / visor / crown / beanie / headphones
  if(cosmetics.includes("crown")){px(x+2,y-2,5,2,"#e8c170");px(x+3,y-3,1,1,"#e8c170");px(x+5,y-3,1,1,"#e8c170")}
  else if(cosmetics.includes("beanie")){px(x+1,y-1,6,2,"#d84f6f");px(x+3,y-2,2,1,"#d84f6f")}
  else if(cosmetics.includes("visor") && a.platform==="opencode"){px(x+1,y+1,6,1,"#4fa4d8")}
  if(cosmetics.includes("headphones")){px(x+1,y+1,1,3,"#2b2b2b");px(x+7,y+1,1,3,"#2b2b2b");px(x+2,y,5,1,"#2b2b2b")}
  // face with cheeks
  px(x+2,y+2,5,3,skin);
  px(x+3,y+4,1,1,darken(skin)); px(x+5,y+4,1,1,darken(skin));
  if(h%4===0||cosmetics.includes("plant")){px(x+2,y+3,2,1,"#222a44");px(x+5,y+3,2,1,"#222a44")}
  else{px(x+3,y+3,1,1,"#111");px(x+6,y+3,1,1,"#111")}
  px(x+4,y+4,1,1,"#ffb6c1"); px(x+6,y+4,1,1,"#ffb6c1");
  // body with collar
  px(x+1,y+5,7,5,shirt);
  px(x+3,y+5,3,1,lighten(shirt));
  if(a.kind==="subagent"||cosmetics.includes("gold_trim"))px(x+1,y+5,7,1,"#e8c170");
  if(cosmetics.includes("pin") && a.platform==="telegram")px(x+6,y+6,1,1,"#4fa4d8");
  // orange scarf (claude_desk unlock) draped over the shoulders
  if(cosmetics.includes("orange_scarf")){px(x+1,y+5,7,1,"#d97a3a");px(x+1,y+6,1,2,"#d97a3a");px(x+7,y+6,1,2,"#d97a3a");}
  px(x+0,y+6,1,3,skin); px(x+8,y+6,1,3,skin);
  if(walking){
    if(t%2){px(x+2,y+10,2,3,"#2d2d3d");px(x+5,y+11,2,2,"#2d2d3d");px(x+9,y+9,1,1,"#e8c170")}
    else{px(x+2,y+11,2,2,"#2d2d3d");px(x+5,y+10,2,3,"#2d2d3d");px(x+8,y+9,1,1,"#e8c170")}
  }else{
    px(x+2,y+10,2,3,"#2d2d3d"); px(x+5,y+10,2,3,"#2d2d3d");
  }
  // mood ring — small colored dot above the head, hidden for active states
  if(seated && a.status === "idle"){
    const mc = (a.activity==="delegating") ? "#d84f6f"
              : (a.activity==="reading") ? "#9b6fd8"
              : (a.activity==="typing") ? "#e8c170"
              : "#7a6f8f";
    px(x+4, y-2, 1, 1, mc);
  }
  if(seated){
    if(a.activity==="typing"&&(frame>>2)%2)px(x+8,y+8,2,1,skin);
    else if(a.activity==="running"&&t%2)px(x+8,y+8,2,1,skin);
    else if(a.activity==="reading"){px(x+8,y+7,3,2,"#e8e0c8");px(x+9,y+7,1,2,"#b8b0a0")}
    else if(a.activity==="delegating"&&t%2)px(x+9,y+6,2,1,skin);
  }
  ctx.globalAlpha=1;
}
function drawBubble(a,x,y){
  const t=frame>>4;
  if(a.status==="waiting"){
    const by=y-6-((frame>>3)%2);
    px(x+1,by,6,4,"#f5e6c8"); px(x+2,by+4,1,1,"#f5e6c8"); px(x,by+2,1,1,"#f5e6c8");
    px(x+4,by+1,1,2,"#c9302f"); px(x+4,by+3,1,1,"#c9302f");
    ctx.save();
    ctx.font="9px ui-monospace,monospace";
    ctx.fillStyle="#1a1423";ctx.textAlign="left";
    const txt = (a.detail||"approval!").slice(0,10);
    if(txt){
      // keep the bubble text inside the cell by drawing leftward when seat is on the right
      const tx2 = (x>=8) ? (x-12) : (x+8);
      ctx.fillStyle="#f5e6c8";
      ctx.fillRect(tx2*S, (by-1)*S, 12*S, 5*S);
      ctx.fillStyle="#1a1423";
      ctx.fillText(txt,(tx2+1)*S,(by+2)*S);
    }
    ctx.restore();
  }else if(a.status==="working"&&a.tool){
    // 4px pip on the monitor bezel — NOT a 3×S gold brick over the head
    ctx.fillStyle="#e8c170";
    ctx.fillRect((x+16)*S-4, (y+3)*S, 4, 4);
  }else if(a.status==="thinking"){
    const flip=(frame>>5)%2;
    // mood ball is now a 3-pixel thinking bubble that color-shifts by mood
    const mood = (a.activity==="delegating") ? "#d84f6f"   // delegating = stressed
                : (a.activity==="reading") ? "#9b6fd8"      // reading = focused
                : (a.activity==="typing") ? "#e8c170"      // typing = excited
                : "#cfc4e8";                                              // thinking = neutral
    if(!flip){
      px(x+2,y-3,1,2,mood); px(x+4,y-3,1,2,mood);
      px(x+3,y-2,1,1,mood);
    }else{
      px(x+2,y-4,2,1,mood); px(x+3,y-2,2,1,mood);
      px(x+4,y-1,1,1,mood);
    }
  }else if(a.status==="done"){
    px(x+2,y-4,1,1,"#5fce7a");px(x+3,y-3,1,1,"#5fce7a");
    px(x+4,y-4,1,1,"#5fce7a");px(x+5,y-5,1,1,"#5fce7a");
  }else if(a.status==="idle"&&(t%8)<4){
    px(x+6,y-4,1,1,"#7a6f8f");px(x+7,y-5,1,1,"#7a6f8f");
  }
}
function platOf(a){
  const p=String((a&&a.platform)||"").toLowerCase();
  if(p.includes("opencode")) return "opencode";
  if(p.includes("telegram")) return "telegram";
  if(p.includes("claude")) return "claude";
  if(p==="cli") return "cli";
  return "hermes";
}
function drawLogo(plat,x,y){
  if(plat==="opencode"){
    px(x,y,5,4,"#0d3b2e"); px(x+1,y+1,1,1,"#5fce7a"); px(x+2,y+2,2,1,"#5fce7a"); px(x,y+3,1,1,"#4aa860");
  }else if(plat==="telegram"){
    px(x,y+1,5,2,"#4fa4d8"); px(x+3,y,2,1,"#a8d4f0"); px(x+4,y+2,1,1,"#2b6fa8"); px(x+1,y+3,1,1,"#8fc8e8");
  }else if(plat==="claude"){
    px(x,y,5,4,"#2b1a12"); px(x+1,y+1,3,2,"#d97746"); px(x+2,y+2,1,1,"#ff8c5a");
  }else if(plat==="cli"){
    px(x,y,5,4,"#191524"); px(x+1,y+1,1,2,"#e8c170"); px(x+3,y+2,1,1,"#e8c170"); px(x+2,y+3,1,1,"#fff8c8");
  }else{
    px(x+1,y,1,4,"#e8c170"); px(x+3,y,1,4,"#e8c170"); px(x+1,y+1,3,1,"#e8c170"); px(x+2,y+2,1,1,"#fff8c8");
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

let petBounce=false, petTimer=0;
let soundOn=false, audioCtx=null;
try{soundOn=localStorage.getItem("pixelOfficeSound")==="1"}catch(e){}
let settings = {layout:"open",theme:"default",sound:soundOn,show_chips:true,
  show_subagent_chips:false,auto_focus_unlocks:true,max_chars:4,areas:{},moods_clicked:0,sheets_opened:[],did_import:false,
  folder_areas:{},paint:false,paint_color:"#5fce7a",painted:{},lock_floor:false,fog:false};
// RANKS / RANKS_THRESHOLDS / THEMES / LAYOUTS / LAYOUT_GEOMETRY / PLATFORMS / SHORTCUTS are top-level globals from data.js
const AREA_PALETTE = ["#5fce7a","#4fa4d8","#d97746","#9b6fd8","#d84f6f","#c9a227","#7a8ad8","#e8c170"];
const THEME_DAILY = ["Lobby","Studio","Tower","Loft","Bunker","Reading Room","Dojo","Salon","Lab","Pier","Atrium","Cabin"];
function haveUnlock(id){return progress && (progress.catalog||[]).find(c=>c.id===id&&c.have)}

function fillLayout(){
  const box=document.getElementById("layoutbox");
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

function fillAreas(){
  const box=document.getElementById("areabox");
  box.innerHTML="";
  const cur = settings.areas || {};
  const keys = Object.keys(cur);
  if(!keys.length){
    box.innerHTML="<p class='h'>No areas yet. Add one to paint zones on the floor and assign folders to them.</p>";
  } else {
    keys.forEach(name=>{
      const row=document.createElement("div");
      row.className="row";
      const esc=name.replace(/'/g,"&#39;");
      row.innerHTML="<span class='swatch' style='background:"+cur[name]+"'></span>"+
        "<input class='txt' value='"+esc+"' data-name='"+esc+"' style='flex:1'>"+
        "<button type='button' class='btn' data-rm='"+esc+"'>remove</button>";
      box.appendChild(row);
    });
  }
  const add=document.createElement("div");
  add.className="row";
  add.innerHTML="<input class='txt' id='newArea' name='newArea' placeholder='new area name' aria-label='new area name'>"+
    "<button type='button' class='btn' id='addArea'>add area</button>";
  box.appendChild(add);
  box.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{
    delete settings.areas[b.getAttribute("data-rm")];
    saveSettings();fillAreas();
  });
  box.querySelectorAll("[data-name]").forEach(i=>{ i.id="area-name-"+i.getAttribute("data-name").replace(/\W/g,"_"); i.name=i.id; i.onchange=()=>{
    const old=i.getAttribute("data-name"), nw=i.value.trim();
    if(!nw||nw===old)return;
    settings.areas[nw]=settings.areas[old];delete settings.areas[old];
    saveSettings();fillAreas();
  }; });
  box.querySelectorAll(".swatch").forEach(s=>s.onclick=()=>{
    const name=s.nextElementSibling.value;
    settings.areas[name]=AREA_PALETTE[(Object.keys(settings.areas).indexOf(name))%AREA_PALETTE.length];
    saveSettings();fillAreas();
  });
  document.getElementById("addArea").onclick=()=>{
    const v=document.getElementById("newArea").value.trim();
    if(!v||settings.areas[v])return;
    settings.areas[v]=AREA_PALETTE[Object.keys(settings.areas).length%AREA_PALETTE.length];
    saveSettings();fillAreas();
  };
  const fr=document.createElement("div");fr.className="row";
  fr.innerHTML="<input class='txt' id='newFolder' name='newFolder' placeholder='/path/to/project' style='flex:1' aria-label='folder path'>"+
    "<select class='txt' id='newFolderArea' name='newFolderArea' aria-label='target area'>"+(keys.map(k=>"<option>"+k+"</option>").join("")||"<option>api</option>")+"</select>"+
    "<button type='button' class='btn' id='addFolder'>map</button>";
  box.appendChild(fr);
  if(Object.keys(settings.folder_areas||{}).length){
    Object.entries(settings.folder_areas).forEach(([f,a])=>{
      const row=document.createElement("div");row.className="row";
      const esc=f.replace(/'/g,"&#39;");
      row.innerHTML="<div style='flex:1'><div class='n'>"+f+"</div><div class='h'>→ "+a+"</div></div>"+
        "<button type='button' class='btn' data-unmap='"+esc+"'>unmap</button>";
      box.appendChild(row);
    });
    box.querySelectorAll("[data-unmap]").forEach(b=>b.onclick=()=>{
      delete settings.folder_areas[b.getAttribute("data-unmap")];
      saveSettings();fillAreas();
    });
  }
  document.getElementById("addFolder").onclick=()=>{
    const f=document.getElementById("newFolder").value.trim();
    const a=document.getElementById("newFolderArea").value;
    if(!f||!a)return;
    settings.folder_areas[f]=a;
    saveSettings();fillAreas();
  };
}

function fillSettings(){
  const box=document.getElementById("settingsbox");box.innerHTML="";
  const items=[
   ["show_chips","runtime chips",settings.show_chips],
   ["paint","paint mode (drag to color)",settings.paint],
   ["lock_floor","lock to floor (no animations)",settings.lock_floor],
   ["fog","fog of war (unexplored dark)",settings.fog],
 ];
  items.forEach(([k,label,on])=>{
    const r=document.createElement("div");r.className="row";
    r.innerHTML="<div style='flex:1'><div class='n'>"+label+"</div></div>"+
      "<button type='button' class='btn "+(on?"on":"")+"' data-tog='"+k+"' role='switch' aria-checked='"+(on?"true":"false")+"' aria-label='"+label+"'>"+(on?"on":"off")+"</button>";
    box.appendChild(r);
  });
  box.querySelectorAll("[data-tog]").forEach(b=>b.onclick=()=>{
    const k=b.getAttribute("data-tog");settings[k]=!settings[k];
    saveSettings();fillSettings();applyProgress(progress);
    if(k==="fog")syncFogBtn();
  });
  const r=document.createElement("div");r.className="row";
  r.innerHTML="<div style='flex:1'><div class='n'>grid columns</div></div>"+
    "<input class='txt' type='number' id='mc' name='max_chars' min='2' max='8' value='"+settings.max_chars+"' style='width:60px' aria-label='grid columns'>"+
    "<span class='dim' style='font-size:10px;margin-left:6px'>desks per row</span>";
  box.appendChild(r);
  document.getElementById("mc").onchange=(e)=>{settings.max_chars=Math.max(2,Math.min(8,+e.target.value||4));saveSettings()};
  // import / export layout (settings + areas + painted)
  const ie=document.createElement("div");ie.className="row";
  ie.innerHTML="<div style='flex:1'><div class='n'>layout import/export</div></div>"+
    "<button type='button' class='btn' id='exportLayout'>export</button>"+
    "<button type='button' class='btn' id='importLayout'>import</button>";
  box.appendChild(ie);
  document.getElementById("exportLayout").onclick=()=>{
    const data=JSON.stringify(settings,null,2);
    const blob=new Blob([data],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="agent-office-layout.json";
    a.click();
  };
  document.getElementById("importLayout").onclick=()=>{
    const inp=document.createElement("input");
    inp.type="file";inp.accept=".json,application/json";
    inp.onchange=()=>{
      const f=inp.files[0];if(!f)return;
      const r=new FileReader();
      r.onload=()=>{
        try{
          const o=JSON.parse(r.result);
          Object.keys(o).forEach(k=>{if(k in _DEFAULTS)settings[k]=o[k];});
          settings.did_import = true;
          saveSettings();fillSettings();fillLayout();fillAreas();
          localStorage.setItem("didImport","1");
        }catch(e){console.error("bad layout json: "+e.message);}
      };
      r.readAsText(f);
    };
    inp.click();
  };
  // reset — wipe progress, event history, painted tiles (fresh start)
  const rst=document.createElement("div");rst.className="row";
  rst.innerHTML="<div style='flex:1'><div class='n'>reset everything</div><div class='d'>wipe XP, badges, history, painted tiles</div></div>";
  const rbtn=document.createElement("button");rbtn.type="button";rbtn.className="btn";rbtn.textContent="reset";
  rbtn.onclick=()=>{
    if(!confirm("Reset ALL office progress? XP, badges, unlock history and painted tiles will be wiped. This cannot be undone."))return;
    fetch("/state",{method:"DELETE"}).then(r=>r.json()).then(()=>{
      localStorage.removeItem("pixelOfficeSeen");
      localStorage.removeItem("didImport");
      location.reload();
    }).catch(()=>console.error("reset failed — is the office server running?"));
  };
  rst.appendChild(rbtn);
  document.getElementById("settingsbox").appendChild(rst);
  // theme picker
  const th=document.createElement("div");th.className="row";
  th.innerHTML="<div style='flex:1'><div class='n'>theme</div></div>";
  const seg=document.createElement("span");seg.className="seg";
  THEMES.forEach(t=>{
    const s=document.createElement("span");
    s.textContent=t.name;
    if(settings.theme===t.id) s.className="on";
    s.onclick=()=>{settings.theme=t.id;saveSettings();applyTheme(t.id);fillSettings();};
    seg.appendChild(s);
  });
  th.appendChild(seg);
  box.appendChild(th);
}

async function saveSettings(){
  const isThemeSwitch = settings.theme && settings.lastSaveCall !== "theme";
  try{
    await fetch("settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)});
  }catch(e){}
  // track theme switches for theme_designer badge
  try{
    const n=parseInt(localStorage.getItem("themeSwitches")||"0",10);
    if(settings.theme!==(localStorage.getItem("lastTheme")||"default")){
      localStorage.setItem("themeSwitches",String(n+1));
      localStorage.setItem("lastTheme",settings.theme);
    }
  }catch(e){}
}
async function loadSettings(){
  try{const r=await fetch("settings");settings=await r.json();}catch(e){}
  // only clamp locked layouts AFTER progress is known — haveUnlock() is always
  // false while progress===null, which used to POST layout back to "open" on every reload
  if(progress){
    const L = (typeof LAYOUTS!=="undefined") ? LAYOUTS.find(x=>x.id===settings.layout) : null;
    if(L && L.require && !haveUnlock(L.require)) {
      settings.layout = "open";
      saveSettings();
    }
  }
  // also validate theme — fall back to default if the saved id is gone
  if(typeof THEMES!=="undefined" && !THEMES.find(t=>t.id===settings.theme)){
    settings.theme = "default";
    saveSettings();
  }
}
function applyTheme(id){
  const theme = THEMES.find(t=>t.id===id) || THEMES[0];
  cv.style.background = theme.bg;
  const tileA = (night() && theme.id==="default") ? "#231c2e" : theme.tileA;
  const tileB = (night() && theme.id==="default") ? "#1c1626" : theme.tileB;
  const wall  = (night() && theme.id==="default") ? "#2a2038" : theme.wall;
  window._theme = {id:theme.id, tileA, tileB, wall, isDark:night()};
}
async function loadManifest(){
  try{const r=await fetch("assets-manifest");window.__assets=await r.json();}catch(e){}
}
async function updateSetting(k,v){settings[k]=v;await saveSettings();fillLayout();fillAreas();fillSettings();}
const _DEFAULTS = Object.keys(settings);

const chars = new Map();
const WALK = 0.55;
let nextPairAt=2400+((Math.random()*3600)|0);
function seatPos(i,perRow,geom,padLeft,rowStep){
  const g = geom || LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  const rs = rowStep || g.rowStep;
  return {x:(padLeft==null?10:padLeft)+(i%perRow)*g.colStep, y:g.labelY+Math.floor(i/perRow)*rs};
}
function stepChars(perRow,padLeft,geom,rowStep){
  if(settings.lock_floor)return; // freeze in place
  const seen=new Set();
  // ── pair-programming: agents occasionally visit a colleague's desk ──
  if(frame>=nextPairAt && agents.length>=2){
    const seated=agents.filter(a=>{const c=chars.get(a.id);return c&&c.phase==="seated"&&!c.pair;});
    if(seated.length>=2){
      const visitor=seated[(Math.random()*seated.length)|0];
      const others=seated.filter(a=>a.id!==visitor.id);
      const host=others[(Math.random()*others.length)|0];
      const vc=chars.get(visitor.id);
      vc.pair={host:host.id, until:frame+900+((Math.random()*1200)|0)};   // 15-35s
      nextPairAt=frame+3600+((Math.random()*7200)|0);                     // next in 60-180s
    }
    else nextPairAt=frame+600;
  }
  agents.forEach((a,i)=>{
    seen.add(a.id);
    const seat=seatPos(i,perRow,geom,padLeft,rowStep);
    let c=chars.get(a.id);
    if(!c){ c={x:2,y:2,seat,phase:"in",lastStatus:a.status}; chars.set(a.id,c); }
    c.seat=seat;
    // pair state ends on time or when the VISITOR starts working (host status irrelevant)
    if(c.pair&&(frame>=c.pair.until))c.pair=null;
    let tx,ty;
    if(c.pair){
      // stand beside the host's desk (right side)
      const hc=chars.get(c.pair.host);
      if(hc){tx=hc.seat.x+6; ty=hc.seat.y;}
      else {c.pair=null; tx=c.seat.x+3; ty=c.seat.y;}
    }
    else {tx=c.phase==="out"?2:c.seat.x+3; ty=c.phase==="out"?2:c.seat.y;}
    const dx=tx-c.x, dy=ty-c.y, d=Math.hypot(dx,dy);
    if(d>=WALK){
      // facing drives the walking sprite row (up / right / mirrored-left)
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
const sBtn=document.getElementById("sound");
function syncSoundBtn(){sBtn.textContent="sound";
  sBtn.classList.toggle("on",soundOn);
  sBtn.setAttribute("aria-pressed",soundOn?"true":"false");}
sBtn.onclick=()=>{soundOn=!soundOn;
  try{localStorage.setItem("pixelOfficeSound",soundOn?"1":"0")}catch(e){}
  if(soundOn)chime([660]); syncSoundBtn()};
syncSoundBtn();

const spawnBtn=document.getElementById("spawn");
const inspectorBtn=document.getElementById("inspectorbtn");
if(IN_VSCODE){spawnBtn.style.display="";
  spawnBtn.onclick=()=>vsapi.postMessage({type:"spawnAgent"});}

// day/night manual toggle — cycles auto → day → night → auto
const dnBtn=document.getElementById("daynight");
function syncDnBtn(){if(!dnBtn)return;
  const mode=window._nightOverride===null||window._nightOverride===undefined?"auto":(window._nightOverride?"night":"day");
  dnBtn.textContent=mode==="auto"?"◐ auto":mode==="night"?"☾ night":"☀ day";
  dnBtn.classList.toggle("on",mode!=="auto")}
if(dnBtn){dnBtn.onclick=()=>{
  const cur=window._nightOverride===null||window._nightOverride===undefined?"auto":(window._nightOverride?"night":"day");
  const next=cur==="auto"?"night":cur==="night"?"day":"auto";
  if(next==="auto"){window._nightOverride=null;try{localStorage.removeItem("pixelOfficeNight")}catch(e){}}
  else{window._nightOverride=next==="night";try{localStorage.setItem("pixelOfficeNight",window._nightOverride?"1":"0")}catch(e){}}
  try{const saved=JSON.parse(localStorage.getItem("pixelOfficeSettings")||"{}");saveSettings()}catch(e){}
  syncDnBtn(); chime([520,next==="night"?390:660]);
};}
try{const n=localStorage.getItem("pixelOfficeNight");if(n!==null)window._nightOverride=n==="1"}catch(e){}
syncDnBtn();

// fog of war — header toggle + settings sheet row share this
const fogBtn=document.getElementById("fogbtn");
function syncFogBtn(){if(!fogBtn)return;
  fogBtn.textContent="fog";
  fogBtn.classList.toggle("on",!!settings.fog);
  fogBtn.setAttribute("aria-pressed",settings.fog?"true":"false");}
if(fogBtn){fogBtn.onclick=async()=>{settings.fog=!settings.fog;syncFogBtn();await saveSettings();fillSettings();};}
syncFogBtn();

// fog of war: dark unexplored floor, radial holes around agents/desks/door.
// offscreen canvas + destination-out (per MDN createRadialGradient /
// globalCompositeOperation) so the office underneath is never erased.
function drawFog(){
  if(!settings.fog)return;
  const W=cv.width,H=cv.height;
  if(!W||!H)return;
  let fc=window._fogCanvas;
  if(!fc||fc.width!==W||fc.height!==H){
    fc=document.createElement("canvas");fc.width=W;fc.height=H;
    window._fogCanvas=fc;
  }
  const f=fc.getContext("2d");
  f.globalCompositeOperation="source-over";
  f.clearRect(0,0,W,H);
  f.fillStyle="rgba(5,3,14,0.84)";
  f.fillRect(0,0,W,H);
  f.globalCompositeOperation="destination-out";
  const hole=(tx,ty,r,a)=>{
    const x=tx*S,y=ty*S,rad=Math.max(2,r*S);
    const g=f.createRadialGradient(x,y,rad*0.25,x,y,rad);
    g.addColorStop(0,"rgba(0,0,0,"+a+")");
    g.addColorStop(1,"rgba(0,0,0,0)");
    f.fillStyle=g;
    f.beginPath();f.arc(x,y,rad,0,Math.PI*2);f.fill();
  };
  // door always visible
  hole(6,6,9,0.95);
  // every desk anchor: warm readable pool
  for(const d of (window._deskAnchors||[])){hole(d[0]+4,d[1]+2,15,0.98);}
  // walking chars + visitors reveal as they move
  for(const c of chars.values()){
    if(c.phase!=="seated")hole(c.x+2,c.y+4,10,0.9);
  }
  try{for(const v of visitors){hole(v.x,v.y,10,0.9);}}catch(e){}
  ctx.drawImage(fc,0,0,W,H);
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
    const seen = JSON.parse(localStorage.getItem("sheetsSeen")||"[]");
    if(!seen.includes(id)){
      seen.push(id);
      localStorage.setItem("sheetsSeen", JSON.stringify(seen));
    }
    settings.sheets_opened = settings.sheets_opened || [];
    if(!settings.sheets_opened.includes(id)){
      settings.sheets_opened.push(id);
      saveSettings();
    }
  }
}
// attach X close button to every sheet header
document.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll(".sheet").forEach(el=>{
    const h=el.querySelector("h2");if(!h)return;
    if(h.querySelector(".x"))return;
    h.style.cssText="display:flex;justify-content:space-between;align-items:center";
    const x=document.createElement("button");
    x.type="button";
    x.className="x";
    x.textContent="✕";
    x.setAttribute("aria-label","close");
    x.onclick=closeSheets;
    h.appendChild(x);
  });
});
document.getElementById("achbtn").onclick=()=>toggleSheet("sheet-unlocks");
document.getElementById("rosterbtn").onclick=()=>toggleSheet("sheet-roster");
document.getElementById("statsbtn").onclick=()=>toggleSheet("sheet-stats");
document.getElementById("layoutbtn").onclick=()=>{fillLayout();toggleSheet("sheet-layout");};
document.getElementById("settingsbtn").onclick=()=>{fillSettings();fillAreas();toggleSheet("sheet-settings");};
document.getElementById("debugbtn").onclick=()=>{
  const d=document.getElementById("debugbox");
  d.textContent = JSON.stringify({agents:agents.length, progress:progress, settings:settings},null,2);
  toggleSheet("sheet-debug");
};
document.getElementById("eventbtn").onclick=()=>{fillEvents();toggleSheet("sheet-events");};
document.getElementById("legendbtn").onclick=()=>{fillLegend();toggleSheet("sheet-legend");};
// ?debug=1 — open raw state inspector on load (dev/QA)
if(/[?&]debug=1\b/.test(location.search)){setTimeout(()=>{const b=document.getElementById("debugbox");if(b)b.textContent=JSON.stringify({agents:agents.length,progress,settings},null,2);toggleSheet("sheet-debug");},800);}
document.getElementById("inspectorbtn").onclick=()=>{fillInspector();toggleSheet("sheet-inspector");};
function syncThemeBtn(){
  const b=document.getElementById("themeNextbtn"); if(!b)return;
  const t=THEMES.find(x=>x.id===settings.theme);
  b.textContent=t?t.name.toLowerCase():(settings.theme||"theme");
  b.title="theme · click to cycle (T)";
}
document.getElementById("themeNextbtn").onclick=()=>{
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
(async()=>{
  await loadSettings();
  syncThemeBtn();
})();
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
      return "<div class='kv'><img src='assets/"+p.icon+".svg' width='14' height='14' style='vertical-align:middle;margin-right:4px'>"
        +"<span>"+p.name+(ok?" <span class='h' style='color:#5fce7a'>· live</span>":"")+"</span>"
        +"<b style='font-size:11px;color:#9b6fd8'>"+p.what+"</b></div>";
    }).join("")+
    "<p class='h' style='margin-top:10px'>shortcuts</p>"+
    ["R roster","U usage","B badges","L layout","S settings","E live","? legend","T theme","N day/night","F fog","esc close"]
       .map(s=>"<div class='kv'><span><code>"+s.split(" ")[0]+"</code></span><b>"+s.split(" ").slice(1).join(" ")+"</b></div>").join("");
}
document.addEventListener("keydown",(e)=>{
  if(e.target.tagName==="INPUT")return;
  const k=e.key.toLowerCase();
  const map={r:"sheet-roster",u:"sheet-stats",b:"sheet-unlocks",l:"sheet-layout",
             s:"sheet-settings",d:"sheet-debug",e:"sheet-events","?":"sheet-legend",
             t:"themeNext",n:"dayNight",f:"fogToggle"};
  if(k==="escape"){closeSheets();return;}
  const id=map[k];if(!id)return;
  e.preventDefault();
  if(!id.startsWith("sheet-")){
      if(id==="themeNext"){document.getElementById("themeNextbtn").click();}
      else if(id==="dayNight"){document.getElementById("daynight").click();}
      else if(id==="fogToggle"){document.getElementById("fogbtn").click();}
      return;
  }
  if(id==="sheet-layout")fillLayout();
  if(id==="sheet-settings"){fillSettings();fillAreas();}
  if(id==="sheet-legend")fillLegend();
  if(id==="sheet-events")fillEvents();
  if(id==="sheet-debug"){
    document.getElementById("debugbox").textContent=
      JSON.stringify({agents:agents.length,progress:progress,settings:settings},null,2);
  }
  toggleSheet(id);
});
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
  ];
  box.innerHTML="<div class='n' style='margin-bottom:8px'>inspector</div>"+
    rows.map(([k,v])=>"<div class='kv'><span>"+k+"</span><b>"+v+"</b></div>").join("")+
    "<p class='h' style='margin-top:10px'>recent events</p>"+
    (evs.length ? evs.map(e=>"<div class='kv'><span>"+e.event+"</span><b>"+(e.tool_name||e.command||e.child_goal||"")+"</b></div>").join("") : "<p class='h'>no recent events</p>");
}
document.getElementById("filterbtn").onclick=()=>{
  platFilter=FILTERS[(FILTERS.indexOf(platFilter)+1)%FILTERS.length];
  document.getElementById("filterbtn").textContent=platFilter;
  document.getElementById("filterbtn").classList.toggle("on", platFilter!=="every");
};

function fillRoster(){
  const box=document.getElementById("roster");
  box.innerHTML="";
  if(!agents.length){box.innerHTML="<p class='h'>empty floor — start Hermes, OpenCode, or Claude Code</p>";return}
  // attention summary — who needs you first (mirrors the usage panel queue)
  const _waiting = agents.filter(a=>a.status==="waiting");
  if(_waiting.length){
    const _hdr=document.createElement("div");
    _hdr.className="row";
    _hdr.innerHTML="<div style='flex:1'><div class='n' style='color:#d84f6f'>● "+
      _waiting.length+" waiting"+(_waiting.length===1?"":"s")+" — unblock first</div>"+
      "<div class='h'>"+_waiting.map(a=>a.label||a.id).slice(0,4).join(" · ")+
      (_waiting.length>4?" · +"+(_waiting.length-4)+" more":"")+"</div></div>";
    box.appendChild(_hdr);
  }
  // tracking order: waiting (needs input) first, then working, then the rest
  const rank=a=>a.status==="waiting"?0:a.status==="working"?1:a.status==="thinking"?2:a.status==="done"?4:3;
  const sorted=[...agents].sort((a,b)=>rank(a)-rank(b)||(a.first_seen||0)-(b.first_seen||0));
  // group by team (subagents cluster under their parent)
  const teams = {};
  const main = [];
  agents.forEach(a=>{
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
    // animated portrait canvas
    const port=document.createElement("canvas");
    port.width=16;port.height=20;port.style.cssText="width:24px;height:30px;image-rendering:pixelated;border:1px solid #3a2f4b;background:#151022";
    port._a=a;
    d.appendChild(port);
    const info=document.createElement("div");info.style.flex="1";
    const plats=String(a.platform||"").toLowerCase();
    const _platIcons={hermes:"hermes",cli:"cli",telegram:"telegram",opencode:"opencode",claude:"claude","claude-code":"claude",gateway:"hermes"};
    const platIcon="assets/"+(_platIcons[plats]||"hermes")+".svg";
    // elapsed since first seen — the actual tracking signal
    let elapsed="";
    if(a.first_seen){ const s=Math.max(0,Math.floor(Date.now()/1000-a.first_seen));
      elapsed = s<60 ? s+"s" : Math.floor(s/60)+"m "+(s%60)+"s"; }
    const attn = a.status==="waiting" ? " <span style='color:#d84f6f'>● NEEDS INPUT</span>" : "";
    info.innerHTML="<div class='n'>"+(a.label||a.id)+
      (a.kind==="subagent"?" <span class='h'>(sub)</span>":"")+
      " <img src='"+platIcon+"' width='10' height='10' style='vertical-align:middle'>"+
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
  // start rendering portraits
  if(!window._portraitRAF)renderPortraits();
}
function renderPortraits(){
  const list=document.querySelectorAll("#roster canvas");
  list.forEach(cv=>{
    const a=cv._a;if(!a)return;
    const cx=cv.getContext("2d");
    cx.clearRect(0,0,16,20);
    const S=2;
    const h=a.id.split("").reduce((x,c)=>(x*31+c.charCodeAt(0))|0,0);
    const skin=["#f0c8a0","#c68b59","#8d5524","#ffdbac","#e0ac69"][Math.abs(h)%5];
    const shirt=["#4fa4d8","#d84f6f","#5fce7a","#c9a227","#9b6fd8"][Math.abs(h>>3)%5];
    const hair=["#2b2b2b","#5a3825","#c9a227","#8a8a8a"][Math.abs(h>>6)%4];
    const y=a.status==="working"?-1:0;
    // hair
    cx.fillStyle=hair;cx.fillRect(2,1+y,5,2); cx.fillStyle="#fff8c8";cx.fillRect(3,2+y,1,1);
    // face
    cx.fillStyle=skin;cx.fillRect(2,3+y,5,3); cx.fillStyle="#ffb6c1";cx.fillRect(3,5+y,1,1);cx.fillRect(6,5+y,1,1);
    // shirt + collar
    cx.fillStyle=shirt;cx.fillRect(1,6+y,7,5); cx.fillStyle="#fff8c8";cx.fillRect(3,6+y,3,1);
    if(a.kind==="subagent"){cx.fillStyle="#e8c170";cx.fillRect(1,6+y,7,1);}
    // eyes
    cx.fillStyle="#111";cx.fillRect(3,4+y,1,1);cx.fillRect(6,4+y,1,1);
    // status pixel
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
  const top=Object.entries(byt).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([k,v])=>k+": "+v).join(" · ")||"—";
  const byp=s.by_platform||{};
  const plats=Object.entries(byp).map(([k,v])=>k+": "+v).join(" · ")||"—";
  // tracking signals: error rate, throughput, live status mix, attention queue
  const tools=s.tools||0, sessions=s.sessions||0, errors=s.errors||0;
  const errRate = tools? (100*errors/tools).toFixed(1)+"%" : "—";
  const tps = sessions? (tools/sessions).toFixed(1)+" tools/session" : "—";
  const mix={}; agents.forEach(a=>{mix[a.status]=(mix[a.status]||0)+1;});
  const mixStr = Object.entries(mix).map(([k,v])=>k+": "+v).join(" · ")||"—";
  const waiting = agents.filter(a=>a.status==="waiting")
    .map(a=>a.label||a.id).join(", ")||"none";
  // oldest waiting agent — the one to unblock first
  let oldestWait="—";
  const waits=agents.filter(a=>a.status==="waiting"&&a.updated_at);
  if(waits.length){
    const o=waits.slice().sort((a,b)=>a.updated_at-b.updated_at)[0];
    const s=Math.max(0,Math.floor(Date.now()/1000-o.updated_at));
    oldestWait=(o.label||o.id)+" · waiting "+(s<60?s+"s":Math.floor(s/60)+"m");
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
  // per-agent live table — the actual tracking view (sorted waiting-first)
  if(agents.length){
    const rankA=a=>a.status==="waiting"?0:a.status==="working"?1:2;
    const sortedA=[...agents].sort((a,b)=>rankA(a)-rankA(b));
    html+="<p class='h' style='margin-top:10px'>agents ("+agents.length+")</p>"+
      sortedA.map(a=>{
        const el=a.first_seen?Math.max(0,Math.floor(Date.now()/1000-a.first_seen)):0;
        const els=el<60?el+"s":Math.floor(el/60)+"m";
        const dot=a.status==="waiting"?"#d84f6f":a.status==="working"?"#5fce7a":"#7a6f8f";
        return "<div class='kv'><span><span style='color:"+dot+"'>●</span> "+
          (a.label||a.id).slice(0,18)+" <span class='h'>"+a.status+
          (a.tool?" · "+a.tool:"")+"</span></span><b>"+els+"</b></div>";
      }).join("");
  }
  document.getElementById("statbox").innerHTML=html;
}

function toastUnlock(u){
  const el=document.createElement("div");
  el.className="card";
  // big unlock — burst animation
  const isMajor = (u.id||"").includes("layout_") || (u.id||"").includes("pet_") || (u.id==="corner_office");
  el.style.cssText = isMajor ? "border:2px solid #e8c170;background:#241c30;animation:burst .6s ease-out" : "";
  el.innerHTML="<b>UNLOCKED · "+(u.name||u.id)+(isMajor?" 🎉":"")+"</b><span>"+(u.hint||"new drip")+"</span>";
  document.getElementById("toast").appendChild(el);
  chime([660,880,1100]);
  setTimeout(()=>el.remove(),4200);
}

function applyProgress(p){
  progress=p||null;
  if(!p)return;
  const next=p.next?(" → "+p.next.rank+" @ "+p.next.need):" · max rank";
  const rankEl=document.getElementById("rank");
  rankEl.textContent=(p.rank||"intern")+" · "+(p.xp||0)+" xp";
  rankEl.title=next.trim();
  // XP bar fill
  if(p.next){
    const need=p.next.need;
    const prev=RANKS_THRESHOLDS[p.rank]||0;
    const pct=Math.min(100, Math.max(0, ((p.xp||0)-prev)/(need-prev)*100));
    const fill=document.getElementById("xpfill");
    if(fill)fill.style.width=pct.toFixed(1)+"%";
  }
  const chips=document.getElementById("chips");
  if(chips){
    // when nothing has been recorded yet, show the local-host chip so the strip never looks empty
    const plats=(p.stats&&p.stats.platforms&&p.stats.platforms.length)?p.stats.platforms:["cli","hermes"];
    const icon={hermes:"hermes",cli:"cli",telegram:"telegram",opencode:"opencode",claude:"claude","claude-code":"claude",gateway:"hermes","main":"hermes"};
    // always show the "local" chip so the user sees the host
    const _plats = Array.from(new Set(["cli","hermes", ...plats]));
    chips.innerHTML=_plats.map(pl=>{
      const n=icon[pl]||"hermes";
      return "<img src='assets/"+n+".svg' title='"+pl+"' alt='"+pl+"'>";
    }).join("");
  }
  const grid=document.getElementById("achgrid");
  grid.innerHTML="";
  (p.catalog||[]).forEach(c=>{
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
  (p.recent||[]).forEach(u=>{
    if(!u.id||seenUnlocks.has(u.id))return;
    seenUnlocks.add(u.id);
    toastUnlock(u);
  });
  try{localStorage.setItem("pixelOfficeSeen",JSON.stringify([...seenUnlocks]))}catch(e){}
  fillStats();
}

// ═══ NPC visitors — wander in through the door, linger, leave ═══
// names + colors: little pixel folk that make the office feel alive
const VISITOR_KINDS=[
  {name:"mail carrier", shirt:"#4fa4d8", hat:true,
   lines:["mail's here","big envelope today","anyone order parts?","sign here please"]},
  {name:"delivery",     shirt:"#d8a24f", hat:true, box:true,
   lines:["package drop","heavy one today","where do I leave this?","next-day, no signature"]},
  {name:"cleaner",      shirt:"#8fbf6f", hat:false, mop:true,
   lines:["mopping around ya","mind the wet floor","this place needs dusting","nice plant"]},
  {name:"intern",       shirt:"#c98fd8", hat:false, coffee:true,
   lines:["coffee run!","first day nerves","which desk is mine?","so... this is the office"]},
  {name:"inspector",    shirt:"#d86f6f", hat:true, clipboard:true,
   lines:["everything up to code","hmm, noting that","fire exit clear","nice setup in here"]},
];
const VISITOR_LINES=vis=>vis.kind.lines[(vis.seed+((frame/300)|0))%vis.kind.lines.length];
// ── seasonal: jack-o-lantern by the door in October ──
function drawSeasonal(w,gh){
  const m=new Date().getMonth();
  // jack-o-lantern by the door in October
  if(m===9){
    const jx=7, jy=Math.max(20,gh-10);
    px(jx,jy,4,3,"#e8802a");                       // pumpkin body
    px(jx+1,jy+3,2,1,"#54381f");                   // stem
    px(jx+1,jy+1,1,1,"#f0d060");px(jx+3,jy+1,1,1,"#f0d060");   // eyes
    px(jx+1+(frame>>4)%2,jy+2,2,1,"#f0d060");      // flickering mouth
  }
}
const visitors=[];   // {x,y,tx,ty,phase,dwell,kind,frameSeed}
let nextVisitorAt=600+((Math.random()*1800)|0);   // first visit 10-40s in
function floorBand(gh){ return Math.max(28, gh-16); }
function visitorX(gw){
  // keep NPCs off the centered desk
  const left=10+((Math.random()*Math.max(6,gw*0.28))|0);
  const right=Math.floor(gw*0.68)+((Math.random()*Math.max(6,gw*0.22))|0);
  return Math.random()<0.5?left:Math.min(gw-10,right);
}
function stepVisitors(gw,gh){
  if(frame>=nextVisitorAt && visitors.length<2){
    const kind=VISITOR_KINDS[(Math.random()*VISITOR_KINDS.length)|0];
    const fy=floorBand(gh);
    visitors.push({x:4,y:6,tx:visitorX(gw),ty:fy,
                   phase:"in",dwell:400+((Math.random()*600)|0),kind,seed:(Math.random()*9999)|0,wp:null});
    if(soundOn)chime([392,523]);   // door-open chime
    nextVisitorAt=frame+1800+((Math.random()*5400)|0);   // next in 30-120s
  }
  for(let i=visitors.length-1;i>=0;i--){
    const v=visitors[i];
    const speed=0.06;
    // waypoint pathing: door → down the left wall to the floor band → across
    // (straight diagonals cut through desk clusters)
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
        else { if(soundOn)chime([523,392]); visitors.splice(i,1); }   // door-close chime
      }else{
        if(!v.wp||Math.hypot(v.wp.x-v.x,v.wp.y-v.y)<0.5) v.wp=nextWp(v,gw,gh);
        const dx=v.wp.x-v.x, dy=v.wp.y-v.y, d=Math.hypot(dx,dy);
        if(d>=0.5){ v.x+=dx/d*speed; v.y+=dy/d*speed; }
      }
    }else if(v.phase==="dwell"){
      if(--v.dwell<=0){
        v.phase="out"; v.tx=4; v.ty=floorBand(gh); v.wp=null;
      }
      // occasional idle shuffle during dwell — else-branch so a shuffle frame
      // never also decrements past zero; bounded so the visitor always leaves
      else if(v.dwell>240 && v.dwell%180===0){ v.tx=Math.max(8,Math.min(gw-8,v.tx+(((Math.random()*10)|0)-5))); v.phase="in"; v.dwell+=120; v.wp=null; }
    }
  }
}
function drawVisitors(){
  const cs=charScale();
  const loaded=charSheets.filter(s=>s&&s.down&&s.down[0]);
  for(const v of visitors){
    const walking=v.phase!=="dwell";
    const bob=(walking&&(frame>>3)%2)?1:0;
    const k=v.kind;
    const px0=Math.round(v.x*S), py0=Math.round((v.y+bob)*S);
    ctx.imageSmoothingEnabled=false;
    const destW=CHAR_FW*cs, destH=CHAR_FH*cs;
    const dx=Math.round(px0-destW/2), dy=Math.round(py0-destH);
    ctx.fillStyle="rgba(0,0,0,0.28)";
    ctx.fillRect(dx+4*cs, py0-cs, 8*cs, cs);
    const sheet=loaded.length?loaded[(v.seed||0)%loaded.length]:null;
    if(sheet){
      const row=walking?sheet.right:sheet.down;
      const spr=walking?row[1+((frame>>3)%6)]:row[0];
      ctx.drawImage(spr,0,0,CHAR_FW,CHAR_FH, dx, dy, destW, destH);
    }else{
      ctx.fillStyle=k.shirt; ctx.fillRect(dx+4*cs, dy+10*cs, 8*cs, 14*cs);
      ctx.fillStyle="#e8c49a"; ctx.fillRect(dx+5*cs, dy+2*cs, 6*cs, 8*cs);
    }
    if(k.box){
      const pk=decorImg.PACKAGE;
      const psz=6*cs;
      if(pk&&pk.complete&&pk.naturalWidth)
        ctx.drawImage(pk,0,0,pk.naturalWidth,pk.naturalHeight, dx+destW-2*cs, dy+14*cs, psz, psz);
      else { ctx.fillStyle="#c4894a"; ctx.fillRect(dx+destW-2*cs, dy+16*cs, psz, psz); }
    }
    if(k.coffee){ ctx.fillStyle="#fff8e8"; ctx.fillRect(dx+destW-cs, dy+16*cs, 2*cs, 3*cs); ctx.fillStyle="#6b3e1c"; ctx.fillRect(dx+destW-cs, dy+18*cs, 2*cs, 1*cs); }
    if(k.clipboard){ ctx.fillStyle="#c9b28a"; ctx.fillRect(dx+destW-cs, dy+14*cs, 3*cs, 5*cs); }
    if(k.mop){ ctx.fillStyle="#8d5524"; ctx.fillRect(dx+destW, dy+8*cs, cs, 18*cs); ctx.fillStyle="#c9c9d8"; ctx.fillRect(dx+destW-cs, dy+24*cs, 3*cs, 2*cs); }
    ctx.font=Math.max(10,S)+"px ui-monospace,monospace"; ctx.textAlign="center";
    ctx.fillStyle="rgba(207,196,232,0.95)";
    ctx.fillText(k.name, px0, Math.max(12, dy-4));
    if(v.phase==="dwell"){
      const line=VISITOR_LINES(v);
      ctx.font=Math.max(10,S+1)+"px ui-monospace,monospace";
      const tw=ctx.measureText(line).width;
      const bx=Math.max(4, px0-tw/2-5), by=Math.max(14, dy-22);
      ctx.fillStyle="rgba(255,255,255,0.94)";
      ctx.fillRect(bx,by,tw+10,16);
      ctx.fillStyle="#241c33";
      ctx.fillText(line, bx+tw/2+5, by+12);
    }
  }
}

function render(){
  // probe mode — render one frame then idle so chrome-devtools can inspect
  if(window.__probe || /[?&]probe=1\b/.test(location.search)){ window.__probe = (window.__probe||0)+1; if(window.__probe<=3) document.title="READY:"+window.__probe; if(window.__probe > 5){ window.__probe = 0; history.replaceState({}, "", "/"); } requestAnimationFrame(render); return; }
  // pause when any sheet is open or window is hidden (saves battery, no flicker)
  // but keep a slow 4fps heartbeat so the office doesn't look frozen/dead behind sheets
  if(document.querySelector(".sheet[style*=\"display: block\"]")){
    if(!render._sheetTick || performance.now()-render._sheetTick>250){ render._sheetTick=performance.now(); }
    else { requestAnimationFrame(render); return; }
  }
  if(document.hidden){ requestAnimationFrame(render); return; }
  frame++;
  const W=cv.clientWidth,H=cv.clientHeight;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  const list=shown();
  const maxc=Math.max(2,settings.max_chars||4);
  // pick layout geometry first — overrides perRow/colStep/rowStep
  const geom = LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  const colStep = geom.colStep, rowStep = geom.rowStep;
  const labelY = geom.labelY;
  // tile size so columns * max rows fit in canvas (no overlap).
  // Reserve room for the label below each desk (~4 rows of tile height).
  const labelPx = Math.max(40, Math.round(60 * 1)); // safe upper bound
  const usableW=W-16, usableH=H-32-labelPx;
  // initial perRow: prefer the layout's perRow, but allow scaling up when rows
  // would otherwise overflow the canvas (mexico with 10 agents etc).
  // initial perRow: prefer the layout's perRow (e.g. mexico=2), but grow up if the
  // resulting rows don't fit at the static rowStep. Cap to perRow only AFTER growing.
  // estimate S from canvas BEFORE perRow so we don't use last-frame S
  const sCap = list.length<=2 ? 12 : 8;
  S=Math.max(2, Math.min(sCap, Math.floor(usableW/((geom.perRow||4)*colStep))));
  let perRow=Math.min(maxc, Math.max(1, Math.floor(usableW/(colStep*S))));
  // compute how many rows we'd need at this perRow, then bump perRow up if they
  // can't fit at the layout's static rowStep (room for desk + label).
  const DESK_H = 18; // px rows needed per desk+label band at S=1
  let rows=Math.ceil(list.length/Math.max(1,perRow));
  const availH = (H/S) - labelY - 4;
  // grow perRow only if the static layout would actually overflow vertically
  // (rows*rowStep > availH). Mild cases stay at the layout's intended perRow
  // so library still looks distinct from bullpen when there are few agents.
  while(perRow < maxc && rows * rowStep > availH && perRow < list.length){
    perRow++;
    rows = Math.ceil(list.length/Math.max(1,perRow));
  }
  // prefer the layout's perRow if it fits; otherwise use grown perRow
  if(geom.perRow >= rows || rows * rowStep + DESK_H <= availH) {
    perRow = Math.max(geom.perRow, Math.min(perRow, maxc));
  }
  // never reserve empty columns for missing agents — 1 desk in a 3-col
  // grid sat glued to the left wall (lounge/war/arcade screenshots).
  perRow = Math.max(1, Math.min(perRow, Math.max(1, list.length)));
  rows = Math.ceil(Math.max(1, list.length)/perRow);
  // shrink rowStep if even perRow=maxc can't fit at static spacing.
  // min 22 keeps the desk label (y+19..y+25) clear of the next row's chair.
  const dynRowStep = Math.min(rowStep, Math.max(22, Math.floor(availH / Math.max(1, rows))));
  // pick tile size so columns fit width AND rows fit height
  S=Math.max(2, Math.min(sCap, Math.floor(Math.min(usableW/(perRow*colStep), usableH/(rows*dynRowStep)))));
  // theme background
  const theme = (THEMES.find(t=>t.id===settings.theme) || THEMES[0]);
  cv.style.background = theme.bg;
  const tileA = (night() && theme.id==="default")?"#231c2e":theme.tileA;
  const tileB = (night() && theme.id==="default")?"#1c1626":theme.tileB;
  const wall = (night() && theme.id==="default")?"#2a2038":theme.wall;
  window._theme = {id:theme.id, tileA, tileB, wall, isDark:night()};
  const gw=Math.floor(W/S),gh=Math.floor(H/S); _gw=gw; _gh=gh;
  drawOffice(gw,gh); drawSeasonal(gw,gh);   // drawOffice reads window._cosmetics
  // painted tile overlay (user-clicked area colors)
  if(settings.painted){
    Object.entries(settings.painted).forEach(([key,name])=>{
      const [tx,ty] = key.split(",").map(Number);
      const col=(settings.areas||{})[name]||"#5fce7a";
      ctx.globalAlpha=0.4;
      ctx.fillStyle=col;
      ctx.fillRect(tx*S, ty*S, S, S);
      ctx.globalAlpha=1;
    });
  }
  const cosmetics=(progress&&progress.cosmetics)||[];
  window._cosmetics=cosmetics;
  const rowWidth = perRow * colStep;
  let padLeft = Math.max(10, Math.floor((usableW/S - rowWidth)/2));
  if(list.length===1) padLeft = Math.max(8, Math.floor((gw - 18)/2));
  const prev=agents; agents=list; stepChars(perRow,padLeft,geom,dynRowStep); agents=prev;
  // draw areas (behind desks) so each area is a colored tile cluster
  const areas = settings.areas || {};
  if(Object.keys(areas).length && list.length){
    const names=Object.keys(areas);
    list.forEach((a,i)=>{
      const idx=i % names.length;
      const color=areas[names[idx]];
      const seat=seatPos(i,perRow,geom,padLeft,dynRowStep);
      ctx.globalAlpha=0.12;
      ctx.fillStyle=color;
      // desk mat sized to the workstation footprint
      ctx.fillRect(Math.round((seat.x)*S), Math.round((seat.y+8)*S), 18*S, 8*S);
      ctx.globalAlpha=1;
    });
  }
  list.forEach((a,i)=>{
    const seat=seatPos(i,perRow,geom,padLeft,dynRowStep);
    window._deskAnchors=(window._deskAnchors||[]); window._deskAnchors[i]=[seat.x,seat.y];
    drawDesk(seat.x,seat.y,a,cosmetics); deskScreen(seat.x,seat.y,a);
    drawHealthBar(a,seat.x,seat.y);
  });
  list.forEach((a,i)=>{
    const c=chars.get(a.id); if(!c)return;
    const seated=c.phase==="seated";
    drawChar(a,c.x,c.y,seated,cosmetics);
    // pairing indicator: two overlapping screens above the visiting agent
    if(c.pair){
      ctx.font=Math.max(7,S+2)+"px ui-monospace,monospace"; ctx.textAlign="center";
      const bx=(c.x+4)*S, by=(c.y-1.5)*S;
      ctx.fillStyle="rgba(95,206,122,0.9)";
      ctx.fillText("⌨↔⌨", bx, by);
    }
    if(seated){
      const seat=seatPos(i,perRow,geom,padLeft,dynRowStep);
      // redraw desk top over the seated char's lower body so they sit BEHIND the desk
      drawDesk(seat.x,seat.y,a,cosmetics,true); deskScreen(seat.x,seat.y,a);
      // night idle: drifting z's above the head
      if(night() && a.status==="idle" && (frame>>4)%3!==2){
        const zx=seat.x+13, zy=8+((frame>>4)%3);
        ctx.font="bold "+Math.max(5,S)+"px ui-monospace,monospace";
        ctx.fillStyle="rgba(232,224,200,"+(0.9-((frame>>4)%3)*0.25)+")";
        ctx.fillText("z", zx*S, zy*S);
        if((frame>>4)%3>0){ctx.fillText("z",(zx+1.5)*S,(zy-1.5)*S);}
      }
      drawBubble(a,seat.x+2,seat.y); label(a,seat.x,seat.y);
    }
    if(focusedId===a.id){
      // outline ring around the focused agent
      const seat=seatPos(i,perRow,geom,padLeft,dynRowStep);
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
  stepVisitors(gw,gh);
  drawVisitors();
  drawFog();
  // layout-specific accent — bottom-left corner so it never clips the cat
  ctx.font="11px ui-monospace";ctx.textAlign="left";
  if(settings.layout && settings.layout!=="open"){
    ctx.fillStyle="#cfc4e8";
    ctx.fillText(" · " + settings.layout + " ·", 6, H-6);
  }
  // live ticker (right edge, starts BELOW the wall, clamps inside canvas)
  if(_events.length){
    const visible=_events.slice(-5);
    ctx.textAlign="right";
    ctx.font="10px ui-monospace,monospace";
    // start at 11 tiles down (wall is 8 tiles tall + 3 gap), clamp to canvas
    let y=Math.min(11*S, H-30);
    const xRight = Math.max(60, W-6);
    visible.slice().reverse().forEach((e,i)=>{
      const age=frame-e.frame;
      const alpha=Math.max(0.3, 1-age/240);
      ctx.globalAlpha=alpha;
      ctx.fillStyle={session_start:"#5fce7a",tool_start:"#cfc4e8",
                     approval_request:"#d84f6f",subagent_start:"#c9a227"}[e.kind]||"#9b6fd8";
      const txt = e.text.length>30 ? e.text.slice(0,29)+"…" : e.text;
      ctx.fillText(txt, xRight, y);
      y+=11;
      if(y>H-10) return;   // stop if past canvas
    });
    ctx.globalAlpha=1;
  }
  if(offline){
    ctx.fillText("office unreachable — "+offline,W/2,H/2);
    ctx.fillStyle="#7a6f8f";
    ctx.fillText("hermes plugins enable pixel-office  ·  or run an opencode session",W/2,H/2+20);
  }else if(!list.length){
    ctx.fillStyle="#7a6f8f";
    ctx.fillText(agents.length?"no agents on this filter":"empty floor — run Hermes, OpenCode, or Claude Code",W/2,H/2);
  }
  requestAnimationFrame(render);
}

function applyState(state){
  offline=null; agents=(state&&state.agents)||[];
  if(state&&state.settings)settings=Object.assign(settings,state.settings);
  window._stateEvents = state&&state.events || [];
  applyProgress(state&&state.progress);
  fillRoster();
  fillLayout();fillAreas();fillSettings();
  try{syncFogBtn();}catch(e){}
  fillEvents();fillInspector();
  document.getElementById("inspectorbtn").style.display = focusedId ? "" : "none";
  const n=agents.length, w=agents.filter(a=>a.status==="waiting").length;
  document.getElementById("count").textContent=
    n+" agent"+(n===1?"":"s")+(w?" · "+w+" waiting!":"");
  // click the count → jump to the roster (waiting-first) to unblock agents
  const cnt=document.getElementById("count");
  if(cnt&&!cnt.dataset.wired){cnt.dataset.wired="1";cnt.style.cursor="pointer";cnt.title="open roster";
    cnt.onclick=()=>{fillRoster();toggleSheet("sheet-roster");};}
  // daily office name — derives from date so the floor feels alive
  const dn = new Date();
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dn.getDay()];
  const dailyName = THEME_DAILY[dn.getDate()%THEME_DAILY.length];
  const mark = document.querySelector("#hdr .mark");
  if(mark && !mark.dataset.daily){
    mark.dataset.daily = "1";
    const sub = document.createElement("span");
    sub.className = "dim";
    sub.style.cssText = "font-size:11px;margin-left:6px";
    sub.textContent = " · " + dailyName;
    mark.appendChild(sub);
  }
  // detect new events for the ticker
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
    focusedId=null; document.getElementById("inspectorbtn").style.display="none";
  }
}

function fillEvents(){
  const box=document.getElementById("eventbox");
  if(!box)return;
  box.innerHTML="";
  if(!_events.length){box.innerHTML="<p class='h'>no recent activity</p>";return}
  _events.slice().reverse().forEach(e=>{
    const d=document.createElement("div");d.className="row";
    d.innerHTML="<span class='n'>"+e.kind.replace("_"," ")+"</span><span class='h'>"+e.text+"</span>";
    box.appendChild(d);
  });
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
      document.getElementById("count").textContent="offline";}
    setTimeout(poll,1500);
  })();
}
loadSettings();loadManifest();
render();

// click canvas → paint tile, focus character, or pet
let _painting = false;
cv.addEventListener("mousedown", (ev)=>{
  if(!settings.paint)return;
  _painting = true;
  paintAt(ev);
});
// click a desk → copy agent label+activity with toast
function copyAgent(a){
  const txt=a.label?a.label+(a.detail?" — "+a.detail:""):a.detail||"";
  if(txt && navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast("copied: "+txt.slice(0,40)))
      .catch(()=>toast(txt.slice(0,60)));
  }
}
let _toastT=null;
function toast(msg){
  let t=document.getElementById("office-toast");
  if(!t){t=document.createElement("div");t.id="office-toast";
    t.style.cssText="position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#2a2038;color:#fff;padding:6px 14px;border-radius:6px;font:11px ui-monospace,monospace;z-index:9999;opacity:0;transition:opacity .2s";
    document.body.appendChild(t);}
  t.textContent=msg; t.style.opacity=1;
  clearTimeout(_toastT); _toastT=setTimeout(()=>t.style.opacity=0, 1800);
}
cv.addEventListener("mousemove", (ev)=>{
  if(!_painting)return;
  paintAt(ev);
});
cv.addEventListener("mouseup", ()=>{ _painting=false; });
cv.addEventListener("mouseleave", ()=>{ _painting=false; });
function paintAt(ev){
  const r=cv.getBoundingClientRect();
  const tx=Math.floor((ev.clientX-r.left)/S);
  const ty=Math.floor((ev.clientY-r.top)/S);
  const areas=settings.areas;
  if(!Object.keys(areas).length)return;
  const name=Object.keys(areas)[0];
  settings.painted = settings.painted || {};
  settings.painted[tx+","+ty]=name;
  saveSettings();
}
cv.addEventListener("click", (ev)=>{
  const r=cv.getBoundingClientRect();
  const tx=Math.floor((ev.clientX-r.left)/S);
  const ty=Math.floor((ev.clientY-r.top)/S);
  if(settings.paint){
    const key=tx+","+ty;
    const areas=settings.areas;
    if(!Object.keys(areas).length)return;
    const name=Object.keys(areas)[0];
    settings.painted = settings.painted || {};
    settings.painted[key]=name;
    saveSettings();
  } else if(tx>_gw-12 && ty>_gh-8){
    petBounce=true; petTimer=120; chime([520,780]);
  } else {
    // try to focus the clicked character
    const list=shown();
    const _geom2=LAYOUT_GEOMETRY[settings.layout]||LAYOUT_GEOMETRY.open;
    const _maxc=Math.max(2,settings.max_chars||4);
    let _perRow=Math.min(_maxc, Math.max(1, Math.floor((_gw-2)/_geom2.colStep)));
    let _rows=Math.ceil(list.length/Math.max(1,_perRow));
    const _availH=_gh-_geom2.labelY-4;
    while(_perRow < _maxc && _rows * _geom2.rowStep + 18 > _availH && _perRow < list.length){
      _perRow++; _rows=Math.ceil(list.length/Math.max(1,_perRow));
    }
    if(_geom2.perRow >= _rows || _rows * _geom2.rowStep + 18 <= _availH) {
      _perRow = Math.max(_geom2.perRow, Math.min(_perRow, _maxc));
    }
    _perRow = Math.max(1, Math.min(_perRow, Math.max(1, list.length)));
    _rows = Math.ceil(Math.max(1,list.length)/_perRow);
    let _padLeft = Math.max(10, Math.floor((_gw - _perRow*_geom2.colStep)/2));
    if(list.length===1) _padLeft = Math.max(8, Math.floor((_gw - 18)/2));
    const _dynRowStep=Math.min(_geom2.rowStep, Math.max(22, Math.floor(_availH/Math.max(1,_rows))));
    let best=null,bestD=99999;
    list.forEach((a,i)=>{
      const s=seatPos(i,_perRow,_geom2,_padLeft,_dynRowStep);
      const d=Math.hypot(tx-s.x-4, ty-s.y-6);
      if(d<bestD){bestD=d;best=a;}
    });
    if(best && bestD<14){
      const wasFocused = focusedId===best.id;
      focusedId = wasFocused ? null : best.id;
      document.getElementById("inspectorbtn").style.display = focusedId ? "" : "none";
      if(focusedId){
        fillInspector();toggleSheet("sheet-inspector");
        settings.moods_clicked = (settings.moods_clicked||0)+1;
        saveSettings();
      }
      if(!wasFocused) copyAgent(best);
    }
  }
});
