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
  part('M-22,-30 C-24.4,-38.4 -16,-42.6 -4,-42.4 C5,-42.2 11,-42.8 15,-45 C18,-46.8 20.4,-49.6 22,-52 L31,-40 C29.4,-35 27,-28.4 22.4,-24.4 C15,-19.2 -8,-19.2 -18,-22 C-21.6,-23.6 -22.8,-26.6 -22,-30 Z',K.base,()=>{
    patches([[-11,-37,12,7,.1,0],[9,-42,9,6,-.3,1],[-18,-28,5,6,0,1]]);
    stripes([[-16,-42.6,-14,-33,1.9,.6],[-10,-42.6,-8.6,-32,1.9,.5],[-4,-42.4,-3,-32,1.9,.4],[2,-42.4,2.6,-33,1.8,.3],[8,-42.4,8,-34,1.6]]);
    white('M20,-37 C23,-40 28,-41 30,-38.6 C29,-33 26.4,-27 22,-23.4 C19.6,-28 19,-33 20,-37 Z');
    if(K.chest)fillD('M-12,-20 C-4,-22.6 8,-22.6 16,-21 L16,-18 L-12,-18 Z',K.light);
  });
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
  part('M-14,-.4 C-22,-1.4 -23.4,-14.6 -18.4,-24.6 C-13.4,-34.4 -5,-40.6 .6,-43.6 C3,-45.2 5,-47.6 6.4,-50 L16.4,-44.6 C15.4,-39 13.6,-33 13.4,-26 L13.4,-.4 Z',K.base,()=>{
    patches([[-10,-24,10,12,.3,0],[3,-40,8,7,.3,1]]);
    stripes([[-19,-26,-12,-22,1.9,.5],[-15,-33,-8,-28,1.9,.5],[-9,-38.6,-3,-33,1.8,.4],[-1,-41.6,2.6,-35,1.7,.3]]);
    white('M9.4,-42 C12.6,-44.6 16.4,-43.6 16,-39 C15.4,-32 13.6,-23 11.2,-17 C9.4,-24 8.4,-34 9.4,-42 Z');
  });
  part('M-17.6,-2 C-22.4,-8.4 -20.6,-20.4 -10.6,-22.4 C-2.2,-23.6 3,-15.4 2.2,-7.4 C1.6,-2.6 -1.6,-.4 -5.8,-.4 L-14,-.4 Z',K.base,()=>{patches([[-8,-14,8,7,0,0]]);stripes([[-15,-20,-11,-12,1.8,.5],[-8,-22,-5,-13,1.8,.3]]);});
  if(K.paws)ell(1.6,-1.6,5,1.9,0,K.light);else ell(1.6,-1.6,5,1.9,0,K.base);
  c.save();c.translate(-15,-2.4);c.rotate(Math.sin(tw)*.04);
  part('M0,-1 C-8,-.4 -11,2.6 -4,3.6 C6,4.6 18,4 26,2.6 C29,2 29,.2 26,.4 C18,1 8,1 1,-1.4 Z',patchCol(1,K.base),()=>stripes([[4,0,4,5,1.6],[10,0,10,5,1.6],[16,0,16,5,1.6],[22,0,23,4,2]]));
  c.restore();
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
