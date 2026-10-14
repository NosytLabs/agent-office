/* Optional, read-only studio presentation. Native observer sprites remain intact.
 * The instance decorator can be disabled without changing work status, XP, or usage.
 */
(function (root) {
  'use strict';
  const POSES = ['idle','walk-a','walk-b','type','read','attention','wait','cheer','error'];
  const PET_POSES = ['idle','walk-a','walk-b','sit','sleep','happy','pet'];
  const PET_NAMES = ['Orange cat','Tuxedo cat','White cat','Grey cat','Corgi','Black dog','Golden dog','Pocket robot'];
  function pose(a = {}, c = {}, time = 0, paused = false) {
    if (c.moving && !paused) return ['idle','walk-a','walk-b','walk-a'][Math.floor(Math.max(0,Number(c.distance)||0)/3)%4];
    if (a.status === 'waiting') return 'attention';
    if (a.status === 'idle' && String(a.detail || '').startsWith('⚠ ')) return 'error';
    if (a.quiet && ['working','thinking'].includes(a.recorded_status)) return 'wait';
    if (a.status === 'done') return 'cheer';
    if (a.status === 'working') {
      if (/read|search|grep|glob|fetch|browse/i.test(a.tool || '') || ['reading','browsing'].includes(a.activity)) return 'read';
      if (/bash|shell|exec|terminal|command/i.test(a.tool || '')) return 'wait';
      return 'type';
    }
    return 'idle';
  }
  function petPose(p = {}, affection = false, paused = false) {
    if (affection) return 'pet';
    if (p.mode === 'sleep' && !p.moving) return 'sleep';
    if (p.moving && !paused) return ['idle','walk-a','walk-b','walk-a'][Math.floor(Math.max(0,Number(p.distance)||0)/3)%4];
    return p.mode === 'sit' ? 'sit' : 'idle';
  }
  function preferences(value = {}) {
    return {
      art: value?.art === 'classic' ? 'classic' : 'studio',
      pets: [0,1].map((fallback,i) => Number.isInteger(value?.pets?.[i]) && value.pets[i]>=0 && value.pets[i]<8 ? value.pets[i] : fallback),
      season: ['autumn','winter'].includes(value?.season) ? value.season : 'none',
    };
  }
  function validManifest(m) {
    if (!m || m.version!==1 || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width<1 || m.height<1 || m.width>1024 || m.height>1024 || !m.entries || typeof m.entries!=='object' || Array.isArray(m.entries)) return false;
    const required = [
      ...Array.from({length:6},(_,i)=>POSES.map(p=>`person-${i}-${p}`)).flat(),
      ...Array.from({length:8},(_,i)=>PET_POSES.map(p=>`pet-${i}-${p}`)).flat(),
      'icon-parcel','icon-crown','holiday-tree','holiday-gift','holiday-wreath','holiday-pumpkin','holiday-ghost','holiday-bat',
    ];
    if (!required.every(k=>Object.hasOwn(m.entries,k))) return false;
    if (Object.keys(m.entries).length>256) return false;
    return Object.entries(m.entries).every(([key,e]) => {
      const r=e?.rect,a=e?.anchor;
      return /^[a-zA-Z0-9_-]+$/.test(key) && Array.isArray(r) && r.length===4 && r.every(Number.isInteger) && r[0]>=0 && r[1]>=0 && r[2]>0 && r[3]>0 && r[0]+r[2]<=m.width && r[1]+r[3]<=m.height && Array.isArray(a) && a.length===2 && a.every(Number.isInteger) && a[0]>=0 && a[0]<r[2] && a[1]>=0 && a[1]<r[3] && (!key.startsWith('person-') || (r[2]===32 && r[3]===36 && a[0]===16 && a[1]===35)) && (!key.startsWith('pet-') || (r[2]===28 && r[3]===26 && a[0]===14 && a[1]===25));
    });
  }
  const api = Object.freeze({pose,petPose,preferences,validManifest});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeStudio = api;
  if (typeof document === 'undefined') return;
  if (root.officeStudio || typeof scene === 'undefined') return;

  const storageKey = 'agent-office:studio:v1:'+(document.body.dataset.agentOfficePreview==='1'?'preview':'observer');
  let prefs;
  try { prefs=preferences(JSON.parse(localStorage.getItem(storageKey))); } catch { prefs=preferences(); }
  const art={ready:false,source:'loading',sprites:new Map(),error:'',prefs};
  root.officeStudio=art;
  const original={image:scene.image,character:scene.character,desk:scene.desk,pet:scene.pet,draw:scene.draw,update:scene.update,agentCard,renderFurniturePreviews};
  const portraits=new WeakMap();
  let before=null;
  const handoffs=new Map();
  art.handoffs=handoffs;
  const petDistances=new Map();
  const enabled=()=>art.ready && prefs.art==='studio';
  function sprite(key) { return enabled()?art.sprites.get(key):null; }
  function person(a) {
    const key=characterSpriteKey(a,scene.settings,scene.sprites);
    if (key==='studio-assistant') return 4;
    if (key==='orbit-courier') return 5;
    if (key==='moss-engineer') return 2;
    const index=/^char[0-5]$/.test(key)?Number(key.slice(-1)):hash(a.id)%6;
    return index>=4?index+2:index;
  }
  function image(key,x,y,w,h) {
    const im=sprite(key);
    if (!im) return false;
    const ctx=scene.ctx;
    const scale=Math.min(w/im.width,h/im.height);
    const iw=Math.max(1,Math.round(im.width*scale)), ih=Math.max(1,Math.round(im.height*scale));
    ctx.drawImage(im,Math.round(x+(w-iw)/2),Math.round(y+h-ih),iw,ih);
    return true;
  }
  scene.image=function(key,x,y,w,h) { return image(key,x,y,w,h) || original.image.call(this,key,x,y,w,h); };
  scene.character=function(a,x,y,c) {
    const state=pose(a,c,this.time,this.paused);
    const im=sprite(`person-${person(a)}-${state==='type'?'idle':state}`);
    if (!im) return original.character.call(this,a,x,y,c);
    const ctx=this.ctx;
    const left=Math.round(x+8-16), top=Math.round(y+31-35);
    ctx.save();
    if (a.status==='gone') ctx.globalAlpha=.4;
    else if (a.status==='done') ctx.globalAlpha=.85;
    if (c.moving && c.dir==='left') { ctx.translate(left+32,top);ctx.scale(-1,1);ctx.drawImage(im,0,0); }
    else ctx.drawImage(im,left,top);
    if (this.cosmetics.includes('crown')) image('icon-crown',left+9,top-2,14,12);
    ctx.restore();
  };
  scene.desk=function(s) {
    const result=original.desk.call(this,s),c=this.chars.get(s.a.id);
    if(enabled() && c && !c.moving && pose(s.a,c,this.time,this.paused)==='type') {
      const tap=this.paused?0:Math.floor(this.time*5)%2;
      const skin=person(s.a)===4?'#e1e5d9':person(s.a)===5?'#ad754b':'#e8c49d';
      this.rect(s.x+11,s.y+7+tap,3,2,skin);
      this.rect(s.x+18,s.y+8-tap,3,2,skin);
    }
    return result;
  };
  scene.pet=function(x,y,black=false,behavior={}) {
    const key=black?'blackcat':'cat',index=black?1:0;
    const active=this.petActive===key && this.petUntil>this.time;
    const previous=petDistances.get(key);
    const travelled=previous && previous.geometry===this.geometry ? Math.hypot(x-previous.x,y-previous.y) : 0;
    const distance=(previous?.distance||0)+(!this.paused && travelled<10?travelled:0);
    petDistances.set(key,{x,y,distance,geometry:this.geometry});
    const state=petPose({...behavior,distance},active,this.paused);
    const im=sprite(`pet-${prefs.pets[index]}-${state}`);
    if (!im) return original.pet.call(this,x,y,black,behavior);
    const left=Math.round(x-10),top=Math.round(y-18),ctx=this.ctx;
    ctx.save();
    if (behavior.facing<0) {ctx.translate(left+20,top);ctx.scale(-1,1);ctx.drawImage(im,0,0,20,19);}
    else ctx.drawImage(im,left,top,20,19);
    ctx.restore();
    if (active) {
      image('icon-heart',x-5,y-27,10,10);
      const name=this.settings.pet_names?.[black?'cat2':'cat1']||(black?'Gitcat':'Claudio');
      this.text(name.slice(0,16),x,y+8,'#f0ddbe',4,'center');
    }
    this.petHits.push({key,x:left-2,y:top-2,w:24,h:23});
  };
  scene.update=function(...args) {
    const next=args[0]||[];
    const ids=new Set(next.map(a=>a.id));
    // Bootstrap is not a completion event. Disconnects, history and removal never celebrate.
    if (before && this.observerConnected && !this.paused) for (const a of next) {
      const prior=before.get(a.id);
      if (a.kind==='subagent' && a.parent && a.status==='done' && prior && !['done','gone'].includes(prior) && ids.has(a.parent)) {
        handoffs.set(a.id,{parent:a.parent,start:this.time});
        if (handoffs.size>16) handoffs.delete(handoffs.keys().next().value);
      }
    }
    before=new Map(next.map(a=>[a.id,a.status]));
    for (const [id,h] of handoffs) if (!ids.has(id)||!ids.has(h.parent)) handoffs.delete(id);
    return original.update.apply(this,args);
  };
  scene.draw=function(...args) {
    const result=original.draw.apply(this,args);
    if (!enabled() || !this.grid || !this.transform) return result;
    const ctx=this.ctx,{scale,ox,oy}=this.transform,dpr=Math.min(devicePixelRatio||1,2);
    ctx.save();ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*ox,dpr*oy);ctx.imageSmoothingEnabled=false;
    if (this.settings.decorations && prefs.season!=='none') {
      const w=this.grid.w;
      const decorations=prefs.season==='winter'
        ? [['holiday-tree',w-34,3,24,30],['holiday-gift',w-52,17,14,14],['holiday-wreath',9,8,16,16]]
        : [['holiday-pumpkin',w-29,15,18,18],['holiday-ghost',8,8,14,20],['holiday-bat',w/2-11,8,22,12]];
      for (const p of decorations) image(...p);
    }
    for (const r of this.propReactions||[]) {
      const age=this.time-r.started;if(age<0||age>=4) continue;
      const kind=r.kind==='coffee'?'coffee-steam':r.kind==='cooler'?'water-drops':['monstera','fern','planter','succulent'].includes(r.kind)?'water-drops':'sparkles';
      image(`fx-${kind}-${Math.floor(age*4)%4}`,r.x+2,r.y-10,16,16);
    }
    for (const [id,h] of handoffs) {
      const age=this.time-h.start;
      if (age<0||age>=3 || !this.observerConnected) {handoffs.delete(id);continue;}
      const from=this.grid.seats.find(s=>s.a.id===id),to=this.grid.seats.find(s=>s.a.id===h.parent);
      if(!from||!to) continue;
      const t=Math.min(1,age/2);
      image('icon-parcel',from.x+12+(to.x-from.x)*t,from.y-25+(to.y-from.y)*t-Math.sin(t*Math.PI)*12,12,12);
    }
    ctx.restore();return result;
  };
  document.getElementById('c')?.addEventListener('spritesready',()=>{if(art.ready)redraw();});
  function paintPortrait(a,card) {
    if (!enabled()) return;
    const canvas=card.querySelector('.portrait'),key=`person-${person(a)}-idle`,im=sprite(key);
    if (!canvas||!im||portraits.get(canvas)===im) return;
    canvas.width=24;canvas.height=28;
    const g=canvas.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(im,4,5,24,28,0,0,24,28);
    portraits.set(canvas,im);
  }
  agentCard=function(a,existing) {const card=original.agentCard(a,existing);paintPortrait(a,card);return card;};
  renderFurniturePreviews=function() {
    original.renderFurniturePreviews();
    if(!enabled()) return;
    for(const b of document.querySelectorAll('#furniture-tools [data-kind]')) {
      const im=sprite(b.dataset.kind);if(!im) continue;
      const c=b.querySelector('canvas'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;
      const k=Math.max(1,Math.floor(Math.min(104/im.width,88/im.height)));
      g.drawImage(im,Math.round((120-im.width*k)/2),Math.round((104-im.height*k)/2),im.width*k,im.height*k);
    }
  };
  function redraw() {
    document.documentElement.dataset.officeArt=enabled()?'studio':'classic';
    for(const card of document.querySelectorAll('.agent-card[data-agent]')) {
      const a=agents.find(a=>a.id===card.dataset.agent);if(!a) continue;
      portraitSources.delete(card.querySelector('.portrait'));
      portraits.delete(card.querySelector('.portrait'));
      agentCard(a,card);
    }
    renderFurniturePreviews();scene.draw(0);
  }
  const section=document.createElement('section');section.className='studio-controls';section.setAttribute('aria-labelledby','studio-art-heading');
  section.innerHTML='<h3 id="studio-art-heading">Studio artwork</h3><p class="h">Characters, furniture and companion looks. These viewing preferences never change agent work or usage.</p><div class="studio-options"></div><p class="h" id="studio-art-status" role="status">Loading studio sprites…</p>';
  const options=section.querySelector('.studio-options');
  function select(label,id,choices,value,change) {
    const wrap=document.createElement('label');wrap.className='studio-option';wrap.htmlFor=id;wrap.textContent=label;
    const input=document.createElement('select');input.id=id;
    for(const [v,text] of choices){const option=document.createElement('option');option.value=v;option.textContent=text;input.append(option);}
    input.value=String(value);
    input.onchange=()=>{change(input.value);art.prefs=prefs;let saved=true;try{localStorage.setItem(storageKey,JSON.stringify(prefs));}catch{saved=false;}redraw();status.textContent=saved?'View saved on this browser.':'Applied for this visit; browser storage is unavailable.';};
    wrap.append(input);options.append(wrap);
  }
  const status=section.querySelector('#studio-art-status');
  select('Artwork','studio-art-choice',[['studio','Studio pixel art'],['classic','Original artwork']],prefs.art,v=>{prefs={...prefs,art:v};});
  select('Wall decorations','studio-season-choice',[['none','None'],['autumn','Autumn'],['winter','Winter']],prefs.season,v=>{prefs={...prefs,season:v};});
  for(let i=0;i<2;i++) select(i?'Second companion look':'First companion look',`studio-pet-${i}`,PET_NAMES.map((name,n)=>[n,name]),prefs.pets[i],v=>{const pets=[...prefs.pets];pets[i]=Number(v);prefs={...prefs,pets};});
  section.append(Object.assign(document.createElement('p'),{className:'h',textContent:'Companion looks use the existing two pet slots. The second slot still requires its existing unlock. Seasonal wall art is decorative.'}));
  const settingsBody=document.querySelector('#sheet-settings .sheet-body')||document.querySelector('#sheet-settings');
  settingsBody?.append(section);

  // The existing notice manager owns timers and the three-notice cap. A focused
  // notice used to survive forever after expiry; resume its lifetime on blur.
  const toasts=document.getElementById('toast');
  function onNoticeBlur(event) {
    const notice=event.target.closest('.toast');if(!notice) return;
    clearTimeout(toastTimers.get(notice));
    toastTimers.set(notice,setTimeout(()=>{if(!notice.contains(document.activeElement)) notice.remove();},4500));
  }
  toasts?.addEventListener('focusout',onNoticeBlur);
  async function load() {
    try {
      const response=await fetch('assets/sprites/studio/studio.json',{signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error('Studio manifest unavailable');
      const manifest=await response.json();if(!validManifest(manifest)) throw new Error('Invalid studio atlas');
      // Eight independently cacheable PNG tiles form one validated native atlas.
      // URLs are fixed, never supplied by agent events or user preferences.
      if(manifest.width!==512 || manifest.height!==323) throw new Error('Unsupported studio layout');
      const pages=await Promise.all(Array.from({length:8},(_,i)=>new Promise((resolve,reject)=>{
        const im=new Image();const timer=setTimeout(()=>done(new Error('Studio image timed out')),5000);
        function done(error){clearTimeout(timer);im.onload=im.onerror=null;if(error){im.removeAttribute('src');reject(error);}else resolve(im);}
        im.onload=()=>done();im.onerror=()=>done(new Error('Studio image unavailable'));im.src=`assets/sprites/studio/studio-${i}.png`;
      })));
      const atlas=document.createElement('canvas');atlas.width=512;atlas.height=323;
      const context=atlas.getContext('2d',{willReadFrequently:true});context.imageSmoothingEnabled=false;
      for(let i=0;i<pages.length;i++) {
        if(pages[i].naturalWidth!==512 || pages[i].naturalHeight!==(i===7?43:40)) throw new Error('Studio image dimensions differ');
        context.drawImage(pages[i],0,i*40);
      }
      if(root.crypto?.subtle && typeof manifest.rgbaSha256==='string') {
        const bytes=context.getImageData(0,0,512,323).data;
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
        if(hash!==manifest.rgbaSha256) throw new Error('Studio pixels failed integrity check');
      }
      const sprites=new Map();
      for(const [key,e] of Object.entries(manifest.entries)) {
        const c=document.createElement('canvas');[c.width,c.height]=e.rect.slice(2);const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(atlas,...e.rect,0,0,c.width,c.height);sprites.set(key,c);
      }
      // Two additional human finishes keep the original six-person preference
      // slots human; robot/courier remain explicit alternate appearances.
      for(const [id,finish] of [[6,'rose'],[7,'moss']]) for(const pose of POSES) {
        const source=sprites.get(`person-3-${pose}`),c=document.createElement('canvas');c.width=32;c.height=36;
        const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0);
        const pixels=g.getImageData(0,0,32,36),d=pixels.data;
        for(let i=0;i<d.length;i+=4) {
          const r=d[i],green=d[i+1],b=d[i+2];
          if(d[i+3] && b>60 && b>r*1.4 && b>green*1.1) {
            if(finish==='rose'){d[i]=Math.round(b*.85);d[i+1]=Math.round(green*.65);d[i+2]=Math.round(b*.55);}
            else {d[i]=Math.round(b*.46);d[i+1]=Math.round(b*.75);d[i+2]=Math.round(b*.5);}
          }
        }
        g.putImageData(pixels,0,0);sprites.set(`person-${id}-${pose}`,c);
      }
      art.sprites=sprites;art.ready=true;art.source='studio';art.manifest=manifest;
      status.textContent='Studio sprites ready. Viewing choices stay on this browser.';redraw();
    } catch(error) {
      art.source='fallback';art.error=error.message;status.textContent='Using original artwork. Studio sprites could not load.';
      redraw();
    }
    scene.studioArtSource=art.source;
    document.dispatchEvent(new Event('agent-office:studio-ready'));
  }
  load();
})(typeof globalThis === 'object' ? globalThis : this);
