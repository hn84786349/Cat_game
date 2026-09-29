/* ---- ../config/game.config.js ---- */
'use strict';
/* 遊戲設定:所有可調參數集中在這裡,不要散落在程式中 */
const GAME_CONFIG={
  camera:{
    yawFixed:true,        // 水平角度固定,只能拉近拉遠
    pitchMax:60,          // 鏡頭最遠時的俯角(度)
    pitchMin:8,           // 鏡頭最近時的俯角(度),接近平視
    curve:1.0,            // 距離→俯角的曲線指數,1=線性,>1 遠處變化較慢
    // 距離用 0~1 表示:0=最近(剛好框住貓全身),1=最遠(看到整個場景)
  },
  cat:{
    // 貓只有兩組圖:大部分距離用高俯角組,拉到最近才換近距離組
    spritePitch:{high:30,close:6},
    closeUp:{switchAt:0.15,fade:0.06},   // 距離 < switchAt 切到近距離組,fade 為淡入淡出範圍
    scale:{near:2.2,far:0.9},            // 貓在畫面上的縮放:近大遠小
    coats:['orange','cream','gray','black','white','tuxedo','calico'],
  },
  view:{
    baseScale:1.6,        // 世界單位 → 螢幕像素的基本倍率(再乘上貓的縮放曲線)
    perspective:0.0015,   // 預設的深度透視強度;場景可用自己的 kp 覆寫
  },
  scene:{
    // 場景是可替換的資料;每個場景宣告自己的「可放置點」,裝飾物宣告自己能放在哪種點
    types:['indoor','outdoor'],
    slotTypes:{
      indoor:['floor','wall_mount','wall_window','wall_hang'],
      outdoor:['ground','tree_platform'],
    },
    indoorWalls:['back','left','right'],   // 室內只有後牆和左右牆,靠鏡頭側開放
  },
};

/* ---- ../engine/camera.js ---- */
'use strict';
/* 鏡頭規則:距離 t(0=最近,1=最遠)決定俯角、貓的縮放與貓圖組 */
const CameraRules={
  clamp01:v=>Math.min(1,Math.max(0,v)),
  /** 距離 → 場景俯角(度):越近俯角越低 */
  pitchForDistance(t,cfg=GAME_CONFIG.camera){
    const k=Math.pow(CameraRules.clamp01(t),cfg.curve);
    return cfg.pitchMin+(cfg.pitchMax-cfg.pitchMin)*k;
  },
  /** 距離 → 貓圖組權重:近距離組 close、高俯角組 high,兩者相加為 1 */
  catSprite(t,cfg=GAME_CONFIG.cat){
    const{switchAt:a,fade:f}=cfg.closeUp;
    const close=CameraRules.clamp01((a+f/2-t)/f);
    return{close,high:1-close};
  },
  /** 距離 → 貓在畫面上的縮放 */
  catScale(t,cfg=GAME_CONFIG.cat){
    const k=CameraRules.clamp01(t);
    return cfg.scale.near+(cfg.scale.far-cfg.scale.near)*k;
  },
};

/* ---- ../engine/projection.js ---- */
'use strict';
/* 檢視(鏡頭)與投影。世界座標:x=左右,z=高度,d=深度(往鏡頭為正)。
   水平角固定,只有距離 t(0=最近,1=最遠)會改變俯角與縮放。 */
const View={
  create(W,H){
    const v={W,H,kp:GAME_CONFIG.view.perspective,x:0,d:0,t:1};
    View.update(v,1,{x:0,d:0});
    return v;
  },
  /** t=距離,focus=鏡頭對準的世界位置,kp=場景的透視強度(選填) */
  update(v,t,focus,kp){
    v.t=t;v.pitch=CameraRules.pitchForDistance(t);
    const r=v.pitch*Math.PI/180;v.cs=Math.cos(r);v.sn=Math.sin(r);
    v.sc=CameraRules.catScale(t)*GAME_CONFIG.view.baseScale;
    v.x=focus.x;v.d=focus.d;if(kp!==undefined)v.kp=kp;
    v.oy=v.H*(0.56+0.16*(1-t));   // 遠景時整個場景置中,近景時貓落在畫面下方
  },
  /** 深度透視:比鏡頭焦點近的東西較大,較遠的較小 */
  f(v,d){return Math.max(.35,1+(d-v.d)*v.kp);},
  /** 世界 → 螢幕 */
  P(v,x,z,d){
    const f=View.f(v,d);
    return[v.W/2+(x-v.x)*v.sc*f,v.oy+(-z*v.cs+(d-v.d)*v.sn)*v.sc*f];
  },
  /** 螢幕 → 地面(z=0)的世界座標 */
  unproject(v,sx,sy){
    let d=v.d;
    for(let i=0;i<10;i++)d=v.d+(sy-v.oy)/(v.sc*View.f(v,d)*v.sn);
    return{x:v.x+(sx-v.W/2)/(v.sc*View.f(v,d)),d};
  },
};

/* ---- ../engine/catAgent.js ---- */
'use strict';
/* 貓的行為(只有邏輯,不含繪製):走到目標點、閒置時坐下、可選擇自動漫遊 */
const CatAgent={
  create(scene){
    return{x:scene.spawn.x,d:scene.spawn.d,dir:'down',act:'sit',tx:null,td:null,idle:1.5,speed:55,auto:true,t:0};
  },
  clampToBounds(scene,x,d){
    const b=scene.bounds;
    return{x:Math.min(b.x1,Math.max(b.x0,x)),d:Math.min(b.d1,Math.max(b.d0,d))};
  },
  goTo(a,scene,x,d){
    const p=CatAgent.clampToBounds(scene,x,d);
    a.tx=p.x;a.td=p.d;a.act='walk';
  },
  /** 依移動向量決定朝向 */
  dirOf(dx,dd){
    return Math.abs(dx)>=Math.abs(dd)*1.2?(dx<0?'left':'right'):(dd<0?'up':'down');
  },
  update(a,scene,dt){
    a.t+=dt;
    if(a.tx!==null){
      const dx=a.tx-a.x,dd=a.td-a.d,dist=Math.hypot(dx,dd);
      if(dist<2){a.tx=null;a.act='sit';a.idle=2+Math.random()*3;return;}
      const st=Math.min(dist,a.speed*dt);
      a.x+=dx/dist*st;a.d+=dd/dist*st;a.dir=CatAgent.dirOf(dx,dd);a.act='walk';
    }else if(a.auto){
      a.idle-=dt;
      if(a.idle<=0){
        const b=scene.bounds;
        CatAgent.goTo(a,scene,b.x0+Math.random()*(b.x1-b.x0),b.d0+Math.random()*(b.d1-b.d0));
      }
    }
  },
};

/* ---- ../cat/core.js ---- */

'use strict';
/* 低多邊形繪圖工具:三色漸層、三角面明暗、六角形眼睛 */
let BL=1;                       // 眨眼(0.15=閉眼,1=睜眼)
const PAL={o:null,w:null};      // 目前花色的身體色 / 白色部位色
let STRIPE='rgba(0,0,0,0)';     // 目前花色的條紋色
let COAT=null;

function setCoat(c){
  COAT=c;PAL.o=c.o.slice();PAL.w=c.w.slice();
  STRIPE=c.stripe||'rgba(0,0,0,0)';
}
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

