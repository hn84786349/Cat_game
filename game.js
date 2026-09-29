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
    types:['indoor'],   // 室外場景先移除,之後再加回來
    slotTypes:{
      indoor:['floor','wall_mount','wall_window','wall_hang'],
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
  /** 深度透視(透視除法):比鏡頭焦點近的東西較大,較遠的較小;世界裡的直線投影後仍是直線 */
  f(v,d){return 1/Math.max(.33,1-(d-v.d)*v.kp);},
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

/* ---- ../util/rng.js ---- */
'use strict';
/* 可重現的亂數(mulberry32) */
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* ---- ../cat/coats.js ---- */
'use strict';
/* 花色(扁平插畫風)。顏色都用 [r,g,b]。
   base 主色、light 白色部位(胸口/口鼻/腳掌)、chest/muzzle/paws 是否有白色部位、
   stripe 虎斑條紋色(有就是虎斑)、patches 三花色塊 [淺色塊, 深色塊]、eye 眼睛、nose 鼻子 */
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const cssc=(c,k=1,a=1)=>`rgba(${Math.min(255,c[0]*k)|0},${Math.min(255,c[1]*k)|0},${Math.min(255,c[2]*k)|0},${a})`;
const WHITE=rgb('#fbf7f2');
const COATS={
  orange:{name:'橘虎斑',base:rgb('#e9a462'),light:WHITE,stripe:rgb('#c9793c'),chest:true,muzzle:true,paws:true,eye:rgb('#b8c95a'),nose:rgb('#e99aa2')},
  cream:{name:'奶油橘',base:rgb('#f3d6a8'),light:WHITE,stripe:rgb('#e0b47c'),chest:true,muzzle:true,paws:true,eye:rgb('#8cc3a0'),nose:rgb('#eea4aa')},
  gray:{name:'灰虎斑',base:rgb('#a9adb8'),light:WHITE,stripe:rgb('#737987'),chest:true,muzzle:true,paws:true,eye:rgb('#e2c451'),nose:rgb('#e9a2ae')},
  black:{name:'黑貓',base:rgb('#3b302d'),light:rgb('#3b302d'),eye:rgb('#c9d45a'),nose:rgb('#6e5352'),dark:true},
  white:{name:'白貓',base:WHITE,light:WHITE,eye:rgb('#7bb5de'),nose:rgb('#eea4b0')},
  tuxedo:{name:'賓士',base:rgb('#3b302d'),light:WHITE,chest:true,muzzle:true,paws:true,eye:rgb('#c9d45a'),nose:rgb('#eea4b0'),dark:true},
  calico:{name:'三花',base:WHITE,light:WHITE,patches:[rgb('#c98c52'),rgb('#3b302d')],eye:rgb('#c9c35a'),nose:rgb('#eea4b0')},
};

/* ---- ../cat/art.js ---- */
'use strict';
/* 扁平插畫風的貓:每個姿勢都是手繪的輪廓曲線(SVG path),不是用骨架拼的。
   座標:原點在腳底中心,x 向右,y 向下(負值往上)。側面姿勢都朝右,朝左時鏡像。
   花色靠「部位」上色:每個部位先填主色,再在部位內疊花紋(虎斑條紋、三花色塊、白色部位)。 */
const ART={};
(function(){
let c,K,T,BLINK;                                     // 目前的畫布、花色、時間、眨眼
const P=d=>new Path2D(d);
const lineOf=(col,k)=>cssc(col,col[0]+col[1]+col[2]>600?.86:.8*(k||1));

/** 畫一個部位:填色、細輪廓、在部位內疊花紋 */
function part(path,col,decor,k=1,strokeFrom){
  const p=typeof path==='string'?P(path):path;
  c.fillStyle=cssc(col,k);c.fill(p);
  if(decor){c.save();c.clip(p);decor();c.restore();}
  c.save();if(strokeFrom!==undefined){c.beginPath();c.rect(-99,strokeFrom,198,199);c.clip();}
  c.strokeStyle=lineOf(col,k);c.lineWidth=.55;c.lineJoin='round';c.stroke(p);c.restore();
  return p;
}
function fillD(d,col,k=1){c.fillStyle=cssc(col,k);c.fill(P(d));}
function ell(x,y,rx,ry,rot,col,k=1){c.fillStyle=cssc(col,k);c.beginPath();c.ellipse(x,y,rx,ry,rot||0,0,Math.PI*2);c.fill();}
/** 虎斑條紋:兩端漸細的筆畫 [x1,y1,x2,y2,寬度,彎曲] */
function stripes(list,k=1){
  if(!K.stripe)return;
  c.fillStyle=cssc(K.stripe,k);
  list.forEach(([x1,y1,x2,y2,w,b=0])=>{
    const dx=x2-x1,dy=y2-y1,l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l,mx=(x1+x2)/2+nx*b,my=(y1+y2)/2+ny*b;
    c.beginPath();c.moveTo(x1+nx*w/2,y1+ny*w/2);c.quadraticCurveTo(mx+nx*w*.3,my+ny*w*.3,x2,y2);
    c.quadraticCurveTo(mx-nx*w*.3,my-ny*w*.3,x1-nx*w/2,y1-ny*w/2);c.closePath();c.fill();
  });
}
/** 三花色塊 [x,y,rx,ry,旋轉,0=淺色塊/1=深色塊] */
function patches(list,k=1){if(K.patches)list.forEach(([x,y,rx,ry,r,i])=>ell(x,y,rx,ry,r,K.patches[i],k));}
function patchCol(i,fallback){return K.patches?K.patches[i]:fallback;}
function white(d,k=1){if(K.chest)fillD(d,K.light,k);}

/* ---- 腳:局部座標,髖部在 (0,0),腳底在 (0,L) ---- */
function legD(L,thigh){
  const w=thigh?5.6:3.3;
  return `M${-w},-2 C${-w-1},${L*.3} -2.8,${L*.45} -2.8,${L*.62} C-2.9,${L*.8} -2.9,${L-2} -2.9,${L-2.2}`+
    ` C-3,${L-.5} -1.5,${L} 1,${L} C3.8,${L} 4.6,${L-1.2} 3.4,${L-2.4} C3.1,${L*.8} 3.2,${L*.62} ${thigh?4.2:3.4},${L*.45} C${w+1},${L*.3} ${w},${L*.05} ${w-.5},-2 Z`;
}
function leg(x,y,L,ang,thigh,k,decor){
  c.save();c.translate(x,y);c.rotate(ang);
  const p=part(legD(L,thigh),K.base,()=>{
    if(decor)decor(L);
    if(K.paws)fillD(`M-4,${L-4.2} L5,${L-4.2} L5,${L+1} L-4,${L+1} Z`,K.light,k);
  },k,L*.28);
  c.restore();return p;
}
const legStripes=L=>stripes([[-3.5,L*.3,3.5,L*.36,1.4,.5],[-3.2,L*.5,3.2,L*.55,1.2,.4]]);

/* ---- 頭 ---- */
function eye(x,y,rx,ry,rot){
  c.save();c.translate(x,y);c.rotate(rot||0);
  if(BLINK<.5){c.strokeStyle=cssc([60,40,40]);c.lineWidth=.6;c.lineCap='round';c.beginPath();c.moveTo(-rx,0);c.quadraticCurveTo(0,ry*.8,rx,0);c.stroke();c.restore();return;}
  ell(0,0,rx,ry,0,K.eye);
  ell(0,0,rx*.3,ry*.85,0,[30,22,22]);
  ell(-rx*.32,-ry*.35,rx*.22,rx*.22,0,[255,255,255]);
  c.restore();
}
/** 正面的頭(局部座標,中心在 0,0);back=true 是後腦勺 */
function headFront(back){
  const ear=s=>`M${-13*s},-4.5 C${-13.6*s},-12 ${-12.6*s},-18 ${-10.6*s},-21.5 C${-8.2*s},-17.5 ${-5.2*s},-13.2 ${-3.4*s},-11.3 Z`;
  const earIn=s=>`M${-11.8*s},-7 C${-12*s},-12 ${-11.3*s},-16.5 ${-10.3*s},-18.5 C${-8.6*s},-15.5 ${-6.8*s},-13 ${-5.8*s},-11.8 Z`;
  const earCol=s=>K.patches?K.patches[s<0?0:1]:K.base;
  [-1,1].forEach(s=>{part(ear(s),earCol(s));if(!back)fillD(earIn(s),[236,170,176]);});
  const hd='M0,-12.4 C8.4,-12.4 13.8,-8.4 14.4,-2.4 C15,3.8 10.4,9 0,9 C-10.4,9 -15,3.8 -14.4,-2.4 C-13.8,-8.4 -8.4,-12.4 0,-12.4 Z';
  part(hd,K.base,()=>{
    patches([[-10,-7,9,8,.3,0],[10,-8,8,7,-.3,1]]);
    if(back){stripes([[-6,-11,-4,-3,1.8],[0,-12.4,0,-3,1.8],[6,-11,4,-3,1.8]]);return;}
    stripes([[-3.2,-12.4,-2,-6.5,1.5,.3],[0,-12.6,0,-6,1.6],[3.2,-12.4,2,-6.5,1.5,-.3],[-14.5,0,-9.5,1,1.4],[14.5,0,9.5,1,1.4],[-14,3,-10,3.4,1.2],[14,3,10,3.4,1.2]]);
    if(K.muzzle)fillD('M-5.4,3.4 C-5.4,.2 -2.2,1.4 0,2.2 C2.2,1.4 5.4,.2 5.4,3.4 C5.4,7.4 2.4,9 0,9 C-2.4,9 -5.4,7.4 -5.4,3.4 Z',K.light);
    if(K.chest&&!K.muzzle)0;
  });
  if(back)return;
  eye(-5.4,-1.2,2.7,2.5);eye(5.4,-1.2,2.7,2.5);
  fillD('M-1.5,2.2 L1.5,2.2 L0,3.9 Z',K.nose);
  c.strokeStyle=cssc([70,48,46],1,.8);c.lineWidth=.5;c.lineCap='round';
  c.beginPath();c.moveTo(0,3.9);c.lineTo(0,5);c.moveTo(-2,5.8);c.quadraticCurveTo(-1,6.2,0,5);c.quadraticCurveTo(1,6.2,2,5.8);c.stroke();
  whiskers([[4,4,15,2.6],[4,4.8,15,5.2],[4,5.6,14,7.6]]);
}
/** 側面的頭(朝右,局部座標,中心在 0,0) */
function headSide(){
  part('M-1.2,-11.3 C.6,-15 2.4,-18 3.6,-19.6 C4.8,-16.5 6,-13.2 6.4,-10 Z',patchCol(1,K.base),null,.88);    // 遠側耳朵
  const hd='M-10.2,-2 C-10.4,-8.6 -4.6,-12.6 2.4,-12.2 C8.6,-11.8 12.6,-7.2 13.2,-2.6 C13.6,.4 12.6,2.6 10.4,4.2 C7,6.6 -1.4,7.4 -6.6,5.4 C-9.2,4.2 -10.2,1.4 -10.2,-2 Z';
  part(hd,K.base,()=>{
    patches([[-4,-6,8,7,.2,1],[7,-9,5,4,0,0]]);
    stripes([[-1,-12.4,1,-7,1.6,.3],[3,-12.3,4.2,-7.4,1.5],[-8.5,-5,-4.5,-4,1.4],[-9.5,0,-5.5,.2,1.3],[5,1.5,1.5,1.2,1.1]]);
    if(K.muzzle)fillD('M6.8,.4 C9,-1 12,-1.4 13.2,-.6 C13.6,2.4 12,4.6 9.6,5.6 C7.2,6.2 5.8,5 5.6,3.4 C5.4,2 5.8,1 6.8,.4 Z',K.light);
  });
  part('M-7.2,-9.2 C-6.6,-13.6 -5.4,-17.4 -4,-20.2 C-1.6,-17 .4,-14 1.6,-11.2 Z',patchCol(1,K.base));              // 近側耳朵
  fillD('M-5.9,-10.8 C-5.4,-13.8 -4.6,-16.2 -3.9,-17.6 C-2.4,-15.6 -1.2,-13.6 -.4,-11.6 Z',[236,170,176]);
  eye(5.4,-3.6,2.2,2.3,.05);
  fillD('M12.1,-2 L13.6,-1.4 L12.8,-.1 Z',K.nose);
  c.strokeStyle=cssc([70,48,46],1,.8);c.lineWidth=.5;c.lineCap='round';
  c.beginPath();c.moveTo(12.8,-.1);c.quadraticCurveTo(12.6,1.6,11,2.2);c.stroke();
  whiskers([[9,1.2,1.5,-.4],[9,1.8,1.2,2.6],[9,2.4,2.2,5]],true);
}
function whiskers(list,oneSide){
  c.strokeStyle=K.dark?'rgba(255,255,255,.55)':'rgba(110,90,86,.45)';c.lineWidth=.35;c.lineCap='round';
  list.forEach(([x1,y1,x2,y2])=>{
    [1,-1].forEach(s=>{if(s<0&&oneSide)return;c.beginPath();c.moveTo(s*x1,y1);c.quadraticCurveTo(s*(x1+x2)/2,(y1+y2)/2-.6,s*x2,y2);c.stroke();});
  });
}

/* ---- 姿勢 ---- */
ART.sideWalk=function(ph,tw){
  const bob=-Math.abs(Math.sin(ph))*.8,swing=q=>Math.sin(ph+q)*.34,lift=q=>1-.08*Math.max(0,Math.cos(ph+q));
  c.translate(0,bob);
  // 遠側的腳
  leg(12,-23,23*lift(Math.PI),swing(Math.PI),false,.86,legStripes);
  leg(-14,-24,24*lift(0),swing(0),true,.86,legStripes);
  // 尾巴
  c.save();c.translate(-20,-33);c.rotate(Math.sin(tw)*.12);
  part('M1,-1 C-6,-3 -11,-9 -10.6,-19 C-10.4,-24 -7,-27 -5,-26 C-3,-25 -5,-21 -5.2,-18 C-5.4,-11 -2.4,-5 2.4,3 Z',patchCol(1,K.base),()=>stripes([[-12,-8,-4,-10,1.6,.3],[-12,-14,-4,-15,1.5],[-12,-20,-4,-20,1.5],[-10,-25,-3,-24,2.2]]));
  c.restore();
  // 身體與脖子
  part('M-22,-30 C-24.4,-38.4 -16,-42.6 -4,-42.4 C7,-42.2 15,-44.2 20.6,-40.6 C25,-37.6 25.4,-29.4 21.4,-24.4 C14.6,-19.2 -8,-19.2 -18,-22 C-21.6,-23.6 -22.8,-26.6 -22,-30 Z',K.base,()=>{
    patches([[-11,-37,12,7,.1,0],[7,-40,9,5,0,1],[-18,-28,5,6,0,1]]);
    stripes([[-16,-42.6,-14,-33,1.9,.6],[-10,-42.6,-8.6,-32,1.9,.5],[-4,-42.4,-3,-32,1.9,.4],[2,-42.4,2.6,-33,1.8,.3],[8,-42.4,8,-34,1.6]]);
    white('M17,-36 C21,-38 24.6,-34 24.4,-29.6 C24.2,-26 21.6,-23 18.4,-22 C17,-27 16.4,-32 17,-36 Z');
    if(K.chest)fillD('M-12,-20 C-4,-22.6 8,-22.6 16,-21 L16,-18 L-12,-18 Z',K.light);
  });
  part('M13.4,-39.4 C15.4,-45.4 20.6,-48.4 24.6,-46.4 L26,-37.4 C21.6,-35.4 17,-35.6 13.4,-37 Z',K.base,()=>{patches([[19,-44,6,4,0,1]]);});
  c.save();c.translate(25.6,-43.6);c.rotate(.04);headSide();c.restore();
  // 近側的腳
  leg(-14,-24,24*lift(Math.PI),swing(Math.PI),true,1,legStripes);
  leg(12,-23,23*lift(0),swing(0),false,1,legStripes);
};
ART.frontSit=function(tw){
  c.save();c.translate(12,-3);c.rotate(Math.sin(tw)*.06);
  part('M0,-1 C8,0 14,1 15,-5 C15.6,-10 13,-13.4 10.8,-11.8 C9,-10.4 11.4,-7.6 9.6,-5 C7.6,-2.6 3,-1.8 -1,-1.6 Z',patchCol(1,K.base),()=>stripes([[4,-4,5,1,1.6],[8.6,-5,10.6,-1,1.6],[11.4,-9,15.4,-8.4,1.6]]));
  c.restore();
  [-1,1].forEach(s=>part(`M${s*6},-1 C${s*6},-9 ${s*11},-14.4 ${s*15.4},-13 C${s*20},-11.4 ${s*20.4},-4 ${s*18},-1 C${s*16},.4 ${s*10},.4 ${s*6},-1 Z`,K.base,()=>{patches([[s*14,-8,6,5,0,s<0?0:1]]);stripes([[s*18,-11,s*13,-8,1.5],[s*20,-6,s*15,-4,1.4]]);}));
  part('M-8.4,-44 C-13.4,-38 -17.4,-25 -17,-12 C-16.8,-4 -12,-.6 -6.4,-.6 L6.4,-.6 C12,-.6 16.8,-4 17,-12 C17.4,-25 13.4,-38 8.4,-44 Z',K.base,()=>{
    patches([[-12,-26,9,11,.2,0],[13,-18,8,10,-.2,1]]);
    stripes([[-17,-30,-11,-28,1.8,.4],[17,-30,11,-28,1.8,-.4],[-17.4,-22,-11,-20,1.8,.3],[17.4,-22,11,-20,1.8,-.3],[-17,-14,-11.6,-13,1.6],[17,-14,11.6,-13,1.6]]);
    white('M-6.4,-43 C-3,-39 3,-39 6.4,-43 C8,-34 6.6,-23 3.6,-17 C1.4,-14 -1.4,-14 -3.6,-17 C-6.6,-23 -8,-34 -6.4,-43 Z');
  });
  [-1,1].forEach(s=>{if(K.paws)ell(s*16,-1.4,4.4,1.9,0,K.light);});
  [-1,1].forEach(s=>leg(s*4.3,-30,30,0,false,1,L=>stripes([[-3.5,L*.35,3.5,L*.38,1.3],[-3.5,L*.55,3.5,L*.57,1.2]])));
  c.save();c.translate(0,-52);headFront(false);c.restore();
};
ART.backSit=function(tw){
  [-1,1].forEach(s=>part(`M${s*6},-1 C${s*6},-9 ${s*11},-14.4 ${s*15.4},-13 C${s*20},-11.4 ${s*20.4},-4 ${s*18},-1 C${s*16},.4 ${s*10},.4 ${s*6},-1 Z`,K.base,()=>patches([[s*14,-8,6,5,0,s<0?1:0]])));
  c.save();c.translate(0,-52);headFront(true);c.restore();
  part('M-8.4,-44 C-13.4,-38 -17.4,-25 -17,-12 C-16.8,-4 -12,-.6 -6.4,-.6 L6.4,-.6 C12,-.6 16.8,-4 17,-12 C17.4,-25 13.4,-38 8.4,-44 Z',K.base,()=>{
    patches([[-8,-34,10,9,.2,1],[9,-18,10,11,-.2,0]]);
    stripes([[-10,-40,10,-40,1.8,-1.2],[-14,-32,14,-32,1.9,-1.8],[-16.4,-24,16.4,-24,1.9,-2],[-17,-16,17,-16,1.8,-2]]);
  });
  c.save();c.translate(8,-3);c.rotate(Math.sin(tw)*.05);
  part('M0,-1 C-8,1 -18,2 -24,-1 C-27,-3 -26,-7 -23,-6.4 C-21,-6 -21.4,-3.6 -18,-3.4 C-12,-3 -5,-3.6 1,-5 Z',patchCol(1,K.base),()=>stripes([[-6,-5,-5,0,1.6],[-12,-5,-12,1,1.6],[-18,-5,-19,1,1.6],[-24,-7,-26,-2,2]]));
  c.restore();
};
ART.sideSit=function(tw){
  leg(6,-28,28,.02,false,.86,legStripes);                                               // 遠側前腳
  part('M-14,-.4 C-22,-1.4 -23.4,-14.6 -18.4,-24.6 C-13.4,-34.4 -3,-42.4 5.4,-42.4 C11.4,-42.4 13.4,-35.4 13.4,-26 L13.4,-.4 Z',K.base,()=>{
    patches([[-10,-24,10,12,.3,0],[4,-36,8,6,0,1]]);
    stripes([[-19,-26,-12,-22,1.9,.5],[-15,-33,-8,-28,1.9,.5],[-9,-38.6,-3,-33,1.8,.4],[-1,-41.6,2.6,-35,1.7,.3]]);
    white('M8.6,-37 C12,-38 14.4,-34 14.4,-28.6 C14.4,-24 12.8,-20 11,-17 C9.4,-22 8.4,-30 8.6,-37 Z');
  });
  part('M-17.6,-2 C-22.4,-8.4 -20.6,-20.4 -10.6,-22.4 C-2.2,-23.6 3,-15.4 2.2,-7.4 C1.6,-2.6 -1.6,-.4 -5.8,-.4 L-14,-.4 Z',K.base,()=>{patches([[-8,-14,8,7,0,0]]);stripes([[-15,-20,-11,-12,1.8,.5],[-8,-22,-5,-13,1.8,.3]]);});
  if(K.paws)ell(1.6,-1.6,5,1.9,0,K.light);else ell(1.6,-1.6,5,1.9,0,K.base);
  c.save();c.translate(-15,-2.4);c.rotate(Math.sin(tw)*.04);
  part('M0,-1 C-8,-.4 -11,2.6 -4,3.6 C6,4.6 18,4 26,2.6 C29,2 29,.2 26,.4 C18,1 8,1 1,-1.4 Z',patchCol(1,K.base),()=>stripes([[4,0,4,5,1.6],[10,0,10,5,1.6],[16,0,16,5,1.6],[22,0,23,4,2]]));
  c.restore();
  part('M.6,-39.8 C3.6,-46.4 10,-48.6 13.4,-44.4 L14.4,-35.6 C10.4,-34.4 5,-35.6 .6,-37 Z',K.base,()=>patches([[6,-42,5,4,0,1]]));
  c.save();c.translate(10.4,-50.4);c.rotate(-.06);headSide();c.restore();
  leg(9.6,-28,28,0,false,1,legStripes);                                                  // 近側前腳
};
ART.frontWalk=function(ph,tw){
  const bob=-Math.abs(Math.sin(ph))*.8,lift=q=>Math.max(0,Math.sin(ph+q));
  c.translate(0,bob);
  c.save();c.translate(1.5,-34);c.rotate(Math.sin(tw)*.1);
  part('M-1.4,0 C-1,-8 -.6,-18 2.4,-24 C3.6,-26.6 7,-25.6 5.4,-22.6 C3,-17.6 2.4,-9 2,1 Z',patchCol(1,K.base),()=>stripes([[-2,-6,4,-6,1.5],[-1,-12,4,-12,1.5],[0,-18,5,-18,1.5],[1,-23,7,-24,2.2]]));
  c.restore();
  [-1,1].forEach(s=>leg(s*7.6,-19,19-2*lift(s>0?0:Math.PI),0,true,.86,L=>0));
  part('M-11.6,-36 C-14.6,-32 -14.6,-22 -11.4,-17.4 C-8,-15 8,-15 11.4,-17.4 C14.6,-22 14.6,-32 11.6,-36 C6.4,-40.4 -6.4,-40.4 -11.6,-36 Z',K.base,()=>{
    patches([[-8,-28,6,8,0,0],[8,-24,5,6,0,1]]);
    stripes([[-14.6,-30,-9.6,-28,1.7],[14.6,-30,9.6,-28,1.7],[-14.6,-23,-10,-22,1.6],[14.6,-23,10,-22,1.6]]);
    white('M-5,-37 C-2,-34 2,-34 5,-37 C6.4,-30 4.4,-22 0,-18.4 C-4.4,-22 -6.4,-30 -5,-37 Z');
  });
  [-1,1].forEach(s=>{const q=s>0?Math.PI:0,l=lift(q);leg(s*4.8,-26-l*2.4,26-l*1.2,0,false,1,L=>stripes([[-3.5,L*.35,3.5,L*.38,1.3]]));});
  c.save();c.translate(0,-44);headFront(false);c.restore();
};
ART.backWalk=function(ph,tw){
  const bob=-Math.abs(Math.sin(ph))*.8,lift=q=>Math.max(0,Math.sin(ph+q));
  c.translate(0,bob);
  [-1,1].forEach(s=>leg(s*5,-24,24-2*lift(s>0?0:Math.PI),0,false,.86,null));
  c.save();c.translate(0,-47);headFront(true);c.restore();
  part('M-12.4,-30 C-14,-38 -8.4,-42.6 0,-42.6 C8.4,-42.6 14,-38 12.4,-30 C11.4,-22.4 7.4,-18.4 0,-18.4 C-7.4,-18.4 -11.4,-22.4 -12.4,-30 Z',K.base,()=>{
    patches([[-6,-34,8,7,.2,1],[7,-24,7,7,0,0]]);
    stripes([[-12,-38,12,-38,1.8,-1.2],[-13.4,-32,13.4,-32,1.9,-1.6],[-13,-26,13,-26,1.8,-1.6]]);
  });
  [-1,1].forEach(s=>{const q=s>0?Math.PI:0,l=lift(q);leg(s*6.4,-23-l*2.4,23-l*1.2,0,true,1,legStripes);});
  c.save();c.translate(0,-28);c.rotate(Math.sin(tw)*.12);
  part('M-1.6,0 C-2.6,-10 -1.6,-22 2,-29 C3.4,-31.6 6.8,-30.6 5.4,-27.6 C2.6,-21 1.8,-10 2,0 Z',patchCol(1,K.base),()=>stripes([[-3,-6,3,-6,1.5],[-3,-12,3,-12,1.5],[-2,-18,4,-18,1.5],[0,-24,6,-24,1.5],[2,-29,7,-29,2.2]]));
  c.restore();
};

/** 入口:在 (0,0)=腳底中心畫一隻貓 */
ART.draw=function(ctx,o){
  c=ctx;K=COATS[o.coat||'orange'];T=o.t||0;BLINK=o.blink===undefined?1:o.blink;
  const ph=T*6,tw=T*2.4;
  c.save();c.lineJoin='round';
  if(o.pitch>15){c.scale(1,.92);}                              // 高俯角:略為壓扁,看起來像從上方看
  if(o.dir==='left')c.scale(-1,1);
  if(o.act==='sit'){
    if(o.dir==='left'||o.dir==='right')ART.sideSit(tw);else if(o.dir==='down')ART.frontSit(tw);else ART.backSit(tw);
  }else{
    if(o.dir==='left'||o.dir==='right')ART.sideWalk(ph,tw);else if(o.dir==='down')ART.frontWalk(ph,tw);else ART.backWalk(ph,tw);
  }
  c.restore();
};
})();

/* ---- ../cat/cat.js ---- */
'use strict';
/* 貓咪入口:drawCat(c,{dir,act,pitch,t,coat,blink})
   在 (0,0)=腳底中心繪製。dir: left|right|up|down;act: walk|sit;pitch: 俯角(度) */
const CAT_POSES=[
  {dir:'left',act:'walk'},{dir:'right',act:'walk'},{dir:'up',act:'walk'},{dir:'down',act:'walk'},
  {dir:'left',act:'sit'},{dir:'right',act:'sit'},{dir:'up',act:'sit'},{dir:'down',act:'sit'},
];
const CAT_LABEL={left:'左',right:'右',up:'背對',down:'面對'};
function drawCat(c,o){ART.draw(c,o);}

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

/* ---- ../scenes/sketch.js ---- */
'use strict';
/* 手繪簡約風繪圖工具:粉彩平塗、微微抖動的描邊、故意錯位的填色、紙張顆粒。
   抖動在世界座標裡計算,所以縮放或移動鏡頭時線條不會閃動。 */
const INK='#7b5b4d';
const Sketch={
  shade(hex,k){
    const n=parseInt(hex.slice(1),16),f=s=>Math.min(255,Math.max(0,Math.round(((n>>s)&255)*k)));
    return'#'+[16,8,0].map(s=>f(s).toString(16).padStart(2,'0')).join('');
  },
  scr(v,pts){return pts.map(([x,z,d])=>View.P(v,x,z,d));},
  seedOf(p){return(Math.round(p[0][0]*13+p[0][1]*7+p[0][2]*3)+p.length*101)|0;},
  /** 把折線在世界座標裡補點並加上固定的小抖動 */
  wob3(pts,seed,amp,closed){
    const r=rng(seed),out=[],n=pts.length,m=closed?n:n-1;
    for(let i=0;i<m;i++){
      const a=pts[i],b=pts[(i+1)%n],len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),seg=Math.max(1,Math.min(8,Math.round(len/38)));
      for(let s=0;s<seg;s++){
        const t=s/seg;
        out.push([a[0]+(b[0]-a[0])*t+(r()-.5)*amp*2,a[1]+(b[1]-a[1])*t+(r()-.5)*amp,a[2]+(b[2]-a[2])*t+(r()-.5)*amp*2]);
      }
    }
    if(!closed)out.push(pts[n-1]);
    return out;
  },
  trace(c,P,closed){c.beginPath();P.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(closed)c.closePath();},
  /** 手繪多邊形:o={amp,lw,off(填色錯位),stroke,ink,seed} */
  shape(c,v,pts3,fill,o={}){
    const S=Sketch,amp=o.amp===undefined?.5:o.amp,P=S.scr(v,S.wob3(pts3,o.seed||S.seedOf(pts3),amp,true)),k=v.sc;
    if(fill){
      const off=o.off===undefined?.7:o.off;
      c.fillStyle=fill;c.save();c.translate(-off*k,off*.7*k);S.trace(c,P,true);c.fill();c.restore();
    }
    if(o.stroke!==false){
      c.strokeStyle=o.ink||INK;c.lineWidth=Math.min(6,Math.max(1.2,(o.lw||1.3)*k));c.lineJoin='round';c.lineCap='round';
      S.trace(c,P,true);c.stroke();
    }
  },
  line(c,v,a,b,col,lw,seed){
    const S=Sketch,P=S.scr(v,S.wob3([a,b],seed||S.seedOf([a,b]),.35,false));
    c.strokeStyle=col||INK;c.lineWidth=Math.min(6,Math.max(1,(lw||1.1)*v.sc));c.lineCap='round';c.lineJoin='round';
    S.trace(c,P,false);c.stroke();
  },
  ellipsePts(cx,cd,z,rx,rd,n=20,a0=0,a1=Math.PI*2){
    const pts=[];for(let i=0;i<n;i++){const a=a0+(a1-a0)*i/(n-(a1-a0>=Math.PI*2-1e-6?0:1));pts.push([cx+Math.cos(a)*rx,z,cd+Math.sin(a)*rd]);}
    return pts;
  },
  /** 方塊:b={x0,x1,d0,d1,z0,z1};三個可見面用同一色系的深淺 */
  box(c,v,b,hex,o={}){
    const S=Sketch,{x0,x1,d0,d1,z0,z1}=b;
    S.flat(c,v,[[x0-2,0,d0],[x1+2,0,d0],[x1+5,0,d1+3],[x0-2,0,d1+3]],'rgba(120,80,60,.13)');
    if(v.x<x0)S.shape(c,v,[[x0,z0,d0],[x0,z1,d0],[x0,z1,d1],[x0,z0,d1]],S.shade(hex,.86),o);
    if(v.x>x1)S.shape(c,v,[[x1,z0,d0],[x1,z1,d0],[x1,z1,d1],[x1,z0,d1]],S.shade(hex,.86),o);
    S.shape(c,v,[[x0,z0,d1],[x0,z1,d1],[x1,z1,d1],[x1,z0,d1]],hex,o);
    S.shape(c,v,[[x0,z1,d0],[x1,z1,d0],[x1,z1,d1],[x0,z1,d1]],S.shade(hex,1.1),o);
  },
  /** 圓柱:碗、花盆。top 是上緣內側顏色(可省略) */
  cyl(c,v,cx,cd,r,h,hex,inner,o={}){
    const S=Sketch,n=18,z0=o.z0||0;
    if(!z0)S.flat(c,v,S.ellipsePts(cx+1,cd+2,0,r*1.15,r*1.15,n),'rgba(120,80,60,.13)');
    const lo=S.ellipsePts(cx,cd,z0,r,r,n,0,Math.PI),hi=S.ellipsePts(cx,cd,z0+h,r,r,n,0,Math.PI);
    S.shape(c,v,lo.concat(hi.slice().reverse()),S.shade(hex,.9),o);
    S.shape(c,v,S.ellipsePts(cx,cd,z0+h,r,r,n),hex,o);
    if(inner)S.shape(c,v,S.ellipsePts(cx,cd,z0+h+.2,r*.74,r*.74,n),inner,{stroke:false,off:0});
  },
  flat(c,v,pts3,col){c.fillStyle=col;Sketch.trace(c,Sketch.scr(v,pts3),true);c.fill();},
  /** 紙張顆粒 */
  grain(c,W,H){
    if(!Sketch._g){
      const g=document.createElement('canvas');g.width=g.height=128;const x=g.getContext('2d'),r=rng(4);
      for(let i=0;i<900;i++){x.fillStyle=r()<.5?'rgba(120,90,70,.10)':'rgba(255,255,255,.14)';x.fillRect(r()*128,r()*128,1.4,1.4);}
      Sketch._g=g;
    }
    c.save();c.fillStyle=c.createPattern(Sketch._g,'repeat');c.fillRect(0,0,W,H);c.restore();
  },
};

