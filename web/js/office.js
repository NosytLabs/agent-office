
"use strict";
const IN_VSCODE = typeof acquireVsCodeApi !== "undefined";
const vsapi = IN_VSCODE ? acquireVsCodeApi() : null;
const cv = document.getElementById("c"), ctx = cv.getContext("2d");
let S = 4, agents = [], progress = null, frame = 0, offline = null, platFilter = "every";
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
function lighten(hex){const c=hex.replace("#","");const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);const mix=Math.min(255,Math.max(0,Math.round(r*1.15)));const mix2=Math.min(255,Math.max(0,Math.round(g*1.15)));const mix3=Math.min(255,Math.max(0,Math.round(b*1.15)));return "#"+((1<<24)+(mix<<16)+(mix2<<8)+mix3).toString(16).slice(1)}
function darken(hex){const c=hex.replace("#","");const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);const mix=Math.max(0,Math.round(r*0.85));const mix2=Math.max(0,Math.round(g*0.85));const mix3=Math.max(0,Math.round(b*0.85));return "#"+((1<<24)+(mix<<16)+(mix2<<8)+mix3).toString(16).slice(1)}
function night(){const h=new Date().getHours();return h<6||h>=19}

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
  if(!charSheets.length)return null;
  const sheet=charSheets[hash(a.id)%charSheets.length];
  if(!sheet)return null;
  // sheet layout (verified): col 0 = idle stand, cols 1-6 = 6-frame walk. no typing frames.
  if(!seatedNow(a)){
    const all=sheet.down.concat(sheet.right);
    return all[1+((frame>>3)%6)];
  }
  if(a.activity==="reading"||a.activity==="typing"||a.activity==="running"){
    // no dedicated typing frames — use subtle 2-frame walk-in-place from cols 1-2
    return sheet.down[1+((frame>>4)%2)];
  }
  return sheet.down[0]; // idle
}
function seatedNow(a){return a.status!=="gone"&&a.status!=="walking"}

// ═══ decor sprite images (pets + furniture, from pixel-agents MIT) ═══
const decorImg={};  // name -> HTMLImageElement
["pets/claudio.png","pets/gitcat.png","furniture/LARGE_PLANT.png","furniture/CACTUS.png",
 "furniture/BOOKSHELF.png","furniture/SOFA_FRONT.png","furniture/WHITEBOARD.png","furniture/BIN.png"]
 .forEach(p=>{const im=new Image();im.src="assets/sprites/"+p;decorImg[p.split("/")[1].replace(".png","")]=im;});
function drawDecorImg(name,dx,dy,dw,dh){
  const im=decorImg[name];
  if(im&&im.complete&&im.naturalWidth>0){
    ctx.imageSmoothingEnabled=false;
    // pet sheets are 6x3 grids of 16x32 frames (walk / idle / flip rows) —
    // draw ONE frame, not the whole squished sheet
    if(im.naturalWidth===96&&im.naturalHeight===96){
      const fw=16,fh=32;
      const walking=(frame>>4)%2;                 // gentle 2-frame idle/walk cycle
      const col=walking?1+((frame>>4)%2):0;       // cols 1-2 walk frames, col 0 idle stand
      const sx=col*fw, sy=0;
      const pcs = Math.max(1, Math.floor(S/3));   // same scale as characters
      const pw = fw*pcs, ph = fh*pcs;
      // anchor: bottom-center of the (dw x dh) tile box, so feet sit on the floor
      const px0 = Math.round((dx+dw/2)*S - pw/2), py0 = Math.round((dy+dh)*S - ph);
      ctx.drawImage(im,sx,sy,fw,fh,px0,py0,pw,ph);
      return true;
    }
    ctx.drawImage(im,Math.round(dx*S),Math.round(dy*S),Math.round(dw*S),Math.round(dh*S));
    return true;
  }
  return false;
}

