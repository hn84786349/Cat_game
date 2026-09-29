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
/* 花色(極簡扁平風,依使用者提供的參考圖)。顏色都用 [r,g,b]。
   base 主色、pattern 花紋樣式(tuxedo 賓士 / cow 乳牛 / calico 三花,在 art.js 依姿勢畫色塊)、
   spot 花紋用的色 [深色, 橘色]、eye 眼睛、nose 鼻子、farK 遠側部位的明度倍率、dark 深色毛(鬍鬚用淺色) */
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const cssc=(c,k=1,a=1)=>`rgba(${Math.min(255,c[0]*k)|0},${Math.min(255,c[1]*k)|0},${Math.min(255,c[2]*k)|0},${a})`;
const W_=rgb('#fbfbfa'),K_=rgb('#262424'),O_=rgb('#ec9446');
const COATS={
  orange:{name:'橘貓',base:O_,eye:rgb('#7fc84f'),nose:rgb('#cf7a4a'),farK:.84},
  cream:{name:'奶油貓',base:rgb('#f3cf97'),eye:rgb('#7fc84f'),nose:rgb('#e39a86'),farK:.88},
  gray:{name:'灰貓',base:rgb('#9aa1ad'),eye:rgb('#e0c04a'),nose:rgb('#c98a92'),farK:.86},
  black:{name:'黑貓',base:K_,eye:rgb('#8fd65a'),nose:rgb('#e7a0a8'),farK:.8,dark:true},
  white:{name:'白貓',base:W_,eye:rgb('#7fc84f'),nose:rgb('#eaa0aa'),farK:.9},
  tuxedo:{name:'賓士',base:K_,pattern:'tuxedo',spot:[W_,W_],eye:rgb('#6fd04a'),nose:rgb('#262424'),farK:.8,dark:true},
  cow:{name:'乳牛',base:W_,pattern:'cow',spot:[K_,K_],eye:rgb('#8fd65a'),nose:rgb('#262424'),farK:.9},
  calico:{name:'三花',base:W_,pattern:'calico',spot:[K_,O_],eye:rgb('#8fc85a'),nose:rgb('#e59a7a'),farK:.9},
};

/* ---- ../cat/art.js ---- */
'use strict';
/* 極簡扁平風的貓,輪廓照著使用者提供的參考圖描。
   每個姿勢在「圖片座標」(參考圖的像素,約 1024 寬)裡畫,再縮小成遊戲單位;
   側面的參考圖朝左,畫的時候鏡像成朝右。沒有輪廓線:同色的部位融成一個剪影,
   遠側的腳、尾巴、耳朵內側用同色稍深。花紋(賓士/乳牛/三花)是各姿勢裡定義好的色塊,裁切在各部位內。 */