/* ---- ../scenes/decor.js ---- */
'use strict';
/* 裝飾物(手繪風)。新增裝飾物:在這裡加一筆 DECOR[kind],再放進場景的 decor 清單 */
(function(){
const S=Sketch;
DECOR.rug={layer:'floor',slotType:'floor',draw(c,v,it){
  S.shape(c,v,S.ellipsePts(it.x,it.d,.2,it.rx,it.rd,28),'#cdbbf1',{lw:1.4,off:.9});
  S.shape(c,v,S.ellipsePts(it.x,it.d,.3,it.rx*.78,it.rd*.78,28),'#e9defc',{lw:.9,off:.5});
  c.save();c.setLineDash([5*v.sc,5*v.sc]);
  S.shape(c,v,S.ellipsePts(it.x,it.d,.4,it.rx*.6,it.rd*.6,28),null,{lw:.8,ink:'#b49ade'});c.restore();
  for(let i=0;i<10;i++){const a=Math.PI*2*i/10+.3;S.shape(c,v,S.ellipsePts(it.x+Math.cos(a)*it.rx*.36,it.d+Math.sin(a)*it.rd*.36,.5,4,3.2,8),'#ffd6e4',{lw:.7,off:.3});}
}};
DECOR.window={layer:'wall',slotType:'wall_window',draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2,z0=it.z,z1=it.z+it.h,d=it.d,mx=it.x,mz=(z0+z1)/2;
  S.flat(c,v,[[x0+6,0,d+4],[x1-6,0,d+4],[x1+46,0,d+96],[x0+46,0,d+96]],'rgba(255,244,190,.32)');
  S.shape(c,v,[[x0-5,z0-5,d],[x0-5,z1+5,d],[x1+5,z1+5,d],[x1+5,z0-5,d]],'#fffaf0',{lw:1.5});
  S.shape(c,v,[[x0,z0,d],[x0,z1,d],[x1,z1,d],[x1,z0,d]],'#cdeefb',{lw:1,off:.4});
  // 雲
  [[.28,.66,9],[.4,.7,7],[.6,.6,8]].forEach(([fx,fz,r])=>{
    const cx=x0+it.w*fx,cz=z0+it.h*fz,pts=[];
    for(let i=0;i<12;i++){const a=Math.PI*2*i/12;pts.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r*.7,d+.3]);}
    S.shape(c,v,pts,'#ffffff',{stroke:false,off:0});
  });
  S.line(c,v,[mx,z0,d+.4],[mx,z1,d+.4],INK,1.2);S.line(c,v,[x0,mz,d+.4],[x1,mz,d+.4],INK,1.2);
  [[-1,x0-14,x0+11],[1,x1-11,x1+14]].forEach(([s,a,b])=>{
    S.shape(c,v,[[a,z0-10,d+1],[a,z1+14,d+1],[b,z1+14,d+1],[b,z0-10,d+1]],'#f8aabb',{lw:1.2});
    [.33,.66].forEach(f=>S.line(c,v,[a+(b-a)*f,z0-8,d+1.2],[a+(b-a)*f,z1+12,d+1.2],'#e88aa0',.8));
  });
  S.box(c,v,{x0:x0-10,x1:x1+10,d0:d,d1:d+9,z0:z0-11,z1:z0-5},'#fffaf0');
}};
DECOR.picture={layer:'wall',slotType:'wall_hang',draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2,z0=it.z,z1=it.z+it.h,d=it.d;
  S.shape(c,v,[[x0-4,z0-4,d],[x0-4,z1+4,d],[x1+4,z1+4,d],[x1+4,z0-4,d]],'#d9a877',{lw:1.4});
  S.shape(c,v,[[x0,z0,d],[x0,z1,d],[x1,z1,d],[x1,z0,d]],'#c5ead9',{lw:.9,off:.3});
  S.shape(c,v,[[x0,z0,d+.3],[x0+it.w*.38,z0+it.h*.62,d+.3],[x0+it.w*.72,z0,d+.3]],'#8fd0b4',{lw:.8,off:.2});
  S.shape(c,v,[[x0+it.w*.4,z0,d+.3],[x0+it.w*.78,z0+it.h*.46,d+.3],[x1,z0,d+.3]],'#6dbb9c',{lw:.8,off:.2});
  const sun=[];for(let i=0;i<10;i++){const a=Math.PI*2*i/10;sun.push([x0+it.w*.78+Math.cos(a)*4.5,z0+it.h*.78+Math.sin(a)*4.5,d+.3]);}
  S.shape(c,v,sun,'#ffe27a',{lw:.7,off:.2});
}};
DECOR.clock={layer:'wall',slotType:'wall_hang',draw(c,v,it){
  const pts=[];for(let i=0;i<20;i++){const a=Math.PI*2*i/20;pts.push([it.x+Math.cos(a)*it.r,it.z+Math.sin(a)*it.r,it.d]);}
  S.shape(c,v,pts,'#fffaf0',{lw:1.5});
  S.line(c,v,[it.x,it.z,it.d+.3],[it.x,it.z+it.r*.62,it.d+.3],INK,1.3);S.line(c,v,[it.x,it.z,it.d+.3],[it.x+it.r*.45,it.z-it.r*.1,it.d+.3],INK,1.3);
  [0,3,6,9].forEach(h=>{const a=Math.PI*2*h/12;S.line(c,v,[it.x+Math.sin(a)*it.r*.8,it.z+Math.cos(a)*it.r*.8,it.d+.3],[it.x+Math.sin(a)*it.r*.9,it.z+Math.cos(a)*it.r*.9,it.d+.3],INK,1);});
}};
DECOR.wallShelf={layer:'wall',slotType:'wall_mount',draw(c,v,it){
  const x0=it.x-it.w/2,x1=it.x+it.w/2;
  [x0+7,x1-15].forEach(bx=>S.shape(c,v,[[bx,it.z-14,it.d],[bx,it.z,it.d],[bx+7,it.z,it.d+12],[bx+7,it.z-3,it.d+12]],'#c99060',{lw:1}));
  S.box(c,v,{x0,x1,d0:it.d,d1:it.d+18,z0:it.z,z1:it.z+6},'#e6b784');
  (it.items||[]).forEach((m,i)=>{
    const bx=x0+8+i*13;
    if(m==='book')S.box(c,v,{x0:bx,x1:bx+8,d0:it.d+3,d1:it.d+13,z0:it.z+6,z1:it.z+6+13+(i%2)*4},['#f28b82','#8ecae6','#ffd166','#95d5b2'][i%4],{lw:.9});
    if(m==='plant'){S.cyl(c,v,bx+5,it.d+9,5,7,'#e69a72',null,{lw:.9,z0:it.z+6});[-1,0,1].forEach(k=>S.shape(c,v,[[bx+5+k*3,it.z+13,it.d+9],[bx+5+k*6,it.z+23,it.d+9],[bx+5+k*3+3,it.z+13,it.d+9]],'#93d9a0',{lw:.8,off:.2}));}
    if(m==='mug'){S.cyl(c,v,bx+5,it.d+9,5,8,'#b9d8f5','#7a5648',{lw:.9,z0:it.z+6});}
  });
}};
DECOR.catBed={layer:'prop',slotType:'floor',depth:it=>it.d+it.dd/2,draw(c,v,it){
  const n=24,lo=S.ellipsePts(it.x,it.d,0,it.w/2,it.dd/2,n,0,Math.PI),hi=S.ellipsePts(it.x,it.d,12,it.w/2,it.dd/2,n,0,Math.PI);
  S.flat(c,v,S.ellipsePts(it.x+2,it.d+3,0,it.w/2*1.08,it.dd/2*1.1,n),'rgba(120,80,60,.13)');
  S.shape(c,v,lo.concat(hi.slice().reverse()),'#ee8e86',{lw:1.4});
  S.shape(c,v,S.ellipsePts(it.x,it.d,12,it.w/2,it.dd/2,n),'#f7a8a0',{lw:1.4});
  S.shape(c,v,S.ellipsePts(it.x,it.d,10.5,it.w/2*.7,it.dd/2*.68,n),'#ffe6da',{lw:.9,off:.4});
  S.shape(c,v,S.ellipsePts(it.x+it.w*.08,it.d,11.5,it.w*.16,it.dd*.13,12),'#fff4ec',{lw:.8,off:.3});
}};
DECOR.bowls={layer:'prop',slotType:'floor',depth:it=>it.d+11,draw(c,v,it){
  [[-15,'#8fc4ee','#b98a63'],[15,'#f4a0b8','#b7d9f4']].forEach(([ox,col,fill],i)=>{
    S.cyl(c,v,it.x+ox,it.d,10,7,col,fill,{lw:1.2});
    if(i===0)[[-3,-2],[2,-3],[0,3],[-4,3],[4,2]].forEach(([dx,dd])=>S.shape(c,v,S.ellipsePts(it.x+ox+dx,it.d+dd,7.6,1.5,1.2,5),'#8a5a3a',{stroke:false,off:0}));
  });
}};
DECOR.plant={layer:'prop',slotType:'floor',depth:it=>it.d+13,draw(c,v,it){
  S.cyl(c,v,it.x,it.d,13,26,'#e79a72',null,{lw:1.4});
  S.shape(c,v,[[it.x-13,24,it.d],[it.x-13,29,it.d],[it.x+13,29,it.d],[it.x+13,24,it.d]],'#f3b48e',{lw:1.1});
  const g=['#8fd39a','#a8e0ae','#79c788','#b7e8b8'];
  [[-24,58],[-13,72],[0,82],[13,70],[25,56],[-6,64],[8,60]].forEach(([dx,h],i)=>{
    const bx=it.x+dx*.18,tx=it.x+dx,tz=29+h,w=8+(i%3);
    S.shape(c,v,[[bx-3,29,it.d],[tx-w,29+h*.55,it.d+(i%2?4:-4)],[tx,tz,it.d+(i%2?6:-6)],[tx+w,29+h*.55,it.d+(i%2?4:-4)],[bx+3,29,it.d]],g[i%4],{lw:1.1,off:.5});
    S.line(c,v,[bx,30,it.d],[tx,tz-4,it.d+(i%2?6:-6)],'#5fae76',.8);
  });
}};
DECOR.yarn={layer:'prop',slotType:'floor',depth:it=>it.d+7,draw(c,v,it){
  const p=View.P(v,it.x,7,it.d),k=v.sc*View.f(v,it.d),r=8*k;
  c.fillStyle='rgba(120,80,60,.13)';c.beginPath();c.ellipse(p[0]+1*k,p[1]+7*k*v.cs+1*k,9*k,3.2*k*v.sn+1,0,0,7);c.fill();
  c.fillStyle='#f39ab9';c.strokeStyle=INK;c.lineWidth=Math.max(1.2,1.2*k);c.beginPath();c.arc(p[0]-.6*k,p[1]+.4*k,r,0,7);c.fill();c.stroke();
  c.strokeStyle='#d96b93';c.lineWidth=Math.max(1,.9*k);
  [[-.5,-.3,.7],[.2,-.7,.9],[-.8,.2,.6]].forEach(([a,b,s])=>{c.beginPath();c.arc(p[0]+a*r*.3,p[1]+b*r*.3,r*s*.9,.3+a,2.2+b);c.stroke();});
  c.beginPath();c.moveTo(p[0]+r*.6,p[1]+r*.6);c.quadraticCurveTo(p[0]+r*1.6,p[1]+r*1.2,p[0]+r*2.2,p[1]+r*.7);c.stroke();
}};
})();