function path(c,pts){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}

/* 三花等花色的色塊:只畫在夠大的身體/頭部多邊形上,位置由多邊形形狀決定,動畫時不會閃 */
function patchFill(c,x0,y0,x1,y1,n){
  const r=rng((Math.round(x0)*73856093)^(Math.round(y0)*19349663)^(Math.round(x1-x0)*83492791)^n);
  const w=x1-x0,h=y1-y0;
  COAT.patches.forEach(pt=>{
    for(let i=0;i<pt.n;i++){
      const cx=x0+w*(.15+.7*r()),cy=y0+h*(.15+.7*r()),rad=pt.size*Math.min(w,h)*(.7+.6*r());
      const q=[];for(let k=0;k<7;k++){const a=Math.PI*2*k/7+r();const rr=rad*(.75+.5*r());q.push([cx+Math.cos(a)*rr,cy+Math.sin(a)*rr]);}
      c.fillStyle=pt.col;path(c,q);c.fill();
    }
  });
}

function poly(c,pts,pal,o={}){
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const g=c.createLinearGradient(0,y0,0,y1);g.addColorStop(0,pal[0]);g.addColorStop(.5,pal[1]);g.addColorStop(1,pal[2]);
  c.save();path(c,pts);c.clip();
  c.fillStyle=g;c.fillRect(x0-2,y0-2,x1-x0+4,y1-y0+4);
  if(pal===PAL.o&&COAT&&COAT.patches&&(x1-x0)*(y1-y0)>800)patchFill(c,x0,y0,x1,y1,pts.length);
  if(o.deco)o.deco(c);
  const n=pts.length,cx=xs.reduce((a,b)=>a+b)/n,cy=ys.reduce((a,b)=>a+b)/n;
  for(let i=0;!o.noFacet&&i<n;i++){
    const a=pts[i],b=pts[(i+1)%n];
    let mx=(a[0]+b[0])/2-cx,my=(a[1]+b[1])/2-cy;const l=Math.hypot(mx,my)||1;mx/=l;my/=l;
    const k=(mx*-.5+my*-.85)-.05;
    c.fillStyle=k>0?`rgba(255,255,255,${Math.min(.22,k*.4)})`:`rgba(20,10,30,${Math.min(.22,-k*.3)})`;
    c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.lineTo(cx,cy);c.closePath();c.fill();
  }
  if(o.dark){c.fillStyle=`rgba(20,10,30,${o.dark})`;c.fillRect(x0-2,y0-2,x1-x0+4,y1-y0+4);}
  c.restore();
}
function tri(c,pts,col){c.fillStyle=col;path(c,pts);c.fill();}

function ribbon(c,cl,w0,w1,stripes=[],pal=PAL.o){
  const n=cl.length,L=[],R=[];
  for(let i=0;i<n;i++){
    const p=cl[i],a=cl[Math.max(0,i-1)],b=cl[Math.min(n-1,i+1)];
    let tx=b[0]-a[0],ty=b[1]-a[1];const l=Math.hypot(tx,ty)||1;tx/=l;ty/=l;
    const w=(w0+(w1-w0)*i/(n-1))/2;
    L.push([p[0]-ty*w,p[1]+tx*w]);R.push([p[0]+ty*w,p[1]-tx*w]);
  }
  poly(c,L.concat(R.slice().reverse()),pal,{deco:c=>{stripes.forEach(i=>{if(i+1<n)tri(c,[L[i],L[i+1],R[i+1],R[i]],STRIPE);});}});
}
function eye(c,x,y,r){
  c.fillStyle=COAT.eye||'#1a1210';c.beginPath();
  for(let i=0;i<6;i++){const a=Math.PI/6+i*Math.PI/3;c.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r*BL);}
  c.closePath();c.fill();
  if(BL>.5){c.fillStyle='rgba(255,255,255,.8)';c.beginPath();c.arc(x+r*.3,y-r*.35,r*.3,0,7);c.fill();}
}
function whisk(c,x,y,dx){
  c.strokeStyle='rgba(255,255,255,.85)';c.lineWidth=.9;c.lineCap='round';
  [[16,-4],[17,1],[15,6]].forEach(([a,b])=>{c.beginPath();c.moveTo(x,y);c.lineTo(x+dx*a,y+b);c.stroke();});
}
function leg(c,x,yt,sw,lift,wt,wb,toe=0,dark=0){
  const px=x+sw;
  poly(c,[[x-wt,yt],[x+wt,yt],[px+wb,-5-lift],[px-wb,-5-lift]],PAL.o,{dark});
  poly(c,[[px-wb-1,-6-lift],[px+wb+1+toe,-6-lift],[px+wb+2+toe,-lift],[px-wb-1,-lift]],PAL.w,{dark});
}

/* ---- ../cat/coats.js ---- */

'use strict';
/* 花色定義:o=身體三階色(上/中/下),w=白色部位(腳掌、胸口、口鼻),stripe=條紋色,eye=眼睛顏色,patches=色塊 */
const COATS={
  orange:{name:'橘虎斑',o:['#c85a10','#f28a2c','#ffc98a'],w:['#e5d6c2','#fff6e8','#ffffff'],stripe:'#a8480c'},
  cream:{name:'奶油橘',o:['#dc9a58','#f7c88a','#ffe6c4'],w:['#f0e2cc','#fff9ee','#ffffff'],stripe:'#cf8a48'},
  gray:{name:'灰虎斑',o:['#666b7a','#9aa0ae','#cdd1dc'],w:['#dcdee6','#f4f5f8','#ffffff'],stripe:'#484c5c',eye:'#d9a81c'},
  black:{name:'黑貓',o:['#15151c','#2c2c38','#4a4a5a'],w:['#15151c','#2c2c38','#4a4a5a'],stripe:null,eye:'#f2c230'},
  white:{name:'白貓',o:['#d8d1c8','#f6f1ea','#ffffff'],w:['#e8e2da','#faf7f2','#ffffff'],stripe:null,eye:'#3e92d8'},
  tuxedo:{name:'賓士',o:['#15151c','#2c2c38','#4a4a5a'],w:['#e5d6c2','#fff6e8','#ffffff'],stripe:null,eye:'#f2c230'},
  calico:{name:'三花',o:['#ddd6cd','#faf6f0','#ffffff'],w:['#e8e2da','#fbf8f3','#ffffff'],stripe:null,
    patches:[{col:'#e07a1a',n:3,size:.34},{col:'#24242c',n:2,size:.28}]},
};

/* ---- ../cat/proj.js ---- */

'use strict';
/* 簡易正交投影:x=左右,z=高度,d=深度(往鏡頭為正),p=俯角(度) */
function mkP(p){
  const r=p*Math.PI/180,cs=Math.cos(r),sn=Math.sin(r);
  return{cs,sn,Y:(z,d=0)=>-z*cs+d*sn,P:(x,z,d=0)=>[x,-z*cs+d*sn]};
}
/* 橢球在正交投影下的輪廓(橢圓,用 12 邊形表示) */
function ellip(c,J,cx,cz,cd,ax,az,ad,pal,o={}){
  const b=Math.hypot(az*J.cs,ad*J.sn),cy=J.Y(cz,cd),pts=[];
  for(let i=0;i<12;i++){const a=Math.PI*2*i/12+Math.PI/12;pts.push([cx+Math.cos(a)*ax,cy+Math.sin(a)*b]);}
  poly(c,pts,pal,{dark:o.dark,deco:o.deco?(cc=>o.deco(cc,cy,b)):null});
  return{cy,b};
}
/* 依深度由遠到近繪製 */
function paint(items){items.sort((a,b)=>a.k-b.k).forEach(i=>i.fn());}
function legAt(c,J,x,d,sw,lift,wt,wb,toe,dark,hz){
  c.save();c.translate(0,d*J.sn);leg(c,x,-hz*J.cs,sw,lift,wt,wb,toe,dark);c.restore();
}

