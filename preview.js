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
  const t=ms/1000;BL=(t%3.6)<.14?.15:1;
  cards.forEach(k=>{
    const c=k.c;c.setTransform(DPR,0,0,DPR,0,0);
    backdrop(c,k.pitch);
    c.save();c.translate(CW/2,CH-34);c.scale(SC,SC);
    drawCat(c,{dir:k.dir,act:k.act,pitch:k.pitch,t,coat:coatKey});
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
  const c=cv.getContext('2d');BL=1;
  rows.forEach((r,ri)=>{
    const n=r.act==='walk'?8:4;
    for(let i=0;i<n;i++){
      c.save();c.translate(i*CELL_W+CELL_W/2,ri*CELL_H+CELL_H-40);c.scale(S,S);
      const t=r.act==='walk'?(i/8)*Math.PI*2/6:(i/4)*Math.PI*2/2.5;
      drawCat(c,{dir:r.dir,act:r.act,pitch:r.pitch,t,coat:key});
      c.restore();
    }
  });
  const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=`cat_${key}_sheet.png`;a.click();
  return {w:cv.width,h:cv.height,rows:rows.length};
}
document.getElementById('exp').onclick=()=>exportSheet(coatKey);