/* ---- ../scenes/indoor.js ---- */
'use strict';
/* 室內:一般的小房間(手繪簡約風)。只有後牆和左右牆,靠鏡頭那側開放。 */
(function(){
const S=Sketch;
const R={x0:-210,x1:210,d0:-150,d1:150,h:190};
const PAPER='#efe4d4',FLOOR='#f5deb9';
SCENES.indoor={
  id:'indoor',name:'室內小房間',type:'indoor',kp:.0015,
  room:R,
  bounds:{x0:-150,x1:150,d0:-112,d1:125},   // 貓能走的範圍
  center:{x:0,d:0},spawn:{x:0,d:40},
  slots:[
    {id:'window1',type:'wall_window',x:-60,z:84,d:R.d0,w:84,h:80},
    {id:'picture1',type:'wall_hang',x:74,z:112,d:R.d0,w:50,h:38},
    {id:'clock1',type:'wall_hang',x:172,z:128,d:R.d0,r:15},
    {id:'shelf1',type:'wall_mount',x:100,z:66,d:R.d0},
    {id:'shelf2',type:'wall_mount',x:172,z:104,d:R.d0},
    {id:'rug1',type:'floor',x:-10,d:35},
    {id:'bed1',type:'floor',x:128,d:62},
    {id:'bowls1',type:'floor',x:-124,d:98},
    {id:'plant1',type:'floor',x:-176,d:-112},
    {id:'yarn1',type:'floor',x:-62,d:66},
  ],
  decor:[
    {kind:'window',slot:'window1'},
    {kind:'picture',slot:'picture1'},
    {kind:'clock',slot:'clock1'},
    {kind:'wallShelf',slot:'shelf1',w:62,items:['book','book','plant']},
    {kind:'wallShelf',slot:'shelf2',w:56,items:['mug','book']},
    {kind:'rug',slot:'rug1',rx:120,rd:64},
    {kind:'catBed',slot:'bed1',w:66,dd:54},
    {kind:'bowls',slot:'bowls1'},
    {kind:'plant',slot:'plant1'},
    {kind:'yarn',slot:'yarn1'},
  ],
  drawBase(c,v){
    c.fillStyle=PAPER;c.fillRect(0,0,v.W,v.H);
    const yF=View.P(v,0,0,R.d1)[1];
    if(yF<v.H){c.fillStyle=v.t>.5?PAPER:FLOOR;c.fillRect(0,yF,v.W,v.H-yF);}
    S.shape(c,v,[[R.x0,0,R.d0],[R.x1,0,R.d0],[R.x1,0,R.d1],[R.x0,0,R.d1]],FLOOR,{off:0,lw:1.6,amp:.4});
    // 木地板的線
    for(let d=R.d0+30,r=0;d<R.d1;d+=30,r++){
      S.line(c,v,[R.x0,0,d],[R.x1,0,d],'#e4c397',1,100+r);
      for(let x=R.x0+((r*57)%90)+20;x<R.x1-6;x+=90)S.line(c,v,[x,0,d-30],[x,0,d],'#e4c397',.9,200+r*7+x);
    }
  },
  drawWalls(c,v){
    const H=R.h,up='#fdebdf',low='#f9d0c0';
    const wall=(pts,fill,seed)=>S.shape(c,v,pts,fill,{off:0,lw:1.5,amp:.35,seed});
    // 後牆
    wall([[R.x0,58,R.d0],[R.x0,H,R.d0],[R.x1,H,R.d0],[R.x1,58,R.d0]],up,1);
    wall([[R.x0,8,R.d0],[R.x0,58,R.d0],[R.x1,58,R.d0],[R.x1,8,R.d0]],low,2);
    // 後牆上的小圓點
    const k=v.sc;
    for(let r=0;r<5;r++)for(let i=0;i<14;i++){
      const x=R.x0+18+i*30+(r%2?15:0),z=72+r*24;
      if(x>R.x1-10)continue;
      const p=View.P(v,x,z,R.d0);c.fillStyle='#f8d6c8';c.beginPath();c.arc(p[0],p[1],2.4*k,0,7);c.fill();
    }
    // 左右牆(略暗)
    [[R.x0,.95,3],[R.x1,.97,4]].forEach(([x,f,seed])=>{
      wall([[x,58,R.d0],[x,H,R.d0],[x,H,R.d1],[x,58,R.d1]],S.shade(up,f),seed);
      wall([[x,8,R.d0],[x,58,R.d0],[x,58,R.d1],[x,8,R.d1]],S.shade(low,f),seed+2);
    });
    // 護牆板頂條與踢腳板
    const rail='#fff6ea';
    wall([[R.x0,58,R.d0],[R.x0,62,R.d0],[R.x1,62,R.d0],[R.x1,58,R.d0]],rail,7);
    wall([[R.x0,0,R.d0],[R.x0,8,R.d0],[R.x1,8,R.d0],[R.x1,0,R.d0]],rail,8);
    [R.x0,R.x1].forEach((x,i)=>{
      wall([[x,58,R.d0],[x,62,R.d0],[x,62,R.d1],[x,58,R.d1]],rail,9+i);
      wall([[x,0,R.d0],[x,8,R.d0],[x,8,R.d1],[x,0,R.d1]],rail,11+i);
    });
  },
};
})();