/* ---- ../cat/head.js ---- */
'use strict';
/* 頭部:正面、背面、隨俯角變化的側面 */
const HEADPTS=cy=>[[-26,cy],[-23,cy-14],[-10,cy-22],[10,cy-22],[23,cy-14],[26,cy],[19,cy+13],[0,cy+18],[-19,cy+13]];
function headFront(c,cy){
  [-1,1].forEach(s=>{
    poly(c,[[s*25,cy-6],[s*24,cy-30],[s*8,cy-20]],PAL.o);
    tri(c,[[s*21,cy-9],[s*21,cy-24],[s*11,cy-18]],'#ff9fb5');
  });
  poly(c,HEADPTS(cy),PAL.o,{deco:c=>{
    tri(c,[[-3,cy-23],[3,cy-23],[0,cy-11]],STRIPE);
    [-1,1].forEach(s=>{tri(c,[[s*11,cy-22],[s*7,cy-22],[s*9,cy-12]],STRIPE);tri(c,[[s*27,cy],[s*20,cy-4],[s*24,cy+8]],STRIPE);});
  }});
  poly(c,[[-10,cy+4],[0,cy+1],[10,cy+4],[8,cy+13],[0,cy+17],[-8,cy+13]],PAL.w);
  eye(c,-11,cy-2,4.2);eye(c,11,cy-2,4.2);
  tri(c,[[-3,cy+3],[3,cy+3],[0,cy+7]],'#ff7a98');
  c.strokeStyle='#8a4a30';c.lineWidth=.9;c.lineCap='round';
  c.beginPath();c.moveTo(0,cy+7);c.lineTo(0,cy+10);c.moveTo(-4,cy+12);c.lineTo(0,cy+10);c.lineTo(4,cy+12);c.stroke();
  whisk(c,-9,cy+7,-1.3);whisk(c,9,cy+7,1.3);
}
function headBack(c,cy){
  [-1,1].forEach(s=>{
    poly(c,[[s*25,cy-6],[s*24,cy-30],[s*8,cy-20]],PAL.o,{deco:c=>tri(c,[[s*22,cy-10],[s*22,cy-27],[s*13,cy-19]],STRIPE)});
  });
  poly(c,HEADPTS(cy),PAL.o,{deco:c=>{
    [-14,-5,4,13].forEach(x=>tri(c,[[x,cy-23],[x+5,cy-23],[x+2.5,cy-8]],STRIPE));
  }});
}


/* ---- 隨俯角變化的頭:x 朝前、z 向上、d 往鏡頭 ---- */
function headSide3D(c,p){
  const r=p*Math.PI/180,cs=Math.cos(r),sn=Math.sin(r);
  const Y=(z,d=0)=>-z*cs+d*sn;
  const P=(x,z,d=0)=>[x,Y(z,d)];
  const ez=1+.5*sn;
  // 遠側耳朵(高俯角時會被推到頭頂上方)
  poly(c,[P(-6,11,-9),P(9,12,-8),P(3,11+16*ez,-8)],PAL.o,{dark:.12});
  // 頭部輪廓:橢球投影
  const b=Math.hypot(15*cs,15*sn),pts=[];
  for(let i=0;i<12;i++){const a=Math.PI*2*i/12+Math.PI/12;pts.push([Math.cos(a)*(Math.cos(a)>0?21:19),Math.sin(a)*b]);}
  const sl=4+6*sn;
  poly(c,pts,PAL.o,{deco:c=>{
    // 頭頂花紋:俯角越高,頭頂露出得越多
    [-8,0,8].forEach(x=>tri(c,[[x-2.5,-b-2],[x+2.5,-b-2],[x+.5,-b+sl]],STRIPE));
    tri(c,[[-19,Y(2,10)-3],[-9,Y(2,10)-5],[-15,Y(2,10)+4]],STRIPE);
  }});
  // 口鼻
  poly(c,[P(12,-1,4),P(23,-2,2),P(24,-7,1),P(16,-10,3)],PAL.w);
  tri(c,[P(22,-2,1),P(26,-3,0),P(23,-5.5,0)],'#ff7a98');
  // 近側耳朵
  poly(c,[P(-14,10,9),P(1,12,8),P(-10,10+17*ez,8)],PAL.o);
  tri(c,[P(-11,13,9.5),P(-2,14,9),P(-9,12+11*ez,9)],'#ff9fb5');
  // 眼睛(在近側面上,俯角越高越往下移)
  const e=P(9,4,10);eye(c,e[0],e[1],3.6);
  // 鬍鬚
  const w=P(17,-4,6);c.strokeStyle='rgba(255,255,255,.9)';c.lineWidth=.9;c.lineCap='round';
  [[-10,-3],[-12,0],[-9,3]].forEach(([dx,dy])=>{c.beginPath();c.moveTo(w[0],w[1]);c.lineTo(w[0]+dx,w[1]+dy+4*sn);c.stroke();});
}


/* ---- ../cat/walk_side.js ---- */
'use strict';
/* 側面走路(朝右;朝左由鏡像產生) */
/* ---- 真投影版側面走路:p=俯角(度)。3D 座標 x 前後、z 高度、d 深度(往鏡頭為正) ---- */
function catSide3D(c,ph,tw,p){
  const r=p*Math.PI/180,cs=Math.cos(r),sn=Math.sin(r);
  const Y=(z,d=0)=>-z*cs+d*sn;
  c.translate(0,-Math.abs(Math.sin(ph))*1.2*cs);
  const A=q=>Math.sin(ph+q)*7,Lf=q=>Math.max(0,Math.cos(ph+q))*5*cs;
  const HZ=(20+6*sn)*cs+2*sn;
  const legAt=(x,d,q,dark)=>{c.save();c.translate(0,d*sn);leg(c,x,-HZ,A(q),Lf(q),5,4.2,3,dark);c.restore();};
  // 尾巴(d=0)
  const T=[[-32,30],[-44,32],[-52,42],[-50,56]].map(([x,z],i)=>[x+Math.sin(i*1.3+tw)*i*1.2,Y(z)]);
  ribbon(c,T,8,4.5,[2]);
  // 遠側兩腿
  legAt(19,-7,Math.PI,.25);legAt(-20,-7,0,.25);
  // 身體:橢球在正交投影下的輪廓
  const cy=Y(30),b=Math.hypot(17*cs,15*sn),pts=[];
  for(let i=0;i<12;i++){const a=Math.PI*2*i/12+Math.PI/12;pts.push([Math.cos(a)*(Math.cos(a)<0?35:32),cy+Math.sin(a)*b]);}
  const sl=.55+.45*sn;
  poly(c,pts,PAL.o,{deco:c=>{
    [-22,-12,-2,8,18].forEach(x=>tri(c,[[x,cy-b-2],[x+7,cy-b-2],[x+3,cy-b+2*b*sl],[x-3,cy-b+2*b*sl]],STRIPE));
  }});
  poly(c,[[15,cy+b*.05],[30,cy-b*.15],[29,cy+b*.55],[19,cy+b*.85]],PAL.w);
  // 近側兩腿
  legAt(19,7,0,0);legAt(-20,7,Math.PI,0);
  // 脖子(讓頭和身體相連)+頭
  const hx=36,hy=Y(40);
  ribbon(c,[[16,cy-b*.25],[26,(cy+hy)/2],[hx,hy+2]],26,18);
  c.save();c.translate(hx,hy);c.rotate(.3*sn);c.scale(1.12,1.12);headSide3D(c,p);c.restore();
}