const ART={};
(function(){
let c,K,BLINK,PAT;
const SC=.1,WALK_FPS=5;

function fillP(p,col,k=1){c.fillStyle=cssc(col,k);c.fill(p);c.strokeStyle=cssc(col,k);c.lineWidth=2.4;c.lineJoin='round';c.stroke(p);}
/** 部位:填色,然後在部位內疊上這個部位的花紋 */
function region(d,name,k=1,col){
  const p=new Path2D(d),base=col||K.base;
  fillP(p,base,k);
  const list=PAT&&PAT[name];
  if(list){c.save();c.clip(p);list.forEach(([d2,ci])=>{c.fillStyle=cssc(K.spot[ci],k);c.fill(new Path2D(d2));});c.restore();}
  return p;
}
const E=(x,y,rx,ry)=>`M${x-rx},${y} a${rx},${ry} 0 1,0 ${rx*2},0 a${rx},${ry} 0 1,0 ${-rx*2},0 Z`;
function stroke(d,col,k,w){c.strokeStyle=cssc(col,k);c.lineWidth=w;c.lineCap='round';c.lineJoin='round';c.stroke(new Path2D(d));}
function whiskers(list){
  c.strokeStyle=K.dark?'rgba(235,235,235,.9)':'rgba(20,18,18,.95)';c.lineWidth=2.4;c.lineCap='round';
  list.forEach(d=>c.stroke(new Path2D(d)));
}
function eye(x,y,rx,ry,rot=0){
  c.save();c.translate(x,y);c.rotate(rot);
  if(BLINK<.5){stroke(`M${-rx},0 Q0,${ry*.9} ${rx},0`,[20,18,18],1,3);c.restore();return;}
  c.fillStyle=cssc(K.eye);c.beginPath();c.moveTo(-rx,0);c.quadraticCurveTo(0,-ry*1.5,rx,0);c.quadraticCurveTo(0,ry*1.5,-rx,0);c.fill();
  c.fillStyle='rgb(18,16,16)';c.beginPath();c.ellipse(0,0,rx*.22,ry*.95,0,0,Math.PI*2);c.fill();
  c.restore();
}

/* ===== 側面(參考圖朝左,原點在腳底中心 x=500,y=790) ===== */
const SIDE_HEAD='M188,366 C192,328 222,292 282,276 C330,266 370,290 382,330 C392,364 384,398 356,412 C318,430 252,426 226,416 C204,406 186,390 188,366 Z';
function sideHead(){
  region('M236,302 L256,242 L292,282 Z','earFar',K.farK);                     // 遠側耳朵
  region(SIDE_HEAD,'head');
  region('M292,286 L326,240 L358,298 Z','ear');                               // 近側耳朵
  fillP(new Path2D('M308,288 L326,258 L344,294 Z'),PAT&&PAT.earIn?K.spot[PAT.earIn]:K.base,.82);
  fillP(new Path2D('M252,420 L282,410 L270,446 Z'),PAT&&PAT.chin!==undefined?K.spot[PAT.chin]:K.base,.84);  // 下巴下的小簇毛
  eye(244,342,21,12,-.05);
  c.fillStyle=cssc(K.nose);c.beginPath();c.moveTo(184,362);c.lineTo(198,360);c.lineTo(194,374);c.closePath();c.fill();
  stroke('M196,380 Q204,394 220,390',[40,30,30],1,2.6);
  whiskers(['M214,374 L144,372','M214,378 L140,404','M216,382 L158,432','M226,374 L300,372','M226,378 L318,410','M224,382 L292,440']);
}
function sideLeg(d,px,py,ang,k,name){
  c.save();c.translate(px,py);c.rotate(ang);c.translate(-px,-py);region(d,name,k);c.restore();
}
const LEG={
  frontNear:'M338,560 L426,560 C430,640 420,720 402,770 C398,790 380,792 350,790 C328,790 328,770 350,764 C362,700 352,630 338,560 Z',
  frontFar:'M300,560 L364,560 C366,650 356,722 342,768 C338,788 314,790 304,784 C296,772 314,766 320,760 C326,700 318,630 300,560 Z',
  hindNear:'M596,556 L746,556 C750,620 746,662 736,700 C730,730 728,760 725,775 C722,790 700,792 670,790 C648,790 646,775 668,768 L690,742 C690,700 670,660 640,630 C620,610 604,590 596,556 Z',
  hindFar:'M556,556 L640,596 C662,640 674,690 670,740 C667,766 650,790 625,790 C590,792 580,775 600,768 C620,760 628,740 630,720 C620,680 590,640 556,604 Z',
};
ART.sideWalk=function(ph,tw){
  const sw=q=>Math.round(Math.sin(ph+q))*.17,bob=0;
  c.translate(0,bob);
  sideLeg(LEG.frontFar,340,570,sw(Math.PI),K.farK,'legFF');
  sideLeg(LEG.hindFar,640,570,sw(0),K.farK,'legHF');
  c.save();c.translate(700,425);c.rotate(Math.sin(tw)*.08);c.translate(-700,-425);
  region('M686,420 C730,420 774,400 790,350 C800,320 794,296 804,280 C820,268 834,284 830,300 C828,352 810,400 770,430 C750,446 724,452 704,452 Z','tail',.88);
  c.restore();
  region('M296,402 C328,352 372,332 402,372 C420,396 440,404 472,404 L660,402 C710,404 742,432 746,482 C750,540 746,590 726,616 L420,616 C380,616 350,606 330,590 C300,570 262,520 256,470 C252,444 262,420 296,402 Z','body');
  sideLeg(LEG.hindNear,680,570,sw(Math.PI),1,'legHN');
  sideLeg(LEG.frontNear,385,570,sw(0),1,'legFN');
  sideHead();
};
ART.sideSit=function(tw){
  region('M332,470 C356,462 384,470 392,500 C398,600 390,720 380,768 C376,790 344,792 322,786 C306,776 326,764 340,760 C346,690 340,580 332,470 Z','legFF',K.farK);
  c.save();c.translate(600,780);c.rotate(Math.sin(tw)*.04);c.translate(-600,-780);
  region('M590,770 C680,776 742,762 764,732 C774,716 796,722 790,744 C778,786 700,804 590,802 Z','tail',.88);
  c.restore();
  region('M318,372 C360,330 420,318 470,352 C560,420 644,532 654,648 C662,744 620,792 556,792 L420,792 C412,700 408,610 400,560 C392,500 350,470 330,440 C318,420 310,396 318,372 Z','body');
  stroke('M462,786 C458,660 548,612 640,660',K.base,.86,5);                   // 大腿的弧線
  region(E(470,778,52,14),'paw',1);
  region('M340,450 C364,430 412,440 428,480 C440,560 436,700 428,772 C426,792 396,794 364,792 C340,790 340,772 366,768 C370,700 366,600 356,540 C350,500 336,476 340,450 Z','legFN');
  c.save();c.translate(96,-98);sideHead();c.restore();
};

/* ===== 正面(參考圖原點在腳底中心 x=505,y=800) ===== */
const FRONT_HEAD='M505,284 C560,284 596,312 598,352 C600,396 560,434 505,436 C450,434 410,396 412,352 C414,312 450,284 505,284 Z';
function frontHead(back){
  [-1,1].forEach(s=>{
    const x=505+s*88;
    region(`M${505+s*50},300 L${x},244 L${505+s*95},340 Z`,s<0?'earL':'earR');
    if(!back)fillP(new Path2D(`M${505+s*58},304 L${505+s*85},262 L${505+s*88},332 Z`),PAT&&PAT.earInF!==undefined?K.spot[PAT.earInF]:(s<0?regionCol('earL'):regionCol('earR')),.82);
  });
  region(FRONT_HEAD,back?'headBack':'headFront');
  if(back)return;
  eye(465,350,19,12);eye(545,350,19,12);
  c.fillStyle=cssc(K.nose);c.beginPath();c.moveTo(494,378);c.lineTo(516,378);c.lineTo(505,391);c.closePath();c.fill();
  stroke('M505,391 L505,398 M488,404 Q497,410 505,398 Q513,410 522,404',[40,30,30],1,2.6);
  stroke('M446,418 Q505,446 564,418',K.base,.82,4);
  whiskers(['M478,386 L390,380','M478,392 L378,408','M480,398 L396,428','M532,386 L620,380','M532,392 L632,408','M530,398 L614,428']);
}
function regionCol(name){return PAT&&PAT[name+'Col']!==undefined?K.spot[PAT[name+'Col']]:K.base;}
const FRONT_BODY='M458,420 L552,420 C580,470 624,540 640,610 C656,690 646,760 612,790 C590,804 560,802 505,802 C450,802 420,804 398,790 C364,760 354,690 370,610 C386,540 430,470 458,420 Z';
ART.frontSit=function(tw){
  c.save();c.translate(460,790);c.rotate(Math.sin(tw)*.03);c.translate(-460,-790);
  region('M470,788 C430,796 380,800 362,784 C348,770 360,748 380,756 C400,764 430,770 470,768 Z','tail',.9);
  c.restore();
  region(FRONT_BODY,'body');
  stroke('M418,600 C426,680 436,740 444,790',K.base,.82,5);stroke('M592,600 C584,680 574,740 566,790',K.base,.82,5);
  region('M496,670 L514,670 L514,796 L496,796 Z','gap',.84);
  region(E(540,780,30,20),'paw');region(E(470,780,30,20),'paw');
  frontHead(false);
};
ART.backSit=function(tw){
  frontHead(true);
  region(FRONT_BODY,'bodyBack');
  c.save();c.translate(560,790);c.rotate(Math.sin(tw)*.03);c.translate(-560,-790);
  region('M560,788 C500,800 420,806 380,790 C356,778 366,752 390,760 C420,772 480,774 560,766 Z','tail',.9);
  c.restore();
};
ART.frontWalk=function(ph,tw){
  const lift=q=>Math.max(0,Math.round(Math.sin(ph+q)))*22,bob=0;
  c.translate(0,bob);
  c.save();c.translate(540,440);c.rotate(Math.sin(tw)*.08);c.translate(-540,-440);
  region('M526,440 C540,380 548,320 580,262 C592,242 618,250 606,272 C582,318 566,380 556,442 Z','tail',.88);
  c.restore();
  [[-1,Math.PI],[1,0]].forEach(([s,q])=>{const l=lift(q);region(`M${505+s*50},${600-l} L${505+s*86},${600-l} L${505+s*84},${780-l} C${505+s*84},${794-l} ${505+s*52},${794-l} ${505+s*52},${780-l} Z`,'legH',K.farK);});
  region('M446,400 L564,400 C592,450 598,540 584,600 C566,640 444,640 426,600 C412,540 418,450 446,400 Z','chest');
  [[-1,0],[1,Math.PI]].forEach(([s,q])=>{const l=lift(q);region(`M${505+s*8},${560-l} L${505+s*56},${560-l} L${505+s*54},${776-l} C${505+s*54},${796-l} ${505+s*10},${796-l} ${505+s*10},${776-l} Z`,'legF');});
  frontHead(false);
};
ART.backWalk=function(ph,tw){
  const lift=q=>Math.max(0,Math.round(Math.sin(ph+q)))*22,bob=0;
  c.translate(0,bob);
  [[-1,0],[1,Math.PI]].forEach(([s,q])=>{const l=lift(q);region(`M${505+s*10},${600-l} L${505+s*52},${600-l} L${505+s*50},${780-l} C${505+s*50},${794-l} ${505+s*12},${794-l} ${505+s*12},${780-l} Z`,'legF',K.farK);});
  frontHead(true);
  region('M505,440 C580,440 612,500 610,570 C608,630 572,660 505,660 C438,660 402,630 400,570 C398,500 430,440 505,440 Z','rump');
  [[-1,Math.PI],[1,0]].forEach(([s,q])=>{const l=lift(q);region(`M${505+s*14},${580-l} L${505+s*84},${580-l} C${505+s*90},${660-l} ${505+s*70},${720-l} ${505+s*66},${776-l} C${505+s*64},${796-l} ${505+s*24},${796-l} ${505+s*26},${776-l} Z`,'legH');});
  c.save();c.translate(505,470);c.rotate(Math.sin(tw)*.1);c.translate(-505,-470);
  region('M492,480 C500,420 540,380 600,360 C630,350 646,330 644,300 C642,280 666,276 670,296 C676,344 650,380 610,394 C560,410 530,440 522,480 Z','tail',.88);
  c.restore();
};

/* ===== 花紋:各花色在各姿勢的色塊(圖片座標),[path, 色號] ===== */
const PATTERNS={
  tuxedo:{
    sideSit:{head:[['M180,330 C200,318 232,312 246,326 C240,352 248,380 268,396 L300,420 L180,420 Z',0]],
      body:[['M318,372 C340,380 360,400 372,430 C392,480 408,520 420,560 L420,640 C380,600 340,520 322,450 C312,420 310,396 318,372 Z',0]],
      legFN:[['M300,690 L460,690 L460,800 L300,800 Z',0]],paw:[['M0,0 L999,0 L999,999 L0,999 Z',0]],chin:0},
    side:{head:[['M180,330 C200,318 232,312 246,326 C240,352 248,380 268,396 L300,420 L180,420 Z',0]],
      body:[['M296,402 C332,408 352,440 360,480 C372,530 390,580 420,616 L330,616 C300,592 262,530 256,470 C252,440 262,418 296,402 Z',0],['M470,598 C530,584 600,586 656,592 L664,616 L470,616 Z',0]],
      legFN:[['M300,690 L460,690 L460,800 L300,800 Z',0]],legHN:[['M600,640 L760,640 L760,800 L600,800 Z',0]],chin:0,paw:[['M0,0 L999,0 L999,999 L0,999 Z',0]]},
    front:{headFront:[['M505,360 C530,360 546,380 548,400 C548,424 530,436 505,436 C480,436 462,424 462,400 C464,380 480,360 505,360 Z',0],['M498,300 L512,300 L520,372 L490,372 Z',0]],
      body:[['M462,420 L548,420 C560,480 560,560 540,640 L470,640 C450,560 450,480 462,420 Z',0]],paw:[['M0,0 L999,0 L999,999 L0,999 Z',0]],
      chest:[['M470,400 L540,400 C548,460 546,540 530,600 L480,600 C464,540 462,460 470,400 Z',0]],legF:[['M0,700 L999,700 L999,999 L0,999 Z',0]]},
  },
  cow:{
    sideSit:{head:[['M170,340 C200,320 250,300 300,280 L420,260 L420,420 L300,420 C290,380 270,340 240,326 C220,318 196,322 170,346 Z',0]],ear:[['M0,0 L999,0 L999,999 L0,999 Z',0]],earFar:[['M0,0 L999,0 L999,999 L0,999 Z',0]],earIn:0,
      body:[['M470,352 C540,410 600,480 630,560 C590,580 540,560 500,520 C470,490 452,420 470,352 Z',0]],tail:[['M0,0 L999,0 L999,999 L0,999 Z',0]]},
    side:{head:[['M170,340 C200,320 250,300 300,280 L420,260 L420,420 L300,420 C290,380 270,340 240,326 C220,318 196,322 170,346 Z',0]],ear:[['M0,0 L999,0 L999,999 L0,999 Z',0]],earFar:[['M0,0 L999,0 L999,999 L0,999 Z',0]],earIn:0,
      body:[['M404,404 L672,402 C684,450 664,520 604,530 C562,538 532,528 502,544 C462,562 420,530 404,480 Z',0],['M700,410 C742,430 752,480 746,520 L720,520 C716,480 706,440 694,420 Z',0]],tail:[['M0,0 L999,0 L999,999 L0,999 Z',0]]},
    front:{headFront:[['M400,270 L610,270 L610,352 C580,340 540,336 520,346 L505,352 L490,346 C470,336 430,340 400,352 Z',0]],earL:[['M0,0 L999,0 L999,999 L0,999 Z',0]],earR:[['M0,0 L999,0 L999,999 L0,999 Z',0]],earInF:0,
      body:[[E(600,560,40,70),0],[E(400,660,24,40),0]],headBack:[['M400,260 L610,260 L610,380 L400,380 Z',0]],bodyBack:[[E(460,520,60,50),0]],tail:[['M0,0 L999,0 L999,999 L0,999 Z',0]],rump:[[E(460,500,50,40),0]],chest:[[E(560,470,34,40),0]]},
  },
  calico:{
    sideSit:{head:[['M230,318 C260,290 300,272 340,272 L420,272 L420,420 L360,420 C350,390 340,350 300,330 C280,320 250,316 230,318 Z',1]],ear:[['M0,0 L999,0 L999,999 L0,999 Z',1]],earFar:[['M0,0 L999,0 L999,999 L0,999 Z',1]],earIn:1,
      body:[[E(480,420,50,44),0],[E(590,560,50,60),1],[E(520,700,44,30),1]],legFN:[[E(410,640,20,56),1]],tail:[[E(760,748,24,16),0]]},
    side:{head:[['M230,318 C260,290 300,272 340,272 L420,272 L420,420 L360,420 C350,390 340,350 300,330 C280,320 250,316 230,318 Z',1]],ear:[['M0,0 L999,0 L999,999 L0,999 Z',1]],earFar:[['M0,0 L999,0 L999,999 L0,999 Z',1]],earIn:1,
      body:[[E(430,442,44,54),0],[E(596,432,62,30),1],[E(556,516,40,28),1],[E(720,500,26,42),0],[E(712,582,30,40),1]],
      legFN:[[E(414,652,26,70),1]],legHF:[[E(652,724,14,38),0]],tail:[[E(790,330,12,20),1],[E(730,432,26,14),1]]},
    front:{headFront:[[E(452,300,48,30),1],[E(562,298,48,30),1]],earL:[['M0,0 L999,0 L999,999 L0,999 Z',1]],earR:[['M0,0 L999,0 L999,999 L0,999 Z',1]],earInF:1,
      body:[[E(372,540,16,42),1],[E(382,650,20,42),1],[E(632,530,18,56),0],[E(640,648,16,40),1]],
      tail:[[E(380,770,30,30),0],[E(440,780,20,20),1]],headBack:[[E(452,300,58,40),1],[E(562,300,58,40),1]],bodyBack:[[E(440,520,50,46),1],[E(580,640,40,46),0]],
      rump:[[E(450,520,44,40),1],[E(570,600,34,36),0]],chest:[[E(460,480,30,36),0]]},
  },
};

/** 入口:在 (0,0)=腳底中心畫一隻貓 */
ART.draw=function(ctx,o){
  c=ctx;K=COATS[o.coat||'orange'];BLINK=o.blink===undefined?1:o.blink;
  // 走路只用 3 張圖、4 格循環:站姿 → 跨步 A → 站姿 → 跨步 B(每格約 0.2 秒),像精靈圖一樣切換
  const t=o.t||0,frame=Math.floor(t*WALK_FPS)%4,ph=frame*Math.PI/2,tw=Math.floor(t*WALK_FPS)*.9,side=o.dir==='left'||o.dir==='right';
  const pat=K.pattern?PATTERNS[K.pattern]:null;PAT=pat?(side?(o.act==='sit'&&pat.sideSit?pat.sideSit:pat.side):pat.front):null;
  c.save();
  if(o.pitch>15)c.scale(1,.93);                               // 高俯角:略為壓扁
  c.scale(SC,SC);
  if(side){
    if(o.dir==='right')c.scale(-1,1);                         // 參考圖朝左,朝右時鏡像
    c.translate(-500,-790);
    if(o.act==='sit')ART.sideSit(tw);else ART.sideWalk(ph,tw);
  }else{
    c.translate(-505,-800);
    if(o.act==='sit'){if(o.dir==='down')ART.frontSit(tw);else ART.backSit(tw);}
    else{if(o.dir==='down')ART.frontWalk(ph,tw);else ART.backWalk(ph,tw);}
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