let _gw=0,_gh=0;
function drawOffice(w,h){
  const dark=night();
  const themeObj = window._theme || {};
  const geom = LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  // layout floor/wall blended with theme tint (60% layout, 40% theme) so both matter
  function mix(a,b,t){
    const pa=[1,3,5].map(i=>parseInt(a.substr(i,2),16));
    const pb=[1,3,5].map(i=>parseInt(b.substr(i,2),16));
    return "#"+pa.map((v,i)=>Math.round(v*(1-t)+pb[i]*t).toString(16).padStart(2,"0")).join("");
  }
  const lf=geom.floor||["#2c2438","#262033"];
  const tileA = mix(lf[0], themeObj.tileA||lf[0], 0.25);
  const tileB = mix(lf[1], themeObj.tileB||lf[1], 0.25);
  const wall  = mix(geom.wall||"#3a2f4b", themeObj.wall||geom.wall, 0.25);
  const isMidnight = themeObj.id==="midnight";
  const isForest = themeObj.id==="forest";
  const isSolar = themeObj.id==="solar";
  // outdoor layouts: sky gradient band above the wall instead of interior wall
  if(geom.sky){
    const skyTop = dark?"#0a0a20":"#7fa8d8", skyBot = dark?"#1a1a40":"#a8c8e8";
    for(let y=0;y<18;y++){
      // smooth gradient: blend top→bot over the full sky band
      const t=Math.min(1,y/17);
      const c=mix(skyTop,skyBot,t);
      px(0,y,w,1,c);
    }
    if(dark){ for(let x=2;x<w;x+=7)if((frame>>3+x)%9===0)px(x,1+((x*3)%4),1,1,"#fff8c8"); }
    else { px(4,1,3,3,"#fff8c8"); px(5,2,1,1,"#f0d060"); } // sun
    px(0,8,w,1,"#1a1423"); px(0,18,w,1,"#221c2e");
    // outdoor layouts still get their themed floor below the sky band
    for(let y=18;y<h;y+=8)for(let x=0;x<w;x+=8)
      px(x,y,8,8,((x+y)/8)%2?tileA:tileB);
  } else {
    for(let y=0;y<h;y+=8)for(let x=0;x<w;x+=8)
      px(x,y,8,8,((x+y)/8)%2?tileA:tileB);
    // back wall + trim + wainscoting
    px(0,0,w,8,wall); px(0,8,w,1,"#1a1423"); px(0,18,w,1,"#221c2e");
  }
  // windows — cap inside canvas, every 22 tiles, skip first 2 to leave room for door
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
  }
  // door — interior layouts only (outdoor/sky layouts have no wall door)
  if(!geom.sky){
    // door — left edge, theme-aware, with visible inner panel + knob
  const doorWood = isMidnight ? "#1a1423" : isForest ? "#3a2810" : isSolar ? "#5a2810" : "#5a3a1f";
  const doorFrame = isMidnight ? "#2a1f3a" : isForest ? "#4a3a20" : isSolar ? "#7a3818" : "#7a5028";
  const doorInner = isMidnight ? "#1a1428" : isForest ? "#3a2a14" : isSolar ? "#6a2a10" : "#3c2814";
  const doorPanel = isMidnight ? "#3a2a5a" : isForest ? "#5a4a2a" : isSolar ? "#a06028" : "#a07040";
  // outer wood frame + shadow
  px(2,2,9,9,doorWood); px(3,3,1,7,"#1a1423"); px(10,3,1,7,"#1a1423");
  // inner darker rect (the door surface, recessed look)
  px(3,3,8,8,doorFrame);
  // raised panel
  px(4,4,6,6,doorPanel);
  // inset darker line
  px(5,5,4,4,doorInner);
  // brass knob on the right
  px(10,6,1,1,"#e8c170");
  px(10,7,1,1,"#c9a227");
  } // end interior-door guard
  // neon sign — kept fully inside the wall (top-left corner of office)
  const nx=Math.max(2,Math.min(w-26, 30));
  px(nx,2,24,5,"#151022"); px(nx,6,24,1,"#3a2f4b");
  ctx.font="10px ui-monospace"; ctx.textAlign="left";
  ctx.fillStyle=dark?"#ff6ad5":"#e8c170";
  ctx.fillText("AGENT",(nx+1)*S,(6)*S);
  // rug — varies per layout decor
  const decor = LAYOUT_GEOMETRY[settings.layout]?.decor || "rug";
  if(decor==="rug"){
    const rw=Math.min(28,w-12); px((w-rw)/2,h-13,rw,6,dark?"#3a2048":"#3a2f4b");
    px((w-rw)/2+1,h-12,rw-2,4,dark?"#4a2860":"#443358");
  }else if(decor==="war_table"){
    // wide oval meeting table in the center
    const ty=Math.floor(h*0.55);
    px(w/2-12,ty,24,2,dark?"#5a3a14":"#8d5524");
    px(w/2-11,ty+1,22,1,dark?"#4a2a10":"#6b4a2f");
    // monitors around the table
    for(let i=-2;i<=2;i++){
      px(w/2+i*5-2,ty-2,2,2,"#191524");
      px(w/2+i*5-1,ty-3,1,1,(frame>>4)%2?"#5fce7a":"#0f2c1e");
    }
  }else if(decor==="roof"){
    // wooden deck planks
    for(let x=4;x<w-4;x+=8)px(x,h-9,7,3,dark?"#4a3818":"#6b4a2f");
    // potted plants at edges
    px(4,h-16,3,3,"#5fce7a"); px(5,h-15,1,1,"#4aa860");
    px(w-7,h-16,3,3,"#5fce7a"); px(w-6,h-15,1,1,"#4aa860");
  }else if(decor==="garden"){
    // grass field: two-tone tufts + flowers + hedges along the wall base
    for(let x=0;x<w;x+=4)px(x,h-10,3,1,(x/4)%2?"#4aa860":"#5fce7a");
    for(let x=2;x<w-2;x+=9)if((frame>>3+x)%4===0)px(x+((frame>>4)%2),h-11,1,1,"#e8c170");
    for(let x=6;x<w-6;x+=13)if((frame>>2+x)%5===0)px(x,h-12,1,1,"#d84f6f");
    // hedges flanking the floor
    px(4,h-13,5,3,"#3a7a4a"); px(w-9,h-13,5,3,"#3a7a4a");
    px(5,h-14,3,1,"#5fce7a"); px(w-8,h-14,3,1,"#5fce7a");
  }else if(decor==="beach"){
    // ocean band with animated waves + foam + sand
    px(0,h-8,w,2,"#c2b580");                                   // sand
    for(let x=0;x<w;x+=3)px(x,h-6,3,1,((x/3)+(frame>>3))%2?"#4fa4d8":"#5fbbec");  // waves
    for(let x=1;x<w;x+=7)if(((x>>2)+(frame>>4))%3===0)px(x,h-9,2,1,"#fff8e8");    // foam
    // beach umbrella + sandcastle
    px(w-16,h-16,1,8,"#8d5524"); px(w-19,h-18,7,2,"#d84f6f"); px(w-18,h-17,5,1,"#e8c170");
    px(8,h-15,6,5,"#d8c4a0"); px(10,h-16,2,1,"#a06028");
  }else if(decor==="atelier"){
    // art supplies & easels
    px(w/2-10,h-15,8,8,"#191524"); px(w/2-9,h-16,1,1,"#e8c170"); px(w/2-3,h-16,1,1,"#d84f6f");
    px(w/2+2,h-15,8,8,"#191524"); px(w/2+3,h-16,1,1,"#5fce7a"); px(w/2+7,h-16,1,1,"#4fa4d8");
    // paint splatter on floor
    for(let x=2;x<w-2;x+=7)if((frame>>2+x)%5===0)px(x,h-9,1,1,"#d84f6f");
  }else if(decor==="spaceship"){
    // control panels + windows on the wall
    px(20,2,10,5,"#151022"); px(21,3,2,1,"#5fce7a"); px(24,3,2,1,"#d84f6f"); px(27,3,2,1,"#e8c170");
    // stars through the windows
    for(let x=0;x<w;x+=6)if((frame>>3+x)%7===0)px(x,3,1,1,"#fff8c8");
    // floor grating
    for(let x=0;x<w;x+=8)px(x,h-9,6,1,"#3a2f4b");
  }
  // kitchenette against the right wall: counter + machine + cooler, one grouped unit
  const kx=w-24;
  px(kx,h-16,14,1,"#6b4a2f"); px(kx,h-15,14,3,"#54381f");          // counter
  px(kx+2,h-19,5,3,"#33283f"); px(kx+3,h-18,3,1,"#3e334f");        // coffee machine
  px(kx+3,h-19,1,1,"#d84f6f"); px(kx+5,h-18,1,1,"#e8c170");        // buttons
  px(kx+9,h-19,3,3,"#7fa8d8"); px(kx+10,h-20,1,1,"#a8c8e8");       // cooler jug
  px(kx+9,h-16,3,1,"#4a4a5a");                                      // cooler base
  // plant (left wall) — sprite version when loaded, procedural fallback
  const plantX = Math.max(4, 2);
  const plantY = Math.max(20, h-26);
  if(!drawDecorImg("LARGE_PLANT",plantX-1,plantY-6,6,12)){
    px(plantX,plantY,4,2,"#4aa860"); px(plantX-1,plantY-2,3,3,"#5fce7a");
    px(plantX+2,plantY-1,3,2,"#4aa860"); px(plantX-1,plantY,1,2,"#5fce7a");
    px(plantX+1,plantY+2,2,4,"#8d5524"); px(plantX,plantY+6,4,1,"#54381f"); px(plantX+1,plantY+5,1,1,"#6b4a2f");
  }
  // small flower
  if((frame>>4)%2) px(plantX,plantY-2,1,1,"#e8c170");
  // cat — bottom-right corner, ON the floor line (feet at h-4)
  const cx=Math.max(14, w-8), cy=h-4;
  if(!drawDecorImg("claudio",cx-4,cy-6,6,6)){
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
    const dx=8, dy=h-8;   // bottom-left, on the floor near the plant
    if(!drawDecorImg("gitcat",dx-2,dy-6,6,6)){
      px(dx,dy,5,3,"#d97746"); px(dx+1,dy-1,1,1,"#d97746"); px(dx+3,dy-1,1,1,"#d97746");
      px(dx+4,dy,1,1,"#d97746"); px(dx+1,dy+1,1,1,"#a04020"); px(dx+4,dy+1,1,1,"#a04020");
      if(((frame>>3)%2)) px(dx+5,dy-1,2,1,"#a04020");
    }
  }
  // fish tank (bottom-center, between cooler and cat)
  if(haveUnlock && haveUnlock("pet_fish")){
    const fx=Math.floor(w/2)-4, fy=h-10;   // on the floor, center
    px(fx,fy-6,8,6,"#3c5a7a"); px(fx+1,fy-5,6,4,"#4fa4d8");
    px(fx+1,fy-2,6,1,"#6b4a2f"); px(fx+2,fy-4,1,1,"#e8c170"); px(fx+3,fy-5,1,1,"#5fce7a");
    if((frame>>2)%3===0)px(fx+5,fy-3,1,1,"#d84f6f");
  }
  // bob animation when petted
  const bob = petBounce ? ((petTimer>>1)%2) : 0;
  if(bob && !decorImg.claudio?.complete){px(cx+2,cy-5,4,1,"#fff8c8");}
  if(petBounce){petTimer--; if(petTimer<=0)petBounce=false;}
}