/* ---- ../cat/walk_fb.js ---- */
'use strict';
/* 正面(f=1,面向鏡頭)/背面(f=-1,背對鏡頭)走路 */
function walkFB(c,ph,tw,p,f){
  const J=mkP(p),{cs,sn,Y,P}=J,items=[];
  c.translate(0,-Math.abs(Math.sin(ph))*1.2*cs);
  const add=(k,fn)=>items.push({k,fn});
  // 尾巴:從臀部翹起(背面時在鏡頭這一側,最後才畫)
  add(f>0?-30:16,()=>{
    const T=[[8,30,-f*24],[18,38,-f*28],[26,50,-f*28],[26,63,-f*26]].map(([x,z,d],i)=>[x+Math.sin(i*1.2+tw)*i*1.5,Y(z,d)]);
    ribbon(c,T,8,4.5,[2,3]);
  });
  // 四條腿:對角一起動
  [[-11,f*13,0],[11,f*13,Math.PI],[-11,-f*14,Math.PI],[11,-f*14,0]].forEach(([x,d,q])=>{
    const de=d+Math.cos(ph+q)*4*f, lift=Math.max(0,Math.sin(ph+q))*5*cs;
    add(de,()=>legAt(c,J,x,de,0,lift,5.5,4.6,0,de<0?.15:0,20));
  });
  // 身體
  add(0,()=>ellip(c,J,0,29,0,20,17,22,PAL.o,{deco:(cc,cy,b)=>{
    [-14,-6,2,10].forEach(dk=>{
      const y=Y(42,dk);
      tri(cc,[[-26,Y(28,dk)],[-18,y],[18,y],[26,Y(28,dk)],[26,Y(28,dk)+3.5],[18,y+3.5],[-18,y+3.5],[-26,Y(28,dk)+3.5]],STRIPE);
    });
  }}));
  if(f>0)add(1,()=>poly(c,[P(-9,34,16),P(9,34,16),P(7,18,20),P(-7,18,20)],PAL.w));
  // 脖子與頭
  add(9,()=>ribbon(c,[P(0,38,f*8),P(0,48,f*16)],26,19));
  add(10,()=>{
    const h=P(0,50,f*17);c.save();c.translate(h[0],h[1]);c.scale(.8,.8);
    if(f>0)headFront(c,0);else headBack(c,0);
    c.restore();
  });
  paint(items);
}

/* ---- ../cat/sit.js ---- */
'use strict';
/* 坐姿:側面(朝右)、正面、背面 */
function sitSide(c,tw,p){
  const J=mkP(p),{cs,sn,Y,P}=J,items=[];
  const add=(k,fn)=>items.push({k,fn});
  const frontLeg=(d,dark)=>{
    poly(c,[P(8,34,d),P(18,34,d),P(19,4,d),P(9,4,d)],PAL.o,{dark});
    poly(c,[P(8,5,d),P(23,5,d),P(25,0,d),P(8,0,d)],PAL.w,{dark});
  };
  const haunch=(d,dark)=>{
    ellip(c,J,-9,10,d,14,10,9,PAL.o,{dark,deco:(cc,cy,b)=>{tri(cc,[[-20,cy-b],[-12,cy-b],[-15,cy+b*.3]],STRIPE);tri(cc,[[-6,cy-b],[0,cy-b],[-3,cy+b*.2]],STRIPE);}});
    poly(c,[P(-4,2,d),P(10,2,d),P(13,0,d),P(-4,0,d)],PAL.w,{dark});
  };
  add(-20,()=>{
    const T=[[-14,3,-2],[-28,2,2],[-38,4,-2],[-42,12,-4+Math.sin(tw)*2]].map(([x,z,d])=>[x,Y(z,d)]);
    ribbon(c,T,8,5,[2,3]);
  });
  add(-6,()=>frontLeg(-5,.2));
  add(-9,()=>haunch(-9,.2));
  add(0,()=>ellip(c,J,-2,30,0,13,22,13,PAL.o,{deco:(cc,cy,b)=>{
    [-9,-2,5].forEach(x=>tri(cc,[[x,cy-b-2],[x+6,cy-b-2],[x+3,cy-b*.2],[x-3,cy-b*.2]],STRIPE));
  }}));
  add(1,()=>poly(c,[P(6,42,4),P(14,36,3),P(14,18,3),P(8,18,4)],PAL.w));
  add(9,()=>haunch(9,0));
  add(5,()=>frontLeg(5,0));
  add(10,()=>ribbon(c,[P(2,44,0),P(8,52,0)],24,18));
  add(11,()=>{const h=P(8,54,0);c.save();c.translate(h[0],h[1]);c.rotate(.3*sn);c.scale(1.12,1.12);headSide3D(c,p);c.restore();});
  paint(items);
}
function sitFB(c,tw,p,f){
  const J=mkP(p),{cs,sn,Y,P}=J,items=[];
  const add=(k,fn)=>items.push({k,fn});
  add(f>0?-12:15,()=>{
    const dl=f>0?[-10,-6,2,6]:[10,14,8,2],xl=[8,20,28,31],zl=[3,2,3,10+Math.sin(tw)*2];
    ribbon(c,xl.map((x,i)=>[x,Y(zl[i],dl[i])]),8,5,[1,2]);
  });
  add(0,()=>ellip(c,J,0,26,-2,17,22,13,PAL.o,{deco:(cc,cy,b)=>{
    if(f<0)[-14,-6,2,10].forEach(dk=>{const y=Y(42,dk);tri(cc,[[-20,y+8],[-13,y],[13,y],[20,y+8],[20,y+11],[13,y+3],[-13,y+3],[-20,y+11]],STRIPE);});
    else[-1,1].forEach(s=>[cy-b*.5,cy-b*.1].forEach(y=>tri(cc,[[s*17,y],[s*10,y+2],[s*17,y+6]],STRIPE)));
  }}));
  if(f>0)add(2,()=>poly(c,[P(-6,40,8),P(6,40,8),P(5,20,10),P(-5,20,10)],PAL.w));
  add(1,()=>[-1,1].forEach(s=>{
    ellip(c,J,s*16,9,-3,10,9,11,PAL.o,{dark:.06,deco:(cc,cy,b)=>tri(cc,[[s*20,cy-b*.6],[s*12,cy-b*.6],[s*18,cy+b*.2]],STRIPE)});
  }));
  add(1.5,()=>[-1,1].forEach(s=>{
    const y=Y(1.5,f>0?2:8);
    poly(c,[[s*17-6,y-3],[s*17+6,y-3],[s*17+7,y+1.5],[s*17-7,y+1.5]],PAL.w);
  }));
  if(f>0)add(3,()=>[-1,1].forEach(s=>{
    poly(c,[P(s*6-4,34,6),P(s*6+4,34,6),P(s*6+4.5,4,6),P(s*6-4.5,4,6)],PAL.o);
    poly(c,[P(s*6-5,5,6),P(s*6+5,5,6),P(s*6+6,0,6),P(s*6-6,0,6)],PAL.w);
  }));
  add(9,()=>ribbon(c,[P(0,44,0),P(0,52,f*3)],24,19));
  add(10,()=>{const h=P(0,52,f*3);c.save();c.translate(h[0],h[1]);c.scale(.85,.85);if(f>0)headFront(c,0);else headBack(c,0);c.restore();});
  paint(items);
}

