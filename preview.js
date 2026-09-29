/* ---- ../cat/geom.js ---- */
'use strict';
/* 幾何工具:向量、曲線補點、環狀截面框架、IK、投影(鏡頭)。
   模型座標:x=朝前,y=向上,z=左右;腳底在 y=0。 */
const V={
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  norm(a){const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];},
};
function catmull(p0,p1,p2,p3,t){
  const t2=t*t,t3=t2*t;
  return p1.map((_,i)=>.5*(2*p1[i]+(-p0[i]+p2[i])*t+(2*p0[i]-5*p1[i]+4*p2[i]-p3[i])*t2+(-p0[i]+3*p1[i]-3*p2[i]+p3[i])*t3));
}
/** 用 Catmull-Rom 在每段之間補 sub-1 個點 */
function resample(path,radii,sub){
  if(!sub||sub<2||path.length<3)return{path,radii};
  const P=[],R=[],n=path.length;
  for(let i=0;i<n-1;i++){
    const a=path[Math.max(i-1,0)],b=path[i],c=path[i+1],d=path[Math.min(i+2,n-1)];
    const ra=radii[Math.max(i-1,0)],rb=radii[i],rc=radii[i+1],rd=radii[Math.min(i+2,n-1)];
    for(let j=0;j<sub;j++){P.push(catmull(a,b,c,d,j/sub));R.push(catmull(ra,rb,rc,rd,j/sub));}
  }
  P.push(path[n-1]);R.push(radii[n-1]);
  return{path:P,radii:R};
}
/** 沿路徑的環:{c 中心,u 面內軸,v 左右軸,a,b 半徑,t 切線}。ref 未給時假設路徑大致在 x-y 平面 */
function ringFrames(path0,radii0,o={}){
  const rs=resample(path0,radii0,o.smooth),path=rs.path,radii=rs.radii,n=path.length,out=[];
  for(let i=0;i<n;i++){
    const t=V.norm(V.sub(path[Math.min(n-1,i+1)],path[Math.max(0,i-1)]));
    let u,v;
    if(o.ref){u=V.norm(V.sub(o.ref,V.mul(t,V.dot(o.ref,t))));v=V.cross(t,u);}
    else{const Z=[0,0,1];v=V.norm(V.sub(Z,V.mul(t,V.dot(Z,t))));u=V.cross(v,t);}
    out.push({c:path[i],u,v,a:radii[i][0],b:radii[i][1],t});
  }
  return out;
}
/** 2 連桿 IK:A→T,回傳關節位置(x-y 平面,z 取 A[2]) */
function ik2(A,T,L1,L2,bend){
  let dx=T[0]-A[0],dy=T[1]-A[1],d=Math.hypot(dx,dy)||1e-6;
  const ux=dx/d,uy=dy/d;
  d=Math.min(d,L1+L2-1e-3);d=Math.max(d,Math.abs(L1-L2)+1e-3);
  const a=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-a*a));
  return[A[0]+ux*a-uy*h*bend,A[1]+uy*a+ux*h*bend,A[2]];
}
/** 腳的步伐:theta 0~2π,前半段著地(由前往後),後半段抬起(由後往前) */
function footCycle(theta,A,H){
  const s=((theta%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  if(s<Math.PI)return[A*(1-2*s/Math.PI),0];
  const q=(s-Math.PI)/Math.PI;return[A*(-1+2*q),H*Math.sin(q*Math.PI)];
}
/** 鏡頭:dir=貓的朝向(left/right/up/down),pitch=俯角(度),shift=模型平移(讓貓置中)。
    螢幕:x 向右,y 向下;view=朝向鏡頭的方向(模型座標) */
function makeCam(dir,pitch,shift){
  const r=pitch*Math.PI/180,cs=Math.cos(r),sn=Math.sin(r),sh=shift||[0,0,0];
  const orient=p=>{
    switch(dir){
      case'right':return[p[0],p[1],p[2]];
      case'left':return[-p[0],p[1],-p[2]];
      case'down':return[p[2],p[1],p[0]];
      default:return[-p[2],p[1],-p[0]];
    }
  };
  const view=dir==='right'?[0,sn,cs]:dir==='left'?[0,sn,-cs]:dir==='down'?[cs,sn,0]:[-cs,sn,0];
  return{
    cs,sn,dir,view,
    lin(v){const q=orient(v);return[q[0],-q[1]*cs+q[2]*sn];},
    P(p){const q=orient(V.sub(p,sh));return[q[0],-q[1]*cs+q[2]*sn];},
    depth(p){const q=orient(V.sub(p,sh));return q[2]*cs+q[1]*sn;},
  };
}

/* ---- ../cat/coats.js ---- */
'use strict';
/* 花色。顏色都用 [r,g,b]。
   base 主色、light 淺色(胸口/口鼻/腳掌/腹部)、stripe 條紋色、tabby 是否虎斑、
   chestWhite/muzzleWhite/pawsWhite 白色部位、patches 三花色塊、eye 眼睛、nose 鼻子、ink 描邊色 */
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const mixc=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const cssc=(c,k=1,a=1)=>`rgba(${Math.min(255,c[0]*k)|0},${Math.min(255,c[1]*k)|0},${Math.min(255,c[2]*k)|0},${a})`;
function hash3(x,y,z){let h=(Math.floor(x)*73856093)^(Math.floor(y)*19349663)^(Math.floor(z)*83492791);h=(h^(h>>>13))*1274126177;return((h^(h>>>16))>>>0)/4294967296;}
function vnoise(x,y,z){
  const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),f=t=>t*t*(3-2*t),fx=f(x-xi),fy=f(y-yi),fz=f(z-zi);
  const L=(a,b,t)=>a+(b-a)*t,h=(i,j,k)=>hash3(xi+i,yi+j,zi+k);
  return L(L(L(h(0,0,0),h(1,0,0),fx),L(h(0,1,0),h(1,1,0),fx),fy),L(L(h(0,0,1),h(1,0,1),fx),L(h(0,1,1),h(1,1,1),fx),fy),fz);
}
const COATS={
  orange:{name:'橘虎斑',base:rgb('#e59a48'),light:rgb('#f8e4c4'),stripe:rgb('#a85a20'),tabby:true,chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#b6c85a'),nose:rgb('#e8909c'),ink:rgb('#6a3e26')},
  cream:{name:'奶油橘',base:rgb('#f6d3a2'),light:rgb('#fff6e8'),stripe:rgb('#e0b076'),tabby:true,chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#8ec8a0'),nose:rgb('#f4a0a8'),ink:rgb('#8a5a3c')},
  gray:{name:'灰虎斑',base:rgb('#9aa0ae'),light:rgb('#eceef3'),stripe:rgb('#646a7a'),tabby:true,chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#e0c04a'),nose:rgb('#e89aa8'),ink:rgb('#4a4e5e')},
  black:{name:'黑貓',base:rgb('#3a3a48'),light:rgb('#57576a'),eye:rgb('#f2c53a'),nose:rgb('#8a5a6a'),ink:rgb('#1c1c26'),dark:true},
  white:{name:'白貓',base:rgb('#f6f1ea'),light:rgb('#ffffff'),eye:rgb('#5aa8e0'),nose:rgb('#f4a0b0'),ink:rgb('#9a8676')},
  tuxedo:{name:'賓士',base:rgb('#3a3a48'),light:rgb('#faf5ec'),chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#e8c83a'),nose:rgb('#f0a0b0'),ink:rgb('#1c1c26'),dark:true},
  calico:{name:'三花',base:rgb('#faf5ec'),light:rgb('#ffffff'),chestWhite:true,pawsWhite:true,patches:[rgb('#ee9a3a'),rgb('#3a3a46')],eye:rgb('#dcb440'),nose:rgb('#f0a0b0'),ink:rgb('#8a6a58')},
};

/* ---- ../cat/rig.js ---- */
'use strict';
/* 貓的骨架:依姿勢(走路/坐下)、相位、尾巴擺動,產生一組「部位」(放樣的圓潤肢體與頭)。 */
const LEGTAG=u=>u>.78?'paw':'leg';
const HEAD_X=[-9,-5,-1,3,6,8.8,10.6];
const HEAD_Y=[.6,.4,0,-.5,-1.3,-2.3,-2.9];
const HEAD_R=[[6.0,6.4],[7.8,8.4],[8.2,9.2],[7.6,8.6],[6.0,6.6],[4.4,4.6],[3.0,3.2]];

function chain(path,radii,o){
  return{kind:'chain',rings:ringFrames(path,radii,o),tag:o.tag,tagAt:o.tagAt,bias:o.bias||0,legTop:!!o.tagAt};
}
/** 橢球(大腿、肩膀):用兩個環表示 */
function blob(c,rx,ry,rz,tag,bias){
  const d=Math.max(0,rx-ry);
  const ring=dx=>({c:[c[0]+dx,c[1],c[2]],u:[0,1,0],v:[0,0,1],a:ry,b:rz,t:[1,0,0]});
  return{kind:'chain',rings:[ring(-d),ring(d)],tag,bias:bias||0,legTop:false};
}
/** 頭:局部座標朝 +x,原點在頭中心;T/R 把局部座標(點/向量)轉到模型座標 */
function headPart(center,tilt,sc,blink){
  const cs=Math.cos(tilt),sn=Math.sin(tilt);
  const T=p=>[(p[0]*cs-p[1]*sn)*sc+center[0],(p[0]*sn+p[1]*cs)*sc+center[1],p[2]*sc+center[2]];
  const R=n=>[n[0]*cs-n[1]*sn,n[0]*sn+n[1]*cs,n[2]];
  const rings=HEAD_X.map((x,i)=>({c:T([x,HEAD_Y[i],0]),u:R([0,1,0]),v:[0,0,1],a:HEAD_R[i][0]*sc,b:HEAD_R[i][1]*sc,t:R([1,0,0])}));
  return{kind:'head',rings,T,R,sc,blink,tag:'head',bias:100};
}
function frontLeg(S,foot,z,bias){
  const P=[16+foot[0],foot[1],z],W=[P[0]-.3,P[1]+8.6,z],E=ik2([S[0],S[1],z],W,10.6,10.6,-1);
  const path=[[S[0],S[1]+1,z],E,W,[W[0]+.3,P[1]+2.5,z],[P[0]+2.2,P[1]+1.1,z]];
  return[chain(path,[[5.2,4.6],[3.8,3.3],[2.6,2.3],[3.0,2.6],[3.5,2.7]],{tagAt:LEGTAG,smooth:3,bias})];
}
function hindLeg(Hh,foot,z,bias){
  const P=[-12+foot[0],foot[1],z],H=[P[0]-1.2,P[1]+9.8,z],K=ik2([Hh[0],Hh[1],z],H,11.8,11.8,1);
  const path=[[Hh[0],Hh[1]+1,z],K,H,[H[0]+.6,P[1]+2.6,z],[P[0]+2.2,P[1]+1.1,z]];
  return[chain(path,[[6.6,5.6],[4.4,3.7],[2.7,2.4],[3.1,2.7],[3.6,2.8]],{tagAt:LEGTAG,smooth:3,bias})];
}
function rigWalk(o){
  const ph=o.phase,wob=Math.sin(ph*2)*.45,parts=[];
  const spine=[[-19,29.2+wob,0],[-10,30.0,0],[0,29.6,0],[9,29.6,0],[17,30.6,0],[24,34.8,0]];
  parts.push(chain(spine,[[8.0,7.2],[9.4,8.4],[9.0,8.0],[9.1,8.4],[10.4,9.2],[7.0,6.6]],{tag:'body',smooth:3}));
  const sw=o.tail;
  const tp=[[-19,31,0],[-26,32.5,0],[-31,35.5,sw*1.5],[-34,41,sw*4],[-34.5,47,sw*6],[-32.5,52,sw*7]];
  parts.push(chain(tp,[[3.8,3.6],[3.4,3.2],[3.0,2.9],[2.7,2.6],[2.5,2.4],[1.9,1.9]],{tag:'tail',smooth:2,bias:-.5}));
  const A=7,H=5.2,g=(th)=>footCycle(th,A,H);
  frontLeg([14.5,27.6],g(ph+Math.PI),-5.4).forEach(p=>parts.push(p));
  hindLeg([-14,26.6],g(ph),-5.8).forEach(p=>parts.push(p));
  frontLeg([14.5,27.6],g(ph),5.4).forEach(p=>parts.push(p));
  hindLeg([-14,26.6],g(ph+Math.PI),5.8).forEach(p=>parts.push(p));
  parts.push(headPart([34,39.5+wob*.6,0],-.12,1.1,o.blink));
  return{parts,shift:[-4,0,0]};
}
function rigSit(o){
  const s=o.side||1,sw=o.tail,parts=[];
  const tp=[[-16,3.6,0],[-24,3.4,s*4],[-27,3.2,s*12],[-21,3.2,s*19],[-11,3.2,s*22],[-2,3.3,s*(20+sw*3)]];
  parts.push(chain(tp,[[3.5,3.5],[3.4,3.4],[3.3,3.3],[3.1,3.1],[2.8,2.8],[2.3,2.3]],{tag:'tail',smooth:2,ref:[0,1,0]}));
  [-1,1].forEach(z=>{
    parts.push(blob([-8,7.4,z*8.6],9.4,7.6,5.4,'leg'));
    parts.push(blob([1.8,1.7,z*7.8],6.0,1.9,2.9,'paw'));
  });
  const spine=[[-15,7.5,0],[-11.5,13,0],[-7,20,0],[-2,27.5,0],[3,33.5,0],[6.5,38,0]];
  parts.push(chain(spine,[[8.2,9.0],[9.0,9.6],[8.9,9.1],[9.4,8.8],[8.9,8.1],[6.9,6.4]],{tag:'body',smooth:3}));
  [-1,1].forEach(z=>{
    const path=[[4.6,29,z*4.7],[5.8,18,z*4.7],[7.6,7,z*4.7],[9,3.4,z*4.7],[11,1.4,z*4.7]];
    parts.push(chain(path,[[4.8,4.4],[3.6,3.3],[2.8,2.6],[3.2,2.9],[3.6,3.0]],{tagAt:LEGTAG,smooth:2}));
  });
  parts.push(headPart([10.5,45.2,0],.02,1.12,o.blink));
  return{parts,shift:[-2.5,0,0]};
}
function buildCat(o){return o.act==='sit'?rigSit(o):rigWalk(o);}

/* ---- ../cat/draw.js ---- */
'use strict';
/* 平面寫實卡通繪製:肢體是圓潤的放樣形狀,加上細輪廓、立體明暗、毛流與花紋;頭部另畫耳朵與臉。
   做法:每個環投影成一個圓,相鄰兩圓之間補上外切四邊形,聯集就是肢體形狀。 */
const OUT_W=.6;                                     // 輪廓寬度(貓的單位)
const frand=s=>{const x=Math.sin(s*12.9898+78.233)*43758.5453;return x-Math.floor(x);};

function ringRadius(cam,ring){
  const Pu=cam.lin(ring.u),Pv=cam.lin(ring.v),Pt=cam.lin(ring.t);
  const sl=Math.hypot(Pt[0],Pt[1]);
  const rmax=Math.max(Math.hypot(Pu[0],Pu[1])*ring.a,Math.hypot(Pv[0],Pv[1])*ring.b);
  if(sl<1e-3)return rmax;
  const nx=-Pt[1]/sl,ny=Pt[0]/sl;
  const rperp=Math.hypot((Pu[0]*nx+Pu[1]*ny)*ring.a,(Pv[0]*nx+Pv[1]*ny)*ring.b);
  const w=Math.min(1,Math.max(0,(sl-.15)/.45));
  return rmax+(rperp-rmax)*w;
}
function hull(path,p0,r0,p1,r1){
  const dx=p1[0]-p0[0],dy=p1[1]-p0[1],L=Math.hypot(dx,dy);
  if(L<=Math.abs(r0-r1)+1e-6){const big=r0>=r1?[p0,r0]:[p1,r1];path.moveTo(big[0][0]+big[1],big[0][1]);path.arc(big[0][0],big[0][1],big[1],0,Math.PI*2);return;}
  const a=Math.atan2(dy,dx),f=Math.acos((r0-r1)/L);
  path.moveTo(p1[0]+Math.cos(a-f)*r1,p1[1]+Math.sin(a-f)*r1);
  path.arc(p1[0],p1[1],r1,a-f,a+f,false);
  path.arc(p0[0],p0[1],r0,a+f,a+Math.PI*2-f,false);
  path.closePath();
}
function unionPath(S,R,grow){
  const path=new Path2D();
  if(S.length===1){path.arc(S[0][0],S[0][1],R[0]+grow,0,Math.PI*2);return path;}
  for(let i=0;i<S.length-1;i++)hull(path,S[i],R[i]+grow,S[i+1],R[i+1]+grow);
  return path;
}
function segColor(part,coat,i,n){
  const tag=part.tagAt?part.tagAt((i+.5)/n):part.tag;
  return tag==='paw'&&coat.pawsWhite?coat.light:coat.base;
}
function normalAt(S,i){
  const a=S[Math.max(0,i-1)],b=S[Math.min(S.length-1,i+1)];
  let dx=b[0]-a[0],dy=b[1]-a[1];const l=Math.hypot(dx,dy);
  if(l<1e-3)return{n:[0,-1],t:[1,0]};
  dx/=l;dy/=l;let nx=-dy,ny=dx;if(ny>0){nx=-nx;ny=-ny;}
  return{n:[nx,ny],t:[dx,dy]};
}
/** 兩端漸細的花紋:從 p0(寬 w)彎向 p1(尖端) */
function taper(c,p0,p1,w,bend){
  const dx=p1[0]-p0[0],dy=p1[1]-p0[1],l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l;
  const mx=(p0[0]+p1[0])/2+nx*bend,my=(p0[1]+p1[1])/2+ny*bend;
  c.beginPath();c.moveTo(p0[0]+nx*w/2,p0[1]+ny*w/2);
  c.quadraticCurveTo(mx+nx*w*.25,my+ny*w*.25,p1[0],p1[1]);
  c.quadraticCurveTo(mx-nx*w*.25,my-ny*w*.25,p0[0]-nx*w/2,p0[1]-ny*w/2);
  c.closePath();c.fill();
}

function drawChain(c,cam,part,coat,seed){
  const rings=part.rings,n=rings.length,S=rings.map(r=>cam.P(r.c)),R=rings.map(r=>Math.max(.6,ringRadius(cam,r)));
  // 輪廓(腿根上半圈不畫,讓大腿自然接在身體上)
  c.save();
  if(part.legTop){c.beginPath();c.rect(-1e4,S[0][1]-R[0]*.1,2e4,2e4);c.clip();}
  c.fillStyle=cssc(coat.ink,1,.92);c.fill(unionPath(S,R,OUT_W));
  c.restore();
  const shape=unionPath(S,R,0);
  let ar=0;S.forEach((p,i)=>{ar+=R[i];});ar/=n;
  const fillSegs=(k,dx,dy)=>{
    c.save();c.translate(dx,dy);
    for(let i=0;i<n-1;i++){
      const p=new Path2D();hull(p,S[i],R[i],S[i+1],R[i+1]);
      c.fillStyle=cssc(segColor(part,coat,i,n-1),k);c.fill(p);
    }
    if(n===1){c.fillStyle=cssc(coat.base,k);c.fill(unionPath(S,R,0));}
    c.restore();
  };
  c.save();c.clip(shape);
  fillSegs(.74,0,0);                       // 暗部(右下)
  fillSegs(1,-ar*.3,-ar*.36);              // 受光面往左上偏移
  fillSegs(1.08,-ar*.42,-ar*.5);           // 最亮的高光面
  decals(c,cam,part,coat,S,R);
  furStrokes(c,part,coat,S,R,seed);
  c.restore();
  // 腳趾
  if(part.tagAt&&n>=2){
    const a=S[n-2],b=S[n-1],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1,ux=dx/l,uy=dy/l;
    c.strokeStyle=cssc(coat.ink,1,.55);c.lineWidth=.55;c.lineCap='round';
    [-.42,0,.42].forEach(k=>{
      const px=b[0]+(-uy)*R[n-1]*k,py=b[1]+ux*R[n-1]*k;
      c.beginPath();c.moveTo(px-ux*R[n-1]*.15,py-uy*R[n-1]*.15);c.lineTo(px+ux*R[n-1]*.75,py+uy*R[n-1]*.75);c.stroke();
    });
  }
}
/** 毛流:很短的細線,順著肢體方向,深淺交錯 */
function furStrokes(c,part,coat,S,R,seed){
  const n=S.length;
  c.lineCap='round';c.lineWidth=.5;
  for(let i=0;i<n;i++){
    const nt=normalAt(S,i),ang=Math.atan2(nt.t[1],nt.t[0]),m=Math.max(3,Math.round(R[i]*1.1));
    for(let k=0;k<m;k++){
      const s=seed*977+i*131+k*17,v=(frand(s)*2-1)*R[i]*.92,u=(frand(s+1)-.5)*R[i]*.6;
      const a=ang+(frand(s+2)-.5)*.7,len=1.2+frand(s+3)*2.4;
      const px=S[i][0]+nt.n[0]*v+nt.t[0]*u,py=S[i][1]+nt.n[1]*v+nt.t[1]*u;
      c.strokeStyle=frand(s+4)<.5?'rgba(255,248,236,.16)':'rgba(70,35,15,.12)';
      c.beginPath();c.moveTo(px,py);c.lineTo(px+Math.cos(a)*len,py+Math.sin(a)*len);c.stroke();
    }
  }
}
function decals(c,cam,part,coat,S,R){
  const rings=part.rings,n=rings.length,tag=part.tag;
  // 三花色塊
  if(coat.patches&&(tag==='body'||tag==='tail'||tag==='head')){
    rings.forEach((rg,i)=>{
      const q=vnoise(rg.c[0]*.09+3,rg.c[1]*.09,rg.c[2]*.09+7);
      let col=null;if(q>.6)col=coat.patches[0];else if(q<.27)col=coat.patches[1];
      if(!col)return;
      const nm=normalAt(S,i).n,o=(vnoise(rg.c[0]*.2,rg.c[1]*.2,5)-.5)*R[i]*.8;
      c.fillStyle=cssc(col);c.beginPath();c.arc(S[i][0]+nm[0]*o,S[i][1]+nm[1]*o,R[i]*.95,0,7);c.fill();
    });
  }
  // 白色胸口
  if(coat.chestWhite&&tag==='body'){
    const off=cam.lin([.6,-.8,0]);
    rings.forEach((rg,i)=>{
      if(rg.c[0]<7)return;
      c.fillStyle=cssc(coat.light);c.beginPath();c.arc(S[i][0]+off[0]*R[i]*.5,S[i][1]+off[1]*R[i]*.5,R[i]*.72,0,7);c.fill();
    });
  }
  // 腹部偏淺
  if(coat.light&&!coat.dark&&(tag==='body')&&(coat.chestWhite||coat.tabby)){
    const bp=new Path2D();
    rings.forEach((rg,i)=>{
      const nm=normalAt(S,i).n,cx=S[i][0]-nm[0]*R[i]*.85,cy=S[i][1]-nm[1]*R[i]*.85;
      bp.moveTo(cx+R[i]*.62,cy);bp.arc(cx,cy,R[i]*.62,0,Math.PI*2);
    });
    c.fillStyle=cssc(coat.light,1,.4);c.fill(bp);
  }
  // 虎斑條紋:兩端漸細
  if(coat.tabby){
    c.fillStyle=cssc(coat.stripe,1,.92);
    rings.forEach((rg,i)=>{
      const nt=normalAt(S,i),nm=nt.n,r=R[i],u=(i+.5)/n,P=S[i];
      if(tag==='body'&&i%2===1&&i>1&&i<n-2&&rg.c[0]<15){
        taper(c,[P[0]+nm[0]*r*1.25,P[1]+nm[1]*r*1.25],[P[0]-nm[0]*r*.15,P[1]-nm[1]*r*.15],1.9+(i%3)*.3,(i%2?1:-1)*r*.25);
      }else if(tag==='tail'&&i>0){
        if(i%2===0){taper(c,[P[0]+nm[0]*r*1.2,P[1]+nm[1]*r*1.2],[P[0]-nm[0]*r*1.2,P[1]-nm[1]*r*1.2],1.7,0);}
        if(i>=n-3){c.beginPath();c.arc(P[0],P[1],r*1.05,0,7);c.fill();}
      }else if(part.tagAt&&u>.2&&u<.55&&i%4===2){
        taper(c,[P[0]+nm[0]*r*1.15,P[1]+nm[1]*r*1.15],[P[0]-nm[0]*r*.5,P[1]-nm[1]*r*.5],1.4,r*.15);
      }
    });
  }
}

/* ---- 頭:耳朵、臉 ---- */
function hullPts(P){
  const pts=P.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo=[],up=[];
  pts.forEach(p=>{while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);});
  pts.slice().reverse().forEach(p=>{while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);});
  return lo.slice(0,-1).concat(up.slice(0,-1));
}
function drawEars(c,cam,head,coat){
  const T=head.T,R=head.R;
  [-1,1].forEach(s=>{
    const bx=-2.6,by=6.0,bz=s*5.2;
    const fo=[bx+4.6,by,bz+4.4*s],fi=[bx+4.6,by,bz-4.4*s],bo=[bx-4.4,by,bz+4.8*s],bi=[bx-4.4,by,bz-4.8*s],A=[bx-.4,by+11.2,bz+2.4*s];
    const pr=[fo,fi,bo,bi,A].map(p=>cam.P(T(p))),h=hullPts(pr);
    c.lineJoin='round';c.lineWidth=OUT_W*2;c.strokeStyle=cssc(coat.ink,1,.92);c.fillStyle=cssc(coat.base);
    const path=new Path2D();h.forEach((p,i)=>i?path.lineTo(p[0],p[1]):path.moveTo(p[0],p[1]));path.closePath();
    c.stroke(path);c.fill(path);
    const tip=cam.P(T(A));
    if(coat.tabby||coat.dark){c.save();c.clip(path);c.fillStyle=cssc(coat.tabby?coat.stripe:coat.ink,1,.55);c.beginPath();c.arc(tip[0],tip[1],3.2,0,7);c.fill();c.restore();}
    if(V.dot(R([1,.35,0]),cam.view)>.05){
      const a=cam.P(T(fo)),b=cam.P(T(fi)),t=cam.P(T(A)),m=[(a[0]+b[0]+t[0])/3,(a[1]+b[1]+t[1])/3],k=.66;
      const q=[a,b,t].map(p=>[m[0]+(p[0]-m[0])*k,m[1]+(p[1]-m[1])*k]);
      c.fillStyle='rgb(236,148,160)';c.beginPath();q.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();c.fill();
      c.strokeStyle='rgba(255,246,238,.85)';c.lineWidth=.55;c.lineCap='round';
      [-.3,0,.3].forEach(o=>{const x=m[0]+(t[0]-m[0])*.05+(b[0]-a[0])*o*.5,y=m[1]+(b[1]-a[1])*o*.5+2;c.beginPath();c.moveTo(x,y+2.2);c.lineTo(x+(t[0]-m[0])*.4,y+(t[1]-m[1])*.5);c.stroke();});
    }
  });
}
function headHalfWidth(x,y){
  let i=0;while(i<HEAD_X.length-2&&x>HEAD_X[i+1])i++;
  const t=Math.min(1,Math.max(0,(x-HEAD_X[i])/(HEAD_X[i+1]-HEAD_X[i])));
  const a=HEAD_R[i][0]+(HEAD_R[i+1][0]-HEAD_R[i][0])*t,b=HEAD_R[i][1]+(HEAD_R[i+1][1]-HEAD_R[i][1])*t;
  const yc=HEAD_Y[i]+(HEAD_Y[i+1]-HEAD_Y[i])*t,h=(y-yc)/a;
  return b*Math.sqrt(Math.max(0,1-h*h));
}
function drawEye(c,coat,p,rx,ry,tilt,blink){
  c.save();c.translate(p[0],p[1]);c.rotate(tilt);
  const almond=()=>{
    c.beginPath();c.moveTo(-rx,ry*.15);
    c.quadraticCurveTo(-rx*.15,-ry*1.25,rx,-ry*.2);
    c.quadraticCurveTo(rx*.1,ry*1.05,-rx,ry*.15);c.closePath();
  };
  if(blink<.5){
    c.strokeStyle=cssc(coat.ink);c.lineWidth=.9;c.lineCap='round';
    c.beginPath();c.moveTo(-rx,ry*.1);c.quadraticCurveTo(0,ry*.7,rx,-ry*.2);c.stroke();c.restore();return;
  }
  almond();c.fillStyle='rgb(250,244,226)';c.fill();
  c.save();almond();c.clip();
  const g=c.createRadialGradient(0,-ry*.15,0,0,0,rx*1.05);
  g.addColorStop(0,cssc(coat.eye,1.25));g.addColorStop(.6,cssc(coat.eye,1));g.addColorStop(1,cssc(coat.eye,.55));
  c.fillStyle=g;c.beginPath();c.ellipse(rx*.05,0,rx*.82,ry*1.1,0,0,7);c.fill();
  c.fillStyle='rgb(24,16,18)';c.beginPath();c.ellipse(rx*.05,0,rx*.24*(1.3-.6*Math.min(1,blink)),ry*.98,0,0,7);c.fill();
  c.fillStyle='rgba(0,0,0,.28)';c.beginPath();c.rect(-rx*1.2,-ry*1.3,rx*2.6,ry*.55);c.fill();   // 上眼皮的陰影
  c.fillStyle='rgba(255,255,255,.95)';c.beginPath();c.arc(-rx*.25,-ry*.4,rx*.2,0,7);c.fill();
  c.beginPath();c.arc(rx*.35,ry*.35,rx*.09,0,7);c.fill();
  c.restore();
  almond();c.strokeStyle=cssc(coat.ink);c.lineWidth=.8;c.lineJoin='round';c.stroke();
  c.restore();
}
function drawFace(c,cam,head,coat){
  const T=head.T,R=head.R,view=cam.view,pj=p=>cam.P(T(p)),sc=head.sc;
  const vis=n=>V.dot(R(n),view),dark=!!coat.dark;
  const TIP=HEAD_X[HEAD_X.length-1];
  // 口鼻的墊
  [-1,1].forEach(s=>{
    const k=vis([.7,-.1,s*.7]);if(k<-.05)return;
    const p=pj([TIP-2.3,-2.5,s*1.8]),r=2.8*sc*(.6+.4*Math.min(1,k+.3));
    c.fillStyle=cssc(coat.muzzleWhite?coat.light:mixc(coat.base,coat.light,.55));c.beginPath();c.arc(p[0],p[1],r,0,7);c.fill();
  });
  // 額頭與臉頰的虎斑
  if(coat.tabby){
    c.fillStyle=cssc(coat.stripe,1,.9);
    if(vis([.45,.85,0])>.08){
      [[[TIP-4.8,5.6,0],[TIP-8,9.2,0],0],[[TIP-5.2,5.0,2.8],[TIP-8.4,8.4,3.9],.6],[[TIP-5.2,5.0,-2.8],[TIP-8.4,8.4,-3.9],-.6]].forEach(([a,b,bd])=>{
        taper(c,pj(a),pj(b),1.5*sc,bd);});
    }
    [-1,1].forEach(s=>{
      if(vis([.25,0,s*.95])<.2)return;
      [[[TIP-8,-.4,s*8.4],[TIP-10.6,-1.7,s*9.2]],[[TIP-7.6,-2.2,s*8],[TIP-9.8,-3.3,s*8.8]]].forEach(([a,b])=>taper(c,pj(a),pj(b),1.3*sc,0));
    });
  }
  if(view[0]<-.3&&coat.tabby){
    c.fillStyle=cssc(coat.stripe,1,.9);
    [[-4,8.6,0],[-3.6,8.2,-3.6],[-3.6,8.2,3.6]].forEach(([x,y,z])=>taper(c,pj([x,y,z]),pj([x+3.2,y-3.8,z]),1.6*sc,0));
  }
  // 眼睛
  [-1,1].forEach(s=>{
    const k=vis([.5,.08,s*.86]);if(k<.1)return;
    const ex=4.5,ey=1.2,ez=s*(headHalfWidth(ex,ey)*.97);
    const p=pj([ex,ey,ez]),rx=3.0*sc*Math.max(.72,Math.min(1,k*1.6)),ry=2.7*sc;
    drawEye(c,coat,p,rx,ry*Math.max(.16,head.blink),-s*.16*(view[0]>.3?1:0)+ (view[0]>.3?0:-.05),head.blink);
  });
  // 鼻子與嘴
  if(vis([1,0,0])>-.35){
    const p=pj([TIP-.1,-1.4,0]),w=1.7*sc*(.65+.35*Math.abs(view[0])+.3*Math.abs(view[2])),h=1.4*sc;
    const g=c.createLinearGradient(0,p[1]-h,0,p[1]+h);g.addColorStop(0,cssc(coat.nose,1.1));g.addColorStop(1,cssc(coat.nose,.78));
    c.fillStyle=g;c.strokeStyle=cssc(coat.ink,1,.8);c.lineWidth=.6;c.lineJoin='round';
    c.beginPath();c.moveTo(p[0]-w,p[1]-h*.5);c.quadraticCurveTo(p[0],p[1]-h*.95,p[0]+w,p[1]-h*.5);c.quadraticCurveTo(p[0]+w*.45,p[1]+h*.85,p[0],p[1]+h);c.quadraticCurveTo(p[0]-w*.45,p[1]+h*.85,p[0]-w,p[1]-h*.5);c.closePath();c.fill();c.stroke();
    c.fillStyle='rgba(40,15,20,.55)';c.beginPath();c.ellipse(p[0]-w*.35,p[1]-h*.1,w*.16,h*.14,0,0,7);c.ellipse(p[0]+w*.35,p[1]-h*.1,w*.16,h*.14,0,0,7);c.fill();
    if(view[0]>.25){
      const m0=pj([TIP-.4,-2.3,0]),m1=pj([TIP-.9,-3.6,0]),ml=pj([TIP-1.7,-3.9,-1.9]),mr=pj([TIP-1.7,-3.9,1.9]);
      c.strokeStyle=cssc(coat.ink,1,.8);c.lineWidth=.6;c.lineCap='round';c.beginPath();c.moveTo(m0[0],m0[1]);c.lineTo(m1[0],m1[1]);
      c.moveTo(ml[0],ml[1]);c.quadraticCurveTo(m1[0],m1[1]+1.1,mr[0],mr[1]);c.stroke();
    }
  }
  // 鬍鬚:從口鼻往後方展開
  c.lineCap='round';c.lineWidth=.55;c.strokeStyle=dark?'rgba(255,255,255,.7)':cssc(coat.ink,1,.5);
  [-1,1].forEach(s=>{
    if(vis([.4,0,s*.9])<-.05)return;
    [2.4,.2,-2.2].forEach(dy=>{
      const a=pj([TIP-1.6,-2.4,s*3.4]),b=pj([TIP-6,-2.4+dy,s*12.4]),m=pj([TIP-3.6,-2.2+dy*.4,s*8]);
      c.beginPath();c.moveTo(a[0],a[1]);c.quadraticCurveTo(m[0],m[1]-.8,b[0],b[1]);c.stroke();
    });
  });
}
function drawHead(c,cam,head,coat,seed){
  drawEars(c,cam,head,coat);
  drawChain(c,cam,head,coat,seed);
  drawFace(c,cam,head,coat);
}

/* ---- ../cat/cat.js ---- */
'use strict';
/* 貓咪入口:drawCat(c,{dir,act,pitch,t,coat,blink})
   在 (0,0)=腳底中心繪製。dir: left|right|up|down;act: walk|sit;pitch: 俯角(度) */
const CAT_POSES=[
  {dir:'left',act:'walk'},{dir:'right',act:'walk'},{dir:'up',act:'walk'},{dir:'down',act:'walk'},
  {dir:'left',act:'sit'},{dir:'right',act:'sit'},{dir:'up',act:'sit'},{dir:'down',act:'sit'},
];
const CAT_LABEL={left:'左',right:'右',up:'背對',down:'面對'};
function drawCat(c,o){
  const t=o.t||0,coat=COATS[o.coat||'orange'];
  const rig=buildCat({act:o.act,phase:t*6,tail:Math.sin(t*2.2)*.5,blink:o.blink===undefined?1:o.blink,side:o.dir==='left'?-1:1});
  const cam=makeCam(o.dir,o.pitch,rig.shift);
  const items=rig.parts.map(p=>{
    let d=0;p.rings.forEach(r=>{d+=cam.depth(r.c);});
    return{p,k:d/p.rings.length+(p.bias||0)};
  }).sort((a,b)=>a.k-b.k);
  c.save();c.lineJoin='round';
  items.forEach((it,idx)=>{const sd=rig.parts.indexOf(it.p)+1;if(it.p.kind==='head')drawHead(c,cam,it.p,coat,sd);else drawChain(c,cam,it.p,coat,sd);});
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