function drawDesk(x,y,a,cosmetics){
  const gold=cosmetics.includes("gold_monitor");
  const glass = cosmetics.includes("desk_glass");
  const standing = cosmetics.includes("desk_standing");
  const wood = cosmetics.includes("desk_wood");
  // desk top
  if(glass){
    px(x,y+10,18,1,"#7fa8d8"); px(x,y+11,18,3,"#3c5a7a"); px(x,y+14,18,1,"#4fa4d8");
  }else if(standing){
    px(x,y+9,18,1,"#7a6f8f"); px(x,y+10,18,1,"#4a4a5a"); px(x,y+12,3,3,"#1a1423");
  }else if(wood){
    px(x,y+10,18,1,"#8d5524"); px(x,y+11,18,3,"#6b4a2f"); px(x,y+14,18,1,"#54381f");
  }else{
    px(x,y+9,18,1,"#8d5524");   // top surface highlight
    px(x,y+10,18,2,"#6b4a2f");  // slab
    px(x,y+12,18,3,"#54381f");  // front panel
  }
  // legs (skip if glass or standing) — flush under the front panel
  if(!glass && !standing) {
    px(x+1,y+15,2,4,"#3c2814"); px(x+15,y+15,2,4,"#3c2814");
  }
  if(standing){
    px(x+1,y+13,2,4,"#3a2f4b"); px(x+15,y+13,2,4,"#3a2f4b"); // tall legs
  }
  // monitor
  px(x+11,y+4,7,6,gold?"#3a2a10":"#191524");
  px(x+13,y+10,3,1,"#4a4a5a");
  if(cosmetics.includes("plant")){px(x+1,y+7,2,3,"#5fce7a");px(x+1,y+10,2,1,"#8d5524")}
  if(cosmetics.includes("mug")){px(x+4,y+8,2,2,"#d84f6f");px(x+6,y+8,1,1,"#d84f6f")}
  if(cosmetics.includes("lamp")){px(x+8,y+7,1,2,"#e8c170");px(x+7,y+6,3,1,"#e8c170")}
  if(cosmetics.includes("book")){px(x+10,y+9,2,1,"#c9a227");px(x+11,y+8,1,2,"#d84f6f")}
  if(cosmetics.includes("headphones")){px(x+10,y+5,1,2,"#2b2b2b");px(x+11,y+4,1,3,"#2b2b2b");px(x+10,y+4,3,1,"#2b2b2b")}
}