/* ---- ../cat/cat.js ---- */
'use strict';
/* 貓咪動作總入口
   drawCat(c,{dir,act,pitch,t,coat}):在 (0,0)=腳底中心 繪製
   dir: 'left'|'right'|'up'|'down'  act: 'walk'|'sit'  pitch: 30(高俯角)|6(近距離) */
const CAT_POSES=[
  {dir:'left',act:'walk'},{dir:'right',act:'walk'},{dir:'up',act:'walk'},{dir:'down',act:'walk'},
  {dir:'left',act:'sit'},{dir:'right',act:'sit'},{dir:'up',act:'sit'},{dir:'down',act:'sit'},
];
const CAT_LABEL={left:'左',right:'右',up:'背對',down:'面對'};
function drawCat(c,o){
  const {dir,act,pitch,t=0}=o;
  if(o.coat)setCoat(COATS[o.coat]);
  c.save();
  const ph=t*6,tw=t*3;
  if(dir==='left'||dir==='right'){
    if(dir==='left')c.scale(-1,1);
    if(act==='walk'){c.translate(-3,0);catSide3D(c,ph,tw,pitch);}
    else{c.translate(7,0);sitSide(c,t*2.5,pitch);}
  }else{
    const f=dir==='down'?1:-1;
    if(act==='walk')walkFB(c,ph,tw,pitch,f);else sitFB(c,t*2.5,pitch,f);
  }
  c.restore();
}

/* ---- ../scenes/registry.js ---- */
'use strict';
/* 場景與裝飾物的登記處。
   場景 = 資料:room/bounds/spawn/slots(可放置點)/decor(裝飾物清單)+ 繪製函式
   裝飾物 = DECOR[kind]:{layer:'floor'|'wall'|'prop', slotType?, depth?(item), draw(c,v,item)}
   裝飾物可用 slot 指定放在場景的哪個可放置點,slotType 限制它能放在哪種點。 */
const SCENES={};
const DECOR={};

/** 把裝飾物與它指定的可放置點合併成最終座標 */
function resolveDecor(scene){
  return scene.decor.map(it=>{
    const s=it.slot?scene.slots.find(x=>x.id===it.slot):null;
    return Object.assign({},s||{},it);
  });
}
/** 檢查場景資料是否正確,回傳錯誤訊息陣列(空陣列 = 沒問題) */
function validateScene(scene){
  const errs=[];
  scene.decor.forEach((it,i)=>{
    const def=DECOR[it.kind];
    if(!def){errs.push(`${scene.id}.decor[${i}]:未知的裝飾物 ${it.kind}`);return;}
    if(it.slot){
      const s=scene.slots.find(x=>x.id===it.slot);
      if(!s)errs.push(`${scene.id}.decor[${i}]:找不到可放置點 ${it.slot}`);
      else if(def.slotType&&def.slotType!==s.type)errs.push(`${scene.id}.decor[${i}]:${it.kind} 只能放在 ${def.slotType},但 ${s.id} 是 ${s.type}`);
    }
  });
  return errs;
}

/* ---- ../scenes/gfx.js ---- */
'use strict';
/* 場景繪圖小工具:用世界座標 (x,z,d) 畫低多邊形四邊形與方塊,沿用貓咪的三色漸層加三角面明暗 */
const SceneGfx={
  shade(hex,k){
    const n=parseInt(hex.slice(1),16),f=s=>Math.min(255,Math.max(0,Math.round(((n>>s)&255)*k)));
    return'#'+[16,8,0].map(s=>f(s).toString(16).padStart(2,'0')).join('');
  },
  pal(hex){return[SceneGfx.shade(hex,1.06),hex,SceneGfx.shade(hex,.9)];},
  scr(v,pts){return pts.map(([x,z,d])=>View.P(v,x,z,d));},
  quad(c,v,pts,pal,o){poly(c,SceneGfx.scr(v,pts),pal,o);},
  flat(c,v,pts,col){c.fillStyle=col;path(c,SceneGfx.scr(v,pts));c.fill();},
  /** 方塊:b={x0,x1,d0,d1,z0,z1};hex 為基本色。看得到的面依鏡頭位置決定 */
  box(c,v,b,hex,topHex){
    const S=SceneGfx,{x0,x1,d0,d1,z0,z1}=b;
    if(v.x<x0)S.quad(c,v,[[x0,z0,d0],[x0,z1,d0],[x0,z1,d1],[x0,z0,d1]],S.pal(S.shade(hex,.82)));
    if(v.x>x1)S.quad(c,v,[[x1,z0,d0],[x1,z1,d0],[x1,z1,d1],[x1,z0,d1]],S.pal(S.shade(hex,.82)));
    S.quad(c,v,[[x0,z0,d1],[x0,z1,d1],[x1,z1,d1],[x1,z0,d1]],S.pal(hex));
    S.quad(c,v,[[x0,z1,d0],[x1,z1,d0],[x1,z1,d1],[x0,z1,d1]],S.pal(topHex||S.shade(hex,1.15)));
  },
  ellipse(cx,cd,z,rx,rd,n=16){
    const pts=[];for(let i=0;i<n;i++){const a=Math.PI*2*i/n;pts.push([cx+Math.cos(a)*rx,z,cd+Math.sin(a)*rd]);}
    return pts;
  },
};