/* ---- ../engine/render.js ---- */
'use strict';
/* 場景渲染:背景 → 地面裝飾 → 牆 → 牆面裝飾 → 陰影 → 依深度排序的物件與貓 */
/** 依深度由遠到近繪製 */
function paint(items){items.sort((a,b)=>a.k-b.k).forEach(i=>i.fn());}
function drawDecorLayer(c,v,scene,layer,items){
  items.forEach(it=>{const def=DECOR[it.kind];if(def.layer===layer)def.draw(c,v,it);});
}
function drawCatSprites(c,v,agent,coat,t){
  const p=View.P(v,agent.x,0,agent.d),k=v.sc*View.f(v,agent.d),w=CameraRules.catSprite(v.t);
  [['high',GAME_CONFIG.cat.spritePitch.high],['close',GAME_CONFIG.cat.spritePitch.close]].forEach(([key,pitch])=>{
    if(w[key]<=.001)return;
    c.save();c.globalAlpha=w[key];c.translate(p[0],p[1]);c.scale(k,k);
    drawCat(c,{dir:agent.dir,act:agent.act,pitch,t,coat,blink:(t%3.6)<.14?.15:1});
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
  Sketch.grain(c,v.W,v.H);
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
if(Object.keys(SCENES).length<2)barS.parentElement.hidden=true;   // 只有一個場景時不顯示切換
Object.entries(COATS).forEach(([k,v])=>{
  const b=document.createElement('button');b.className='chip';b.dataset.k=k;
  b.innerHTML=`<span class="dot" style="background:rgb(${v.base.map(x=>x|0).join(',')})"></span>${v.name}`;
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