function deskScreen(x,y,a){
  const t=frame>>3;
  let col="#0f2c1e";
  if(a){
    if(a.activity==="running")col=(t%4<2)?"#0f3c1e":"#0f2c16";
    else if(a.activity==="browsing")col=(t%6<3)?"#1e2c4a":"#24365a";
    else if(a.activity==="typing")col=(t%2)?"#12321e":"#0f2c1e";
    else if(a.status==="waiting")col="#3c1e28";
  }
  px(x+12,y+5,5,4,col);
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
    const cs = Math.max(1, Math.floor(S/3));   // sprite scale: chars ~2 tiles wide, 4 tall — room proportion
    ctx.fillRect(Math.round((x+7)*S), Math.round((y+14)*S), 8*cs, 1*cs);
    ctx.imageSmoothingEnabled=false;
    // feet at y+12: head+shoulders above desk top (y+10), lower body behind slab
    ctx.drawImage(spr, 0,0,CHAR_FW,CHAR_FH,
      Math.round((x+7)*S), Math.round((y+12)*S - CHAR_FH*cs), CHAR_FW*cs, CHAR_FH*cs);
    // cosmetics overlay — anchored to the sprite's actual top-left in pixels
    const sx0 = Math.round((x+7)*S), sy0 = Math.round((y+12)*S - CHAR_FH*cs);
    const hx = (sx0 + 4*cs)/S, hy = (sy0 + 0)/S;   // head-top in tile coords
    if(cosmetics.includes("crown")){px(hx,hy,5*cs/S,2*cs/S,"#e8c170");px(hx+1,hy-cs/S,cs/S,cs/S,"#e8c170");px(hx+3,hy-cs/S,cs/S,cs/S,"#e8c170")}
    else if(cosmetics.includes("beanie")){px(hx-1,hy,7*cs/S,2*cs/S,"#d84f6f");px(hx+1,hy-cs/S,3*cs/S,cs/S,"#d84f6f")}
    if(cosmetics.includes("cape")){ctx.fillStyle="rgba(122,48,48,0.85)";ctx.fillRect(sx0+3*cs,sy0+10*cs,10*cs,12*cs)}
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
    px(x+3,y-4,3,3,"#e8c170"); px(x+4,y-3,1,1,"#1a1423");
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
  // clip + ellipsize so labels never bleed into adjacent columns
  const cx=(x+9)*S;
  const colW=18*S;
  // clip label text to the seat width (18 tiles) but only Y from 16-32 down
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.round(x*S), Math.round(y*S)+16*S, colW, 17*S);
  ctx.clip();
  ctx.font=(S>=5?"9px":"10px")+" ui-monospace,monospace";ctx.textAlign="center";
  const name=a.label.slice(0,14);
  ctx.fillStyle=a.kind==="subagent"?"#3a2a10":"#2a2038";
  ctx.fillRect(Math.round((x+2)*S), Math.round((y+20)*S), (colW-4*S), 7*S);
  ctx.fillStyle=a.kind==="subagent"?"#ffd98a":"#ffffff";
  ctx.fillText(name,cx,(y+23)*S);
  ctx.fillStyle="#8a7fa8";
  const st=a.status==="waiting"?"needs input!"
        :a.status==="working"?(a.tool||"working"):a.status;
  ctx.fillText(st.slice(0,14),cx,(y+25)*S);
  if(a.detail){ctx.fillStyle="#6a5f80";
    ctx.fillText(a.detail.slice(0,16),cx,(y+27.5)*S)}
  ctx.restore();
  drawLogo(platOf(a),x+1,y+8);   // platform chip sits ON the desk top, left edge
}