/* ---- ../scenes/decor.js ---- */
'use strict';
/* 裝飾物定義。新增裝飾物:在這裡加一筆 DECOR[kind],再放進場景的 decor 清單 */
(function(){
const S=SceneGfx;
DECOR.rug={layer:'floor',slotType:'floor',draw(c,v,it){
  S.quad(c,v,S.ellipse(it.x,it.d,.3,it.rx,it.rd),S.pal('#8c78c8'));
  S.quad(c,v,S.ellipse(it.x,it.d,.4,it.rx*.72,it.rd*.72),S.pal('#b9a6ee'));
  S.quad(c,v,S.ellipse(it.x,it.d,.5,it.rx*.4,it.rd*.4),S.pal('#e4d8ff'));
}};
DECOR.window={layer:'wall',slotType:'wall_window',draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2,z0=it.z,z1=it.z+it.h,d=it.d;
  S.quad(c,v,[[x0-5,z0-5,d],[x0-5,z1+5,d],[x1+5,z1+5,d],[x1+5,z0-5,d]],S.pal('#fff7ee'));
  S.quad(c,v,[[x0,z0,d],[x0,z1,d],[x1,z1,d],[x1,z0,d]],['#9bd8f6','#c4ecff','#eaf8ff']);
  S.flat(c,v,[[x0+it.w*.15,z0,d],[x0+it.w*.35,z0,d],[x0+it.w*.6,z1,d],[x0+it.w*.4,z1,d]],'rgba(255,255,255,.35)');
  const mx=it.x,mz=(z0+z1)/2;
  S.quad(c,v,[[mx-2,z0,d],[mx-2,z1,d],[mx+2,z1,d],[mx+2,z0,d]],S.pal('#fff7ee'));
  S.quad(c,v,[[x0,mz-2,d],[x0,mz+2,d],[x1,mz+2,d],[x1,mz-2,d]],S.pal('#fff7ee'));
  [[-1,x0-16,x0+10],[1,x1-10,x1+16]].forEach(([s,a,b])=>{
    S.quad(c,v,[[a,z0-8,d+1],[a,z1+12,d+1],[b,z1+12,d+1],[b,z0-8,d+1]],S.pal('#f29aa8'));
    S.flat(c,v,[[a+(b-a)*.35,z0-8,d+1.2],[a+(b-a)*.35,z1+12,d+1.2],[a+(b-a)*.5,z1+12,d+1.2],[a+(b-a)*.5,z0-8,d+1.2]],'rgba(120,30,60,.16)');
  });
  S.box(c,v,{x0:x0-10,x1:x1+10,d0:d,d1:d+9,z0:z0-10,z1:z0-5},'#fff7ee');
  // 窗外的光照在地板上
  S.flat(c,v,[[x0+8,0,d+6],[x1-8,0,d+6],[x1+40,0,d+90],[x0+40,0,d+90]],'rgba(255,250,210,.16)');
}};
DECOR.picture={layer:'wall',slotType:'wall_hang',draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2,z0=it.z,z1=it.z+it.h,d=it.d;
  S.quad(c,v,[[x0-4,z0-4,d],[x0-4,z1+4,d],[x1+4,z1+4,d],[x1+4,z0-4,d]],S.pal('#8a5a3a'));
  S.quad(c,v,[[x0,z0,d],[x0,z1,d],[x1,z1,d],[x1,z0,d]],['#a8dcc8','#c8ecd8','#e6f8ee']);
  S.quad(c,v,[[x0,z0,d+.5],[x0+it.w*.4,z0+it.h*.65,d+.5],[x0+it.w*.7,z0,d+.5]],S.pal('#6faa94'));
  S.quad(c,v,[[x0+it.w*.4,z0,d+.5],[x0+it.w*.75,z0+it.h*.5,d+.5],[x1,z0,d+.5]],S.pal('#4f8f7a'));
}};
DECOR.wallShelf={layer:'wall',slotType:'wall_mount',draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2;
  [[x0+6],[x1-14]].forEach(([bx])=>S.quad(c,v,[[bx,it.z-14,it.d],[bx,it.z,it.d],[bx+8,it.z,it.d+12],[bx+8,it.z-3,it.d+12]],S.pal('#8a6238')));
  S.box(c,v,{x0,x1,d0:it.d,d1:it.d+18,z0:it.z,z1:it.z+6},'#c08a52');
}};
DECOR.catBed={layer:'prop',slotType:'floor',depth:it=>it.d+it.dd/2,draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2,d0=it.d-it.dd/2,d1=it.d+it.dd/2;
  S.box(c,v,{x0,x1,d0,d1,z0:0,z1:14},'#ef8a7b');
  S.quad(c,v,[[x0+7,14.5,d0+7],[x1-7,14.5,d0+7],[x1-7,14.5,d1-7],[x0+7,14.5,d1-7]],S.pal('#ffdccb'));
  S.quad(c,v,S.ellipse(it.x,it.d,15,it.w*.22,it.dd*.22,8),S.pal('#ffeee2'));
}};
DECOR.bowls={layer:'prop',slotType:'floor',depth:it=>it.d+11,draw(c,v,it){
  [[-16,'#5aa6d6','#a6d8f0'],[16,'#e88fa8','#8b5a3a']].forEach(([ox,col,fill])=>{
    S.box(c,v,{x0:it.x+ox-11,x1:it.x+ox+11,d0:it.d-11,d1:it.d+11,z0:0,z1:9},col);
    S.quad(c,v,[[it.x+ox-8,9.5,it.d-8],[it.x+ox+8,9.5,it.d-8],[it.x+ox+8,9.5,it.d+8],[it.x+ox-8,9.5,it.d+8]],S.pal(fill));
  });
}};
DECOR.plant={layer:'prop',slotType:'floor',depth:it=>it.d+13,draw(c,v,it){
  S.box(c,v,{x0:it.x-13,x1:it.x+13,d0:it.d-13,d1:it.d+13,z0:0,z1:26},'#c9694a');
  const g=['#4fae5a','#63c46b','#3f9a4c','#78d47a'];
  [[-26,60],[-14,74],[0,84],[14,72],[26,58],[-6,66],[8,62]].forEach(([dx,h],i)=>{
    S.quad(c,v,[[it.x-5,26,it.d],[it.x+dx*.4,26+h*.55,it.d+(i%2?8:-8)],[it.x+5,26,it.d]],S.pal(g[i%4]));
    S.quad(c,v,[[it.x-6+dx*.15,26+h*.45,it.d],[it.x+dx,26+h,it.d+(i%2?6:-6)],[it.x+6+dx*.15,26+h*.45,it.d]],S.pal(g[(i+1)%4]));
  });
}};
/* ---- 室外 ---- */
DECOR.tuft={layer:'floor',draw(c,v,it){
  const a=View.P(v,it.x,0,it.d),k=v.sc*View.f(v,it.d);
  c.fillStyle=it.col;
  [[-3,-1,9],[0,0,13],[3,1,8]].forEach(([dx,sk,h])=>{
    c.beginPath();c.moveTo(a[0]+(dx-2)*k,a[1]);c.lineTo(a[0]+(dx+sk)*k,a[1]-h*k*v.cs);c.lineTo(a[0]+(dx+2)*k,a[1]);c.closePath();c.fill();
  });
}};
DECOR.flower={layer:'prop',depth:it=>it.d,draw(c,v,it){
  const b=View.P(v,it.x,0,it.d),k=v.sc*View.f(v,it.d),top=[b[0],b[1]-it.h*v.cs*k];
  c.strokeStyle='#3f9a4c';c.lineWidth=Math.max(1,1.4*k);c.beginPath();c.moveTo(b[0],b[1]);c.lineTo(top[0],top[1]);c.stroke();
  const r=4.4*k;c.fillStyle=it.col;c.beginPath();
  for(let i=0;i<10;i++){const a=Math.PI*2*i/10,rr=i%2?r*.55:r;c.lineTo(top[0]+Math.cos(a)*rr,top[1]+Math.sin(a)*rr*.85);}
  c.closePath();c.fill();
  c.fillStyle='#ffe066';c.beginPath();c.arc(top[0],top[1],r*.32,0,7);c.fill();
}};
DECOR.rock={layer:'prop',depth:it=>it.d+it.r*.5,draw(c,v,it){
  const b=View.P(v,it.x,0,it.d),k=v.sc*View.f(v,it.d),r=it.r*k,pts=[];
  for(let i=0;i<9;i++){const a=Math.PI*2*i/9,rr=r*(.8+.25*Math.sin(i*2.7+it.x));pts.push([b[0]+Math.cos(a)*rr*1.1,b[1]-r*.35+Math.sin(a)*rr*.62]);}
  poly(c,pts,['#b9bec6','#9aa1ab','#7f8792']);
}};
})();

