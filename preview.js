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

/* ---- main.js ---- */
'use strict';
/* 預覽頁:花色切換、走路/坐下 × 4 方向 × 2 視角,可匯出 PNG 圖集 */
const CW=220,CH=230,DPR=2,SC=1.5,PITCHES=[{p:30,n:'高俯角 30°'},{p:6,n:'近距離'}];
let coatKey='orange';
const cards=[];
const wrap=document.getElementById('grid'),bar=document.getElementById('coats');

Object.entries(COATS).forEach(([k,v])=>{
  const b=document.createElement('button');b.textContent=v.name;b.dataset.k=k;
  b.onclick=()=>{coatKey=k;[...bar.children].forEach(x=>x.classList.toggle('on',x.dataset.k===k));};
  bar.appendChild(b);
});
bar.children[0].classList.add('on');

PITCHES.forEach(pt=>{
  const h=document.createElement('h2');h.textContent=pt.n;wrap.appendChild(h);
  const g=document.createElement('div');g.className='g';wrap.appendChild(g);
  CAT_POSES.forEach(po=>{
    const d=document.createElement('div');d.className='card';
    d.innerHTML=`<canvas width="${CW*DPR}" height="${CH*DPR}"></canvas><div class="t"><b>${po.act==='walk'?'走路':'坐下'}・${CAT_LABEL[po.dir]}</b></div>`;
    g.appendChild(d);
    cards.push({...po,pitch:pt.p,c:d.querySelector('canvas').getContext('2d')});
  });
});

function backdrop(c,pitch){
  const sn=Math.sin(pitch*Math.PI/180),oy=CH-34;
  c.fillStyle='#d9eef7';c.fillRect(0,0,CW,CH);
  const yh=oy-Math.max(12,120*sn);
  c.fillStyle='#8ed05e';c.fillRect(0,yh,CW,CH-yh);
  const th=Math.max(6,40*sn);
  for(let r=0,y=yh;y<CH;r++,y+=th)for(let x=0,i=0;x<CW;x+=40,i++){c.fillStyle=(i+r)%2?'#8ed05e':'#98dc68';c.fillRect(x,y,41,th+1);}
  c.fillStyle='rgba(30,70,20,.25)';c.beginPath();c.ellipse(CW/2,oy,38*SC,Math.max(3,14*sn*SC),0,0,7);c.fill();
}
function frame(ms){
  const t=ms/1000,blink=(t%3.6)<.14?.15:1;
  cards.forEach(k=>{
    const c=k.c;c.setTransform(DPR,0,0,DPR,0,0);
    backdrop(c,k.pitch);
    c.save();c.translate(CW/2,CH-34);c.scale(SC,SC);
    drawCat(c,{dir:k.dir,act:k.act,pitch:k.pitch,t,coat:coatKey,blink});
    c.restore();
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* 匯出透明背景圖集:每列 = 視角×動作×方向,走路 8 格、坐下 4 格 */
function exportSheet(key){
  const CELL_W=320,CELL_H=300,S=2,rows=[];
  PITCHES.forEach(pt=>CAT_POSES.forEach(po=>rows.push({...po,pitch:pt.p})));
  const cols=8,cv=document.createElement('canvas');cv.width=cols*CELL_W;cv.height=rows.length*CELL_H;
  const c=cv.getContext('2d');
  rows.forEach((r,ri)=>{
    const n=4;   // 走路:站姿、跨步 A、站姿、跨步 B
    for(let i=0;i<n;i++){
      c.save();c.translate(i*CELL_W+CELL_W/2,ri*CELL_H+CELL_H-40);c.scale(S,S);
      const t=(i+.5)/5;
      drawCat(c,{dir:r.dir,act:r.act,pitch:r.pitch,t,coat:key});
      c.restore();
    }
  });
  const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=`cat_${key}_sheet.png`;a.click();
  return {w:cv.width,h:cv.height,rows:rows.length};
}
document.getElementById('exp').onclick=()=>exportSheet(coatKey);