let petBounce=false, petTimer=0;
let soundOn=false, audioCtx=null;
try{soundOn=localStorage.getItem("pixelOfficeSound")==="1"}catch(e){}
let settings = {layout:"open",theme:"default",sound:soundOn,show_chips:true,
  show_subagent_chips:false,auto_focus_unlocks:true,max_chars:4,areas:{},
  folder_areas:{},paint:false,paint_color:"#5fce7a",painted:{},lock_floor:false};
const _D = window.OFFICE_DATA;
// RANKS / RANKS_THRESHOLDS / THEMES / LAYOUTS / LAYOUT_GEOMETRY / PLATFORMS / SHORTCUTS provided by data.js
const AREA_PALETTE = ["#5fce7a","#4fa4d8","#d97746","#9b6fd8","#d84f6f","#c9a227","#7a8ad8","#e8c170"];
const THEME_DAILY = ["Lobby","Studio","Tower","Loft","Bunker","Library","Dojo","Salon","Lab","Pier","Atrium","Cabin"];
function haveUnlock(id){return progress && (progress.catalog||[]).find(c=>c.id===id&&c.have)}

function fillLayout(){
  const box=document.getElementById("layoutbox");
  box.innerHTML="";
  LAYOUTS.forEach(L=>{
    const locked = L.require && !haveUnlock(L.require);
    const row = document.createElement("div");
    row.className="row";
    row.innerHTML="<div style='flex:1'><div class='n'>"+
      L.name+(locked?" <span class='h'>(locked)</span>":"")+"</div>"+
      "<div class='h'>"+L.hint+"</div></div>"+
      "<span class='btn "+(settings.layout===L.id?"on":"")+"'>"+
      (settings.layout===L.id?"active":"use")+"</span>";
    if(!locked) row.querySelector(".btn").onclick=()=>updateSetting("layout",L.id);
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
        "<span class='btn' data-rm='"+esc+"'>remove</span>";
      box.appendChild(row);
    });
  }
  const add=document.createElement("div");
  add.className="row";
  add.innerHTML="<input class='txt' id='newArea' name='newArea' placeholder='new area name' aria-label='new area name'>"+
    "<span class='btn' id='addArea'>add area</span>";
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
    "<span class='btn' id='addFolder'>map</span>";
  box.appendChild(fr);
  if(Object.keys(settings.folder_areas||{}).length){
    Object.entries(settings.folder_areas).forEach(([f,a])=>{
      const row=document.createElement("div");row.className="row";
      const esc=f.replace(/'/g,"&#39;");
      row.innerHTML="<div style='flex:1'><div class='n'>"+f+"</div><div class='h'>→ "+a+"</div></div>"+
        "<span class='btn' data-unmap='"+esc+"'>unmap</span>";
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
   ["show_subagent_chips","subagent chips",settings.show_subagent_chips],
   ["auto_focus_unlocks","focus on unlock",settings.auto_focus_unlocks],
   ["paint","paint mode (drag to color)",settings.paint],
   ["lock_floor","lock to floor (no animations)",settings.lock_floor],
 ];
  items.forEach(([k,label,on])=>{
    const r=document.createElement("div");r.className="row";
    r.innerHTML="<div style='flex:1'><div class='n'>"+label+"</div></div>"+
      "<span class='btn "+(on?"on":"")+"' data-tog='"+k+"' role='switch' aria-checked='"+(on?1:0)+"' aria-label='"+label+"'>"+(on?"on":"off")+"</span>";
    box.appendChild(r);
  });
  box.querySelectorAll("[data-tog]").forEach(b=>b.onclick=()=>{
    const k=b.getAttribute("data-tog");settings[k]=!settings[k];
    saveSettings();fillSettings();applyProgress(progress);
  });
  const r=document.createElement("div");r.className="row";
  r.innerHTML="<div style='flex:1'><div class='n'>grid columns</div></div>"+
    "<input class='txt' type='number' id='mc' name='max_chars' min='2' max='8' value='"+settings.max_chars+"' style='width:60px' aria-label='grid columns'>";
  box.appendChild(r);
  document.getElementById("mc").onchange=(e)=>{settings.max_chars=Math.max(2,Math.min(8,+e.target.value||4));saveSettings()};
  // import / export layout (settings + areas + painted)
  const ie=document.createElement("div");ie.className="row";
  ie.innerHTML="<div style='flex:1'><div class='n'>layout import/export</div></div>"+
    "<span class='btn' id='exportLayout'>export</span>"+
    "<span class='btn' id='importLayout'>import</span>";
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
          saveSettings();fillSettings();fillLayout();fillAreas();
          localStorage.setItem("didImport","1");
        }catch(e){alert("bad layout json: "+e.message);}
      };
      r.readAsText(f);
    };
    inp.click();
  };
  // reset — wipe progress, event history, painted tiles (fresh start)
  const rst=document.createElement("div");rst.className="row";
  rst.innerHTML="<div style='flex:1'><div class='n'>reset everything</div><div class='d'>wipe XP, badges, history, painted tiles</div></div>";
  const rbtn=document.createElement("button");rbtn.textContent="reset";
  rbtn.onclick=()=>{
    if(!confirm("Reset ALL office progress? XP, badges, unlock history and painted tiles will be wiped. This cannot be undone."))return;
    fetch("/state",{method:"DELETE"}).then(r=>r.json()).then(()=>{
      localStorage.removeItem("pixelOfficeSeen");
      localStorage.removeItem("didImport");
      location.reload();
    }).catch(()=>alert("reset failed — is the office server running?"));
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
function seatPos(i,perRow,geom,padLeft){
  const g = geom || LAYOUT_GEOMETRY[settings.layout] || LAYOUT_GEOMETRY.open;
  return {x:(padLeft==null?10:padLeft)+(i%perRow)*g.colStep, y:g.labelY+Math.floor(i/perRow)*g.rowStep};
}
function stepChars(perRow,padLeft,geom){
  if(settings.lock_floor)return; // freeze in place
  const seen=new Set();
  agents.forEach((a,i)=>{
    seen.add(a.id);
    const seat=seatPos(i,perRow,geom,padLeft);
    let c=chars.get(a.id);
    if(!c){ c={x:2,y:2,seat,phase:"in",lastStatus:a.status}; chars.set(a.id,c); }
    c.seat=seat;
    const tx=c.phase==="out"?2:c.seat.x+3, ty=c.phase==="out"?2:c.seat.y;
    const dx=tx-c.x, dy=ty-c.y, d=Math.hypot(dx,dy);
    if(d<WALK){ c.x=tx;c.y=ty; if(c.phase==="in")c.phase="seated"; }
    else { c.x+=dx/d*WALK; c.y+=dy/d*WALK; }
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
function syncSoundBtn(){sBtn.textContent=soundOn?"sound on":"sound off";
  sBtn.classList.toggle("on",soundOn)}
sBtn.onclick=()=>{soundOn=!soundOn;
  try{localStorage.setItem("pixelOfficeSound",soundOn?"1":"0")}catch(e){}
  if(soundOn)chime([660]); syncSoundBtn()};
syncSoundBtn();

const spawnBtn=document.getElementById("spawn");
const inspectorBtn=document.getElementById("inspectorbtn");
if(IN_VSCODE){spawnBtn.style.display="";
  spawnBtn.onclick=()=>vsapi.postMessage({type:"spawnAgent"});}
function syncInspectorBtn(){if(!inspectorBtn)return;inspectorBtn.style.display=focusedId?"":"none"}

function closeSheets(){document.querySelectorAll(".sheet").forEach(el=>el.style.display="none")}
function toggleSheet(id){
  const el=document.getElementById(id);
  const open=el.style.display==="block";
  closeSheets();
  if(!open){
    el.style.display="block";
    const seen = JSON.parse(localStorage.getItem("sheetsSeen")||"[]");
    if(!seen.includes(id)){
      seen.push(id);
      localStorage.setItem("sheetsSeen", JSON.stringify(seen));
    }
  }
}
// attach X close button to every sheet header
document.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll(".sheet").forEach(el=>{
    const h=el.querySelector("h2");if(!h)return;
    if(h.querySelector(".x"))return;
    h.style.cssText="display:flex;justify-content:space-between;align-items:center";
    const x=document.createElement("span");
    x.className="x";
    x.textContent="✕";
    x.style.cssText="cursor:pointer;color:#7a6f8f;font-weight:normal;font-size:16px;padding:0 4px;line-height:1";
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
document.getElementById("howbtn").onclick=()=>toggleSheet("sheet-how");
document.getElementById("eventbtn").onclick=()=>{fillEvents();toggleSheet("sheet-events");};
document.getElementById("legendbtn").onclick=()=>{fillLegend();toggleSheet("sheet-legend");};
document.getElementById("inspectorbtn").onclick=()=>{fillInspector();toggleSheet("sheet-inspector");};
document.getElementById("themeNextbtn").onclick=()=>{
  const ids=THEMES.map(t=>t.id);
  const i=ids.indexOf(settings.theme);
  const next=THEMES[(i+1)%THEMES.length].id;
  settings.theme=next;
  saveSettings();
  applyTheme(next);
  fillSettings();
  applyProgress(progress);   // refresh chips so the new theme bg shows through
};
document.getElementById("platformsbtn").onclick=()=>{fillPlatforms();toggleSheet("sheet-platforms");};
function fillPlatforms(){
  const box=document.getElementById("platformsbox");if(!box)return;
  box.innerHTML="";
  PLATFORMS.forEach(p=>{
    const d=document.createElement("div");
    d.className="row";
    d.style.cssText="padding:10px 8px;align-items:flex-start";
    const installed = String((progress&&progress.stats&&progress.stats.platforms)||[]).includes(p.id) ||
                     (p.id==="hermes") || (p.id==="cli");
    d.innerHTML="<img src='assets/"+p.icon+".svg' width='28' height='28' style='flex-shrink:0;margin-top:2px'>"+
      "<div style='flex:1;margin-left:10px'>"+
      "<div class='n'>"+p.name+(installed?" <span class='h' style='color:#5fce7a'>· detected</span>":"")+"</div>"+
      "<div class='h' style='margin-top:3px'>"+p.what+"</div>"+
      "<div class='h' style='margin-top:6px'><b style='color:#e8c170'>use for:</b> "+p.usedFor+"</div>"+
      "<div class='h' style='margin-top:3px'><b style='color:#e8c170'>install:</b> "+p.install+"</div>"+
      (p.url?("<div class='h' style='margin-top:3px'><a href='"+p.url+"' target='_blank' style='color:#4fa4d8'>"+p.url+"</a></div>"):"")+
      "</div>";
    box.appendChild(d);
  });
  box.innerHTML += "<p class='h' style='margin-top:12px'>Observer only. Nothing here blocks, edits, or vetoes prompts — it just draws a pixel character.</p>";
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
    "<p class='h' style='margin-top:10px'>shortcuts</p>"+
    ["R roster","U usage","B badges","L layout","S settings","D dbg","E live","? legend","T theme","P platforms","esc close"]
       .map(s=>"<div class='kv'><span><code>"+s.split(" ")[0]+"</code></span><b>"+s.split(" ").slice(1).join(" ")+"</b></div>").join("");
}
document.addEventListener("keydown",(e)=>{
  if(e.target.tagName==="INPUT")return;
  const k=e.key.toLowerCase();
  const map={r:"sheet-roster",u:"sheet-stats",b:"sheet-unlocks",l:"sheet-layout",
             s:"sheet-settings",d:"sheet-debug",e:"sheet-events","?":"sheet-legend",
             t:"themeNext",p:"sheet-platforms"};
  if(k==="escape"){closeSheets();return;}
  const id=map[k];if(!id)return;
  e.preventDefault();
  if(id==="sheet-layout")fillLayout();
  if(id==="sheet-settings"){fillSettings();fillAreas();}
  if(id==="sheet-legend")fillLegend();
  if(id==="sheet-events")fillEvents();
  if(id==="themeNext")document.getElementById("themeNextbtn").onclick();
  if(id==="sheet-platforms")fillPlatforms();
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
    info.innerHTML="<div class='n'>"+(a.label||a.id)+
      (a.kind==="subagent"?" <span class='h'>(sub)</span>":"")+
      " <img src='"+platIcon+"' width='10' height='10' style='vertical-align:middle'>"+
      "</div><div class='h'>"+a.status+
      (a.tool?" · "+a.tool:"")+
      (a.detail?" · "+a.detail:"")+
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
  const rows=[
    ["rank", (progress&&progress.rank)||"intern"],
    ["xp", (progress&&progress.xp)||0],
    ["live now", agents.length],
    ["sessions", s.sessions||0],
    ["tools", s.tools||0],
    ["reads / writes", (s.reads||0)+" / "+(s.writes||0)],
    ["browse / shell", (s.browses||0)+" / "+(s.shells||0)],
    ["subagents", s.subagents||0],
    ["approvals", s.approvals||0],
    ["errors", s.errors||0],
    ["peak concurrent", s.max_concurrent||0],
    ["by runtime", plats],
    ["top tools", top],
  ];
  document.getElementById("statbox").innerHTML=rows.map(([k,v])=>
    "<div class='kv'><span>"+k+"</span><b>"+v+"</b></div>").join("");
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
  document.getElementById("rank").textContent=(p.rank||"intern")+" · "+(p.xp||0)+" xp"+next;
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
  // tile size so columns * max rows fit in canvas (no overlap).
  // Reserve room for the label below each desk (~4 rows of tile height).
  const labelPx = Math.max(40, Math.round(60 * 1)); // safe upper bound
  const usableW=W-16, usableH=H-32-labelPx;
  let perRow=Math.min(maxc, Math.max(1, Math.floor(usableW/(colStep*S))));
  // but the layout might want fewer columns
  perRow = Math.min(perRow, geom.perRow);
  let rows=Math.ceil(list.length/Math.max(1,perRow));
  // pick tile size so columns fit width AND rows fit height
  S=Math.max(2, Math.min(8, Math.floor(Math.min(usableW/(perRow*colStep), usableH/(rows*rowStep)))));
  // theme background
  const theme = (THEMES.find(t=>t.id===settings.theme) || THEMES[0]);
  cv.style.background = theme.bg;
  const tileA = (night() && theme.id==="default")?"#231c2e":theme.tileA;
  const tileB = (night() && theme.id==="default")?"#1c1626":theme.tileB;
  const wall = (night() && theme.id==="default")?"#2a2038":theme.wall;
  window._theme = {id:theme.id, tileA, tileB, wall, isDark:night()};
  const gw=Math.floor(W/S),gh=Math.floor(H/S); _gw=gw; _gh=gh;
  drawOffice(gw,gh);
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
  const rowWidth = perRow * colStep;
  const padLeft = Math.max(10, Math.floor((usableW/S - rowWidth)/2));
  const prev=agents; agents=list; stepChars(perRow,padLeft,geom); agents=prev;
  // draw areas (behind desks) so each area is a colored tile cluster
  const areas = settings.areas || {};
  if(Object.keys(areas).length && list.length){
    const names=Object.keys(areas);
    list.forEach((a,i)=>{
      const idx=i % names.length;
      const color=areas[names[idx]];
      const seat=seatPos(i,perRow,geom,padLeft);
      ctx.globalAlpha=0.12;
      ctx.fillStyle=color;
      // desk mat sized to the workstation footprint
      ctx.fillRect(Math.round((seat.x)*S), Math.round((seat.y+8)*S), 18*S, 8*S);
      ctx.globalAlpha=1;
    });
  }
  list.forEach((a,i)=>{
    const seat=seatPos(i,perRow,geom,padLeft);
    drawDesk(seat.x,seat.y,a,cosmetics); deskScreen(seat.x,seat.y,a);
    drawHealthBar(a,seat.x,seat.y);
  });
  list.forEach((a,i)=>{
    const c=chars.get(a.id); if(!c)return;
    const seated=c.phase==="seated";
    drawChar(a,c.x,c.y,seated,cosmetics);
    if(seated){
      const seat=seatPos(i,perRow,geom,padLeft);
      // redraw desk top over the seated char's lower body so they sit BEHIND the desk
      drawDesk(seat.x,seat.y,a,cosmetics); deskScreen(seat.x,seat.y,a);
      drawBubble(a,seat.x+2,seat.y); label(a,seat.x,seat.y);
    }
    if(focusedId===a.id){
      // outline ring around the focused agent
      const seat=seatPos(i,perRow,geom,padLeft);
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
  fillEvents();fillInspector();
  document.getElementById("inspectorbtn").style.display = focusedId ? "" : "none";
  const n=agents.length, w=agents.filter(a=>a.status==="waiting").length;
  document.getElementById("count").textContent=
    n+" agent"+(n===1?"":"s")+(w?" · "+w+" waiting!":"");
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
    const _perRow=Math.min(_maxc, Math.max(1, Math.floor((_gw-2)/_geom2.colStep)));
    const _padLeft = Math.max(10, Math.floor((_gw - _perRow*_geom2.colStep)/2));
    let best=null,bestD=99999;
    list.forEach((a,i)=>{
      const s=seatPos(i,_perRow,_geom2,_padLeft);
      const d=Math.hypot(tx-s.x-4, ty-s.y-6);
      if(d<bestD){bestD=d;best=a;}
    });
    if(best && bestD<14){
      focusedId = (focusedId===best.id) ? null : best.id;
      document.getElementById("inspectorbtn").style.display = focusedId ? "" : "none";
      if(focusedId){fillInspector();toggleSheet("sheet-inspector");}
    }
  }
});