/* ---- ../scenes/indoor.js ---- */
'use strict';
/* 室內:一般的小房間。只有後牆和左右牆,靠鏡頭那側開放。 */
(function(){
const S=SceneGfx;
const R={x0:-210,x1:210,d0:-150,d1:150,h:190};
let planks=null;
function buildPlanks(){
  const r=rng(11),out=[];
  for(let d=R.d0;d<R.d1;d+=30){
    let x=R.x0;
    while(x<R.x1){
      const len=90+r()*70,x1=Math.min(R.x1,x+len),k=.9+r()*.2;
      out.push({x0:x,x1,d0:d,d1:d+30,pal:S.pal(S.shade('#c99a63',k))});
      x=x1;
    }
  }
  return out;
}
SCENES.indoor={
  id:'indoor',name:'室內小房間',type:'indoor',kp:.0015,
  room:R,
  bounds:{x0:-150,x1:150,d0:-112,d1:125},   // 貓能走的範圍
  center:{x:0,d:0},spawn:{x:0,d:40},
  slots:[
    {id:'window1',type:'wall_window',x:-60,z:82,d:R.d0,w:84,h:80},
    {id:'picture1',type:'wall_hang',x:70,z:106,d:R.d0,w:52,h:40},
    {id:'shelf1',type:'wall_mount',x:100,z:64,d:R.d0},
    {id:'shelf2',type:'wall_mount',x:168,z:112,d:R.d0},
    {id:'rug1',type:'floor',x:-10,d:35},
    {id:'bed1',type:'floor',x:128,d:62},
    {id:'bowls1',type:'floor',x:-128,d:98},
    {id:'plant1',type:'floor',x:-176,d:-112},
  ],
  decor:[
    {kind:'window',slot:'window1'},
    {kind:'picture',slot:'picture1'},
    {kind:'wallShelf',slot:'shelf1',w:62},
    {kind:'wallShelf',slot:'shelf2',w:56},
    {kind:'rug',slot:'rug1',rx:120,rd:64},
    {kind:'catBed',slot:'bed1',w:64,dd:52},
    {kind:'bowls',slot:'bowls1'},
    {kind:'plant',slot:'plant1'},
  ],
  drawBase(c,v){
    c.fillStyle='#241c30';c.fillRect(0,0,v.W,v.H);
    if(!planks)planks=buildPlanks();
    // 房間前緣以外的區域:遠景時是背景色,拉近後逐漸接成地板色,避免下方出現空洞
    const yF=View.P(v,0,0,R.d1)[1];
    if(yF<v.H){c.fillStyle=v.t>.5?'#241c30':'#b48653';c.fillRect(0,yF,v.W,v.H-yF);}
    planks.forEach(p=>S.quad(c,v,[[p.x0,0,p.d0],[p.x1,0,p.d0],[p.x1,0,p.d1],[p.x0,0,p.d1]],p.pal));
  },
  drawWalls(c,v){
    const H=R.h,up=['#f7ded6','#f2d2c9','#ebc7bd'],low=['#eab8aa','#e4ad9f','#dda296'];
    const wall=(pts3,pal)=>S.quad(c,v,pts3,pal,{noFacet:true});
    // 後牆
    wall([[R.x0,58,R.d0],[R.x0,H,R.d0],[R.x1,H,R.d0],[R.x1,58,R.d0]],up);
    wall([[R.x0,8,R.d0],[R.x0,58,R.d0],[R.x1,58,R.d0],[R.x1,8,R.d0]],low);
    // 左右牆(比後牆略暗)
    [[R.x0,.93],[R.x1,.97]].forEach(([x,k])=>{
      const u=up.map(h=>S.shade(h,k)),l=low.map(h=>S.shade(h,k));
      wall([[x,58,R.d0],[x,H,R.d0],[x,H,R.d1],[x,58,R.d1]],u);
      wall([[x,8,R.d0],[x,58,R.d0],[x,58,R.d1],[x,8,R.d1]],l);
    });
    // 護牆板頂條與踢腳板
    const rail=S.pal('#fff1e6');
    wall([[R.x0,58,R.d0],[R.x0,62,R.d0],[R.x1,62,R.d0],[R.x1,58,R.d0]],rail);
    wall([[R.x0,0,R.d0],[R.x0,8,R.d0],[R.x1,8,R.d0],[R.x1,0,R.d0]],rail);
    [R.x0,R.x1].forEach(x=>{
      wall([[x,58,R.d0],[x,62,R.d0],[x,62,R.d1],[x,58,R.d1]],rail);
      wall([[x,0,R.d0],[x,8,R.d0],[x,8,R.d1],[x,0,R.d1]],rail);
    });
  },
};
})();

/* ---- ../scenes/outdoor.js ---- */
'use strict';
/* 室外:一片草皮。天空、遠山、格狀低多邊形草地,點綴草叢、小花與石頭。 */
(function(){
const S=SceneGfx;
const G={x0:-400,x1:400,d0:-300,d1:300};
let tiles=null,hills=null;
function buildTiles(){
  const r=rng(5),out=[],T=50,greens=['#86d05f','#7bc659','#90d868','#82cc5c'];
  for(let d=G.d0;d<G.d1;d+=T)for(let x=G.x0;x<G.x1;x+=T){
    const a=greens[Math.floor(r()*4)],b=greens[Math.floor(r()*4)];
    out.push({t1:[[x,0,d],[x+T,0,d],[x+T,0,d+T]],t2:[[x,0,d],[x+T,0,d+T],[x,0,d+T]],a,b});
  }
  return out;
}
function buildDecor(){
  const r=rng(9),out=[];
  const cols=['#ff8fb3','#ffd45a','#ffffff','#b58cff'];
  for(let i=0;i<120;i++)out.push({kind:'tuft',x:G.x0+r()*800,d:G.d0+r()*600,col:['#5fb04a','#4f9f3f','#6cc255'][i%3]});
  for(let i=0;i<34;i++){
    const x=G.x0+20+r()*760,d=G.d0+20+r()*560;
    if(Math.hypot(x,d-40)<60)continue;      // 出生點附近留空
    out.push({kind:'flower',x,d,h:9+r()*6,col:cols[i%4]});
  }
  [[-230,-120,15],[190,140,12],[-90,190,10],[280,-160,17]].forEach(([x,d,rad])=>out.push({kind:'rock',x,d,r:rad}));
  return out;
}
SCENES.outdoor={
  id:'outdoor',name:'室外草皮',type:'outdoor',kp:.0008,
  room:null,
  bounds:{x0:-340,x1:340,d0:-240,d1:250},
  center:{x:0,d:0},spawn:{x:0,d:40},
  slots:[],
  decor:buildDecor(),
  drawBase(c,v){
    if(!tiles){tiles=buildTiles();const r=rng(3);hills=[];for(let i=0;i<10;i++)hills.push([r(),r()]);}
    const yh=Math.min(v.H*.75,View.P(v,0,0,-900)[1]);
    // 天空
    const g=c.createLinearGradient(0,0,0,Math.max(60,yh));g.addColorStop(0,'#74cdf5');g.addColorStop(1,'#dcf3ff');
    c.fillStyle=g;c.fillRect(0,0,v.W,v.H);
    // 遠山(兩層)
    [['#8cc79a',.55,0],['#72b784',.4,1]].forEach(([col,hk,layer])=>{
      c.fillStyle=col;c.beginPath();c.moveTo(-20,yh+2);
      for(let i=0;i<=10;i++){const x=-20+i*(v.W+40)/10,h=(20+hills[i%10][layer]*46)*v.sc*hk*.6;c.lineTo(x,yh-h);}
      c.lineTo(v.W+20,yh+2);c.closePath();c.fill();
    });
    // 地面
    c.fillStyle='#7cc85a';c.fillRect(0,yh,v.W,v.H-yh);
    tiles.forEach(t=>{
      S.flat(c,v,t.t1,t.a);S.flat(c,v,t.t2,t.b);
    });
  },
};
})();

/* ---- ../engine/render.js ---- */
'use strict';
/* 場景渲染:背景 → 地面裝飾 → 牆 → 牆面裝飾 → 陰影 → 依深度排序的物件與貓 */
function drawDecorLayer(c,v,scene,layer,items){
  items.forEach(it=>{const def=DECOR[it.kind];if(def.layer===layer)def.draw(c,v,it);});
}
function drawCatSprites(c,v,agent,coat,t){
  const p=View.P(v,agent.x,0,agent.d),k=v.sc*View.f(v,agent.d),w=CameraRules.catSprite(v.t);
  [['high',GAME_CONFIG.cat.spritePitch.high],['close',GAME_CONFIG.cat.spritePitch.close]].forEach(([key,pitch])=>{
    if(w[key]<=.001)return;
    c.save();c.globalAlpha=w[key];c.translate(p[0],p[1]);c.scale(k,k);
    drawCat(c,{dir:agent.dir,act:agent.act,pitch,t,coat});
    c.restore();
  });
}
function renderScene(c,v,scene,agent,coat,t){
  c.setTransform(1,0,0,1,0,0);
  const items=resolveDecor(scene);
  scene.drawBase(c,v,t);
  drawDecorLayer(c,v,scene,'floor',items);
  if(scene.drawWalls)scene.drawWalls(c,v,t);
  drawDecorLayer(c,v,scene,'wall',items);
  // 貓的陰影:橢圓依場景俯角壓扁,和地面對得上
  const p=View.P(v,agent.x,0,agent.d),k=v.sc*View.f(v,agent.d);
  c.fillStyle='rgba(20,30,20,.28)';c.beginPath();
  c.ellipse(p[0],p[1],36*k,Math.max(4,24*v.sn*k),0,0,7);c.fill();
  // 依深度由遠到近繪製
  const list=items.filter(it=>DECOR[it.kind].layer==='prop').map(it=>({k:DECOR[it.kind].depth?DECOR[it.kind].depth(it):it.d,fn:()=>DECOR[it.kind].draw(c,v,it)}));
  list.push({k:agent.d,fn:()=>drawCatSprites(c,v,agent,coat,t)});
  paint(list);
}

/* ---- play.js ---- */
'use strict';
/* 遊戲頁:切換場景與花色、縮放(距離綁定俯角)、點擊或觸控讓貓走過去。偏好會記在瀏覽器裡。 */
(function(){
const cv=document.getElementById('stage'),c=cv.getContext('2d'),dist=document.getElementById('dist'),info=document.getElementById('info');
const barS=document.getElementById('scenes'),barC=document.getElementById('coats'),autoBtn=document.getElementById('auto');
const view=View.create(cv.width,cv.height);
const store={
  get(k,d){try{return localStorage.getItem('catHouse.'+k)||d;}catch(e){return d;}},
  set(k,v){try{localStorage.setItem('catHouse.'+k,v);}catch(e){}},
};
let scene=SCENES[store.get('scene','indoor')]||SCENES.indoor,coatKey=store.get('coat','orange');
if(!COATS[coatKey])coatKey='orange';
let agent=CatAgent.create(scene),tPrev=0;

function mark(bar,test){[...bar.children].forEach(b=>b.classList.toggle('on',test(b)));}
Object.values(SCENES).forEach(s=>{
  const b=document.createElement('button');b.textContent=s.name;b.dataset.id=s.id;
  b.onclick=()=>{scene=s;agent=CatAgent.create(s);agent.auto=autoBtn.classList.contains('on');store.set('scene',s.id);mark(barS,x=>x===b);};
  barS.appendChild(b);
});
mark(barS,b=>b.dataset.id===scene.id);
Object.entries(COATS).forEach(([k,v])=>{
  const b=document.createElement('button');b.className='chip';b.dataset.k=k;
  b.innerHTML=`<span class="dot" style="background:${v.o[1]}"></span>${v.name}`;
  b.onclick=()=>{coatKey=k;store.set('coat',k);mark(barC,x=>x===b);};
  barC.appendChild(b);
});
mark(barC,b=>b.dataset.k===coatKey);
autoBtn.onclick=()=>{
  autoBtn.classList.toggle('on');agent.auto=autoBtn.classList.contains('on');
  autoBtn.textContent='自動漫遊:'+(agent.auto?'開':'關');
};

function toCanvas(cx,cy){const r=cv.getBoundingClientRect();return[(cx-r.left)*cv.width/r.width,(cy-r.top)*cv.height/r.height];}
cv.addEventListener('click',e=>{
  const[sx,sy]=toCanvas(e.clientX,e.clientY),g=View.unproject(view,sx,sy);
  CatAgent.goTo(agent,scene,g.x,g.d);
});
cv.addEventListener('wheel',e=>{
  e.preventDefault();dist.value=Math.min(100,Math.max(0,+dist.value+(e.deltaY>0?6:-6)));
},{passive:false});
// 兩指縮放:手指張開 = 拉近
let pinch=null;
const span=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
cv.addEventListener('touchstart',e=>{if(e.touches.length===2)pinch={s:span(e.touches),v:+dist.value};},{passive:true});
cv.addEventListener('touchmove',e=>{
  if(pinch&&e.touches.length===2){e.preventDefault();dist.value=Math.min(100,Math.max(0,pinch.v*pinch.s/span(e.touches)));}
},{passive:false});
cv.addEventListener('touchend',e=>{if(e.touches.length<2)pinch=null;},{passive:true});

function frame(ms){
  const t=ms/1000,dt=Math.min(.05,t-tPrev);tPrev=t;
  BL=(t%3.6)<.14?.15:1;
  CatAgent.update(agent,scene,dt);
  const d=dist.value/100,k=1-d;              // 越近越跟著貓,越遠越看整個場景
  const focus={x:scene.center.x+(agent.x-scene.center.x)*k,d:scene.center.d+(agent.d-scene.center.d)*k};
  View.update(view,d,focus,scene.kp);
  renderScene(c,view,scene,agent,coatKey,t);
  info.textContent=`${scene.name}・場景俯角 ${view.pitch.toFixed(0)}°・${CameraRules.catSprite(d).close>.5?'近距離':'遠景'}視角`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
