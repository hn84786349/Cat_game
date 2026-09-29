/* ---- ../cat/mesh.js ---- */
'use strict';
/* 低多邊形 3D 網格與軟體渲染。
   模型座標:x=朝前,y=向上,z=左右;腳底在 y=0。
   渲染:依朝向(dir)把模型轉成螢幕座標 (X 右, Z 上, D 往鏡頭),再以俯角 pitch 投影,
   背面剔除、由遠到近排序、平面明暗。 */
const V={
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:a=>Math.hypot(a[0],a[1],a[2]),
  norm(a){const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];},
  lerp:(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],
  mid:(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],
};

class Mesh{
  constructor(){this.tris=[];this.lines=[];this.anchor=[0,0,0];}
  /** 三角形。inside=模型內部一點,法線會被調成朝外 */
  tri(a,b,c,tag,inside,extra){
    let n=V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
    const cen=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3];
    if(inside&&V.dot(n,V.sub(cen,inside))<0)n=V.mul(n,-1);
    this.tris.push(Object.assign({p:[a,b,c],n,cen,tag,loc:V.sub(cen,this.anchor)},extra));
  }
  line(a,b,tag){this.lines.push({p:[a,b],tag});}
}

/** 沿路徑做環狀截面的管狀網格。path=[[x,y,z],...],radii=[[a,b],...](a=面內半徑,b=左右半徑)
    opts:{sides,capStart,capEnd,tag,tagAt(u),ref} ref 未給時假設路徑大致在 x-y 平面(左右軸 = z) */
function catmull(p0,p1,p2,p3,t){
  const t2=t*t,t3=t2*t;
  return p1.map((_,i)=>.5*(2*p1[i]+(-p0[i]+p2[i])*t+(2*p0[i]-5*p1[i]+4*p2[i]-p3[i])*t2+(-p0[i]+3*p1[i]-3*p2[i]+p3[i])*t3));
}
/** 用 Catmull-Rom 在每段之間補 sub-1 個點,讓形狀更圓潤 */
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
function tube(mesh,path0,radii0,opts={}){
  const rs=resample(path0,radii0,opts.smooth),path=rs.path,radii=rs.radii;
  const n=path.length,sides=opts.sides||10,rings=[];
  for(let i=0;i<n;i++){
    const t=V.norm(V.sub(path[Math.min(n-1,i+1)],path[Math.max(0,i-1)]));
    let v,u;
    if(opts.ref){u=V.norm(V.sub(opts.ref,V.mul(t,V.dot(opts.ref,t))));v=V.cross(t,u);}
    else{const Z=[0,0,1];v=V.norm(V.sub(Z,V.mul(t,V.dot(Z,t))));u=V.cross(v,t);}
    const pts=[];
    for(let k=0;k<sides;k++){
      const th=Math.PI*2*k/sides+(opts.phase||0);
      pts.push(V.add(path[i],V.add(V.mul(u,radii[i][0]*Math.cos(th)),V.mul(v,radii[i][1]*Math.sin(th)))));
    }
    rings.push(pts);
  }
  for(let i=0;i<n-1;i++){
    const u01=(i+.5)/(n-1),tag=opts.tagAt?opts.tagAt(u01):opts.tag,ins=V.mid(path[i],path[i+1]);
    for(let k=0;k<sides;k++){
      const k2=(k+1)%sides,a=rings[i][k],b=rings[i][k2],c=rings[i+1][k2],d=rings[i+1][k];
      mesh.tri(a,b,c,tag,ins,{u:u01,ang:k/sides});
      mesh.tri(a,c,d,tag,ins,{u:u01,ang:(k+.5)/sides});
    }
  }
  const cap=(i,other,tagU)=>{
    const tag=opts.tagAt?opts.tagAt(tagU):opts.tag;
    for(let k=0;k<sides;k++){mesh.tri(path[i],rings[i][k],rings[i][(k+1)%sides],tag,path[other],{u:tagU,ang:k/sides});}
  };
  if(opts.capStart!==false)cap(0,1,0);
  if(opts.capEnd!==false)cap(n-1,n-2,1);
}
/** 橢球(經緯度網格) */
function ellipsoid(mesh,c,rx,ry,rz,tag,o={}){
  const rows=o.rows||5,sides=o.sides||8,R=[];
  for(let i=0;i<=rows;i++){
    const ph=Math.PI*i/rows,r=Math.sin(ph),y=Math.cos(ph),ring=[];
    for(let k=0;k<sides;k++){const th=Math.PI*2*k/sides;ring.push([c[0]+rx*r*Math.cos(th),c[1]+ry*y,c[2]+rz*r*Math.sin(th)]);}
    R.push(ring);
  }
  for(let i=0;i<rows;i++)for(let k=0;k<sides;k++){
    const k2=(k+1)%sides,a=R[i][k],b=R[i][k2],cc=R[i+1][k2],d=R[i+1][k];
    if(i>0)mesh.tri(a,b,cc,tag,c,{u:i/rows,ang:k/sides});
    if(i<rows-1)mesh.tri(a,cc,d,tag,c,{u:i/rows,ang:k/sides});
    if(i===0)mesh.tri(a,cc,d,tag,c,{u:0,ang:k/sides});
    if(i===rows-1)mesh.tri(a,b,cc,tag,c,{u:1,ang:k/sides});
  }
}
/** 2 連桿 IK:A→T,回傳關節位置(x-y 平面,z 取 A[2]) */
function shiftMesh(m,dx,dy=0,dz=0){
  const f=p=>[p[0]+dx,p[1]+dy,p[2]+dz];
  m.tris.forEach(t=>{t.p=t.p.map(f);t.cen=f(t.cen);});
  m.lines.forEach(l=>{l.p=l.p.map(f);});
}
function ik2(A,T,L1,L2,bend){
  let dx=T[0]-A[0],dy=T[1]-A[1],d=Math.hypot(dx,dy)||1e-6;
  const ux=dx/d,uy=dy/d;
  d=Math.min(d,L1+L2-1e-3);d=Math.max(d,Math.abs(L1-L2)+1e-3);
  const a=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-a*a));
  return[A[0]+ux*a-uy*h*bend,A[1]+uy*a+ux*h*bend,A[2]];
}

/* ---- 渲染 ---- */
const LIGHT=V.norm([-.42,.8,.55]);   // 在螢幕座標 (X,Z,D) 的光源方向
function orient(dir,p){
  switch(dir){
    case'right':return[p[0],p[1],p[2]];
    case'left':return[-p[0],p[1],-p[2]];
    case'down':return[p[2],p[1],p[0]];    // 面向鏡頭:朝前的 x 軸變成往鏡頭的 D
    case'up':return[-p[2],p[1],-p[0]];
  }
}
/** 把網格畫到 c 上,原點(0,0)=腳底中心。colorAt(tri)→[r,g,b] */
function renderMesh(c,mesh,view,colorAt){
  const r=view.pitch*Math.PI/180,cs=Math.cos(r),sn=Math.sin(r),dir=view.dir,items=[];
  const prj=q=>[q[0],-q[1]*cs+q[2]*sn,q[2]*cs+q[1]*sn];   // → [sx, sy, 深度]
  mesh.tris.forEach((t,i)=>{
    const n=orient(dir,t.n);
    if(!t.double&&n[1]*sn+n[2]*cs<=.02)return;            // 背面剔除
    const P=t.p.map(p=>prj(orient(dir,p)));
    const depth=(P[0][2]+P[1][2]+P[2][2])/3;
    items.push({k:depth,t,n,P,i});
  });
  mesh.lines.forEach(l=>{
    const P=l.p.map(p=>prj(orient(dir,p)));
    items.push({k:(P[0][2]+P[1][2])/2+.5,line:l,P});
  });
  items.sort((a,b)=>a.k-b.k);
  c.lineJoin='round';
  items.forEach(it=>{
    if(it.line){
      c.strokeStyle='rgba(255,255,255,.85)';c.lineWidth=.7;c.lineCap='round';
      c.beginPath();c.moveTo(it.P[0][0],it.P[0][1]);c.lineTo(it.P[1][0],it.P[1][1]);c.stroke();return;
    }
    if(it.t.tag==='eye'||it.t.tag==='pupil'){
      const col=colorAt(it.t),s=`rgb(${col[0]|0},${col[1]|0},${col[2]|0})`;
      c.fillStyle=s;c.strokeStyle=s;c.lineWidth=.5;
      c.beginPath();c.moveTo(it.P[0][0],it.P[0][1]);c.lineTo(it.P[1][0],it.P[1][1]);c.lineTo(it.P[2][0],it.P[2][1]);c.closePath();c.fill();c.stroke();return;
    }
    const col=colorAt(it.t),nd=V.dot(it.n,LIGHT);
    const jit=1+(((it.i*2654435761)>>>0)%1000/1000-.5)*.07;
    const k=Math.min(1.18,Math.max(.42,(.6+.52*nd)*jit));
    const s=`rgb(${Math.min(255,col[0]*k)|0},${Math.min(255,col[1]*k)|0},${Math.min(255,col[2]*k)|0})`;
    c.fillStyle=s;c.strokeStyle=s;c.lineWidth=.6;
    c.beginPath();c.moveTo(it.P[0][0],it.P[0][1]);c.lineTo(it.P[1][0],it.P[1][1]);c.lineTo(it.P[2][0],it.P[2][1]);c.closePath();c.fill();c.stroke();
  });
}

/* ---- ../cat/coats.js ---- */
'use strict';
/* 花色:顏色都用 [r,g,b]。colorAt(tri) 依三角形所在的部位與位置決定顏色。 */
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const mixc=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
function hash3(x,y,z){let h=(Math.floor(x)*73856093)^(Math.floor(y)*19349663)^(Math.floor(z)*83492791);h=(h^(h>>>13))*1274126177;return((h^(h>>>16))>>>0)/4294967296;}
function vnoise(x,y,z){
  const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),f=t=>t*t*(3-2*t),fx=f(x-xi),fy=f(y-yi),fz=f(z-zi);
  const L=(a,b,t)=>a+(b-a)*t,h=(i,j,k)=>hash3(xi+i,yi+j,zi+k);
  return L(L(L(h(0,0,0),h(1,0,0),fx),L(h(0,1,0),h(1,1,0),fx),fy),L(L(h(0,0,1),h(1,0,1),fx),L(h(0,1,1),h(1,1,1),fx),fy),fz);
}
/* 欄位:base 主色、light 淺色(腹部/胸口/口鼻/腳掌)、stripe 條紋色、tabby 是否虎斑、
   pawsWhite/chestWhite/muzzleWhite 白色部位、patches 三花色塊、eye 眼睛、nose 鼻子 */
const COATS={
  orange:{name:'橘虎斑',base:rgb('#e8862c'),light:rgb('#ffe2bd'),stripe:rgb('#b85a14'),tabby:true,chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#f0c53c'),nose:rgb('#f08a9c')},
  cream:{name:'奶油橘',base:rgb('#f1c48a'),light:rgb('#fff4e2'),stripe:rgb('#d9a468'),tabby:true,chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#c9a03a'),nose:rgb('#f4a0a8')},
  gray:{name:'灰虎斑',base:rgb('#8a8f9c'),light:rgb('#e6e8ee'),stripe:rgb('#5a5f6e'),tabby:true,chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#c8b040'),nose:rgb('#e89aa8')},
  black:{name:'黑貓',base:rgb('#2a2a34'),light:rgb('#4a4a58'),eye:rgb('#f0c030'),nose:rgb('#6a4a58')},
  white:{name:'白貓',base:rgb('#f2ede6'),light:rgb('#ffffff'),eye:rgb('#4a9ad8'),nose:rgb('#f4a0b0')},
  tuxedo:{name:'賓士',base:rgb('#2a2a34'),light:rgb('#f7f2ea'),chestWhite:true,muzzleWhite:true,pawsWhite:true,eye:rgb('#e0c030'),nose:rgb('#f0a0b0')},
  calico:{name:'三花',base:rgb('#f7f2ea'),light:rgb('#ffffff'),chestWhite:true,pawsWhite:true,patches:[rgb('#e58a2a'),rgb('#2c2c34')],eye:rgb('#d0a838'),nose:rgb('#f0a0b0')},
};
const PINK=rgb('#f5a3b3'),PINK_IN=rgb('#f2939f');
function makeColorAt(coat){
  return function(t){
    const tag=t.tag,n=t.n,l=t.loc||[0,0,0];
    if(tag==='eye')return coat.eye;
    if(tag==='pupil')return[22,16,18];
    if(tag==='nose')return coat.nose;
    if(tag==='earIn')return PINK_IN;
    let c=coat.base;
    // 淺色部位
    if(tag==='paw'&&coat.pawsWhite)return coat.light;
    if(tag==='muzzle'&&coat.muzzleWhite)return coat.light;
    if(tag==='head'&&coat.muzzleWhite&&l[0]>6.5&&l[1]<1.2)return coat.light;
    if(tag==='body'&&coat.chestWhite&&t.cen[0]>6&&n[1]<.25)c=coat.light;
    if((tag==='body'||tag==='leg')&&n[1]<-.35)c=mixc(c,coat.light,.7);          // 腹部
    if(tag==='leg'&&coat.pawsWhite&&t.u>.72)c=coat.light;
    // 虎斑條紋
    if(coat.tabby){
      const s=coat.stripe;
      if(tag==='body'&&Math.sin(t.cen[0]*.7+1)>.5&&n[1]>-.05)return s;
      if(tag==='tail'&&Math.sin(t.u*Math.PI*8)>.3)return s;
      if(tag==='leg'&&t.u<.72&&Math.sin(t.cen[1]*.75)>.55)return s;
      if(tag==='head'){
        if(l[1]>2.6&&Math.abs(l[2])<5.5&&Math.sin(l[2]*1.7)>.2&&l[0]<8)return s;    // 額頭的 M 紋
        if(Math.abs(l[2])>6&&l[0]>-1&&l[0]<7&&l[1]<3&&l[1]>-2&&Math.sin(l[0]*2.2)>.2)return s;   // 臉頰紋
      }
    }
    // 三花色塊
    if(coat.patches&&tag!=='paw'){
      const q=vnoise(t.cen[0]*.09+3,t.cen[1]*.09,t.cen[2]*.09+7);
      if(q>.6)return coat.patches[0];
      if(q<.27)return coat.patches[1];
    }
    return c;
  };
}

/* ---- ../cat/head.js ---- */
'use strict';
/* 頭部網格:頭骨放樣、耳朵、鼻子、眼睛、鬍鬚。局部座標朝 +x,原點在頭中心。 */
const HEAD_X=[-9,-5,-1,3,6.5,9.5,11.5];
const HEAD_Y=[.6,.4,0,-.5,-1.4,-2.4,-3.0];
const HEAD_R=[[6.4,6.8],[8.2,9.0],[8.6,9.8],[8.0,9.4],[6.4,7.2],[4.6,4.9],[3.2,3.4]];
function headSurfaceHalfWidth(x,y){
  let i=0;while(i<HEAD_X.length-2&&x>HEAD_X[i+1])i++;
  const t=Math.min(1,Math.max(0,(x-HEAD_X[i])/(HEAD_X[i+1]-HEAD_X[i])));
  const a=HEAD_R[i][0]+(HEAD_R[i+1][0]-HEAD_R[i][0])*t,b=HEAD_R[i][1]+(HEAD_R[i+1][1]-HEAD_R[i][1])*t;
  const yc=HEAD_Y[i]+(HEAD_Y[i+1]-HEAD_Y[i])*t,h=(y-yc)/a;
  return b*Math.sqrt(Math.max(0,1-h*h));
}
function buildHead(blink){
  const m=new Mesh();m.anchor=[0,0,0];
  tube(m,HEAD_X.map((x,i)=>[x,HEAD_Y[i],0]),HEAD_R,{tag:'head',sides:10});
  // 鼻子
  const N=[[11.6,-1.3,-1.6],[11.6,-1.3,1.6],[11.9,-3.0,0]],D=[12.9,-2.0,0],ins=[10.5,-2,0];
  m.tri(N[0],N[1],D,'nose',ins);m.tri(N[1],N[2],D,'nose',ins);m.tri(N[2],N[0],D,'nose',ins);m.tri(N[0],N[2],N[1],'nose',ins);
  [-1,1].forEach(s=>{
    // 耳朵:四角錐,前面是粉色內耳
    const bx=-3.2,by=6.2,bz=s*5.4;
    const fo=[bx+3.1,by,bz+3.6*s],fi=[bx+3.1,by,bz-3.6*s],bo=[bx-2.6,by,bz+3.9*s],bi=[bx-2.6,by,bz-3.9*s],A=[bx-0.6,by+8.6,bz+1.9*s];
    const cin=[bx,by+1,bz];
    m.tri(fo,fi,A,'earIn',cin);m.tri(bo,bi,A,'ear',cin);m.tri(fo,bo,A,'ear',cin);m.tri(fi,bi,A,'ear',cin);
    // 眼睛:貼在臉側的八角形,加一條直立瞳孔
    const ex=5.2,ey=1.0,ez=s*(headSurfaceHalfWidth(ex,ey)*.96+.45);
    const C=[ex,ey,ez],n=V.norm([.5,.05,s*.87]);
    const up=V.norm(V.sub([0,1,0],V.mul(n,V.dot([0,1,0],n)))),sd=V.cross(n,up),bk=Math.max(.12,blink);
    const ru=2.9*bk,rv=3.3,ring=[];
    for(let k=0;k<8;k++){const th=Math.PI*2*k/8;ring.push(V.add(C,V.add(V.mul(up,ru*Math.cos(th)),V.mul(sd,rv*Math.sin(th)))));}
    const inside=V.sub(C,V.mul(n,3));
    for(let k=0;k<8;k++)m.tri(C,ring[k],ring[(k+1)%8],'eye',inside,{double:true});
    if(blink>.5){
      const c2=V.add(C,V.mul(n,.15)),pr=[V.add(c2,V.mul(up,ru*.9)),V.add(c2,V.mul(sd,.65)),V.sub(c2,V.mul(up,ru*.9)),V.sub(c2,V.mul(sd,.65))];
      m.tri(pr[0],pr[1],pr[2],'pupil',inside,{double:true});m.tri(pr[0],pr[2],pr[3],'pupil',inside,{double:true});
    }
    // 鬍鬚:從口鼻側面往後方展開
    [2.2,.2,-2.0].forEach(dy=>m.line([9.6,-2.5,s*3.4],[5.8,-2.5+dy,s*10.5],'whisker'));
  });
  return m;
}

/* ---- ../cat/rig.js ---- */
'use strict';
/* 貓的骨架與網格:依姿勢(走路/坐下)、相位、尾巴擺動建立 Mesh。 */
function attach(dst,src,center,tilt,sc=1){
  const cs=Math.cos(tilt),sn=Math.sin(tilt);
  const T=p=>[(p[0]*cs-p[1]*sn)*sc+center[0],(p[0]*sn+p[1]*cs)*sc+center[1],p[2]*sc+center[2]];
  const R=n=>[n[0]*cs-n[1]*sn,n[0]*sn+n[1]*cs,n[2]];
  src.tris.forEach(t=>dst.tris.push(Object.assign({},t,{p:t.p.map(T),n:R(t.n),cen:T(t.cen)})));
  src.lines.forEach(l=>dst.lines.push({p:l.p.map(T),tag:l.tag}));
}
const LEGTAG=u=>u>.78?'paw':'leg';
function footCycle(theta,A,H){
  const s=((theta%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  if(s<Math.PI)return[A*(1-2*s/Math.PI),0];
  const q=(s-Math.PI)/Math.PI;return[A*(-1+2*q),H*Math.sin(q*Math.PI)];
}
function frontLeg(m,S,foot,z){
  const P=[16+foot[0],foot[1],z],W=[P[0]-.3,P[1]+8.6,z],E=ik2([S[0],S[1],z],W,10.6,10.6,-1);
  const path=[[S[0],S[1]+1,z],E,W,[W[0]+.3,P[1]+2.5,z],[P[0]+2.2,P[1]+1.1,z]];
  m.anchor=[0,0,0];
  ellipsoid(m,[S[0],S[1]-.5,z],6.4,7.4,4.4,'leg',{rows:4,sides:8});
  tube(m,path,[[4.8,4.2],[4.0,3.6],[3.0,2.8],[3.6,3.2],[4.0,3.1]],{tagAt:LEGTAG,sides:8,smooth:2});
}
function hindLeg(m,Hh,foot,z){
  const P=[-12+foot[0],foot[1],z],H=[P[0]-1.2,P[1]+9.8,z],K=ik2([Hh[0],Hh[1],z],H,11.8,11.8,1);
  const path=[[Hh[0],Hh[1]+1,z],K,H,[H[0]+.6,P[1]+2.6,z],[P[0]+2.2,P[1]+1.1,z]];
  m.anchor=[0,0,0];
  ellipsoid(m,[Hh[0]+.5,Hh[1]-.5,z*1.02],8.6,8.6,5.2,'leg',{rows:4,sides:8});
  tube(m,path,[[5.2,4.6],[4.2,3.8],[2.9,2.7],[3.6,3.2],[4.0,3.1]],{tagAt:LEGTAG,sides:8,smooth:2});
}
function rigWalk(m,o){
  const ph=o.phase,wob=Math.sin(ph*2)*.45;
  m.anchor=[0,0,0];
  const spine=[[-19,29.2+wob,0],[-10,30.0,0],[0,29.6,0],[9,29.6,0],[17,30.6,0],[24,34.8,0]];
  tube(m,spine,[[8.6,7.8],[10.2,9.0],[9.8,8.6],[9.9,9.1],[11.4,10.0],[7.6,7.4]],{tag:'body',sides:10,smooth:3});
  const sw=o.tail;
  const tp=[[-19,31,0],[-26,32.5,0],[-31,35.5,sw*1.5],[-34,41,sw*4],[-34.5,47,sw*6],[-32.5,52,sw*7]];
  tube(m,tp,[[3.8,3.6],[3.4,3.2],[3.0,2.9],[2.7,2.6],[2.5,2.4],[1.9,1.9]],{tag:'tail',sides:8,smooth:2});
  const A=7,H=5.2;
  // 對角腳同時動
  frontLeg(m,[14.5,27.6],footCycle(ph+Math.PI,A,H),-5.4);
  hindLeg(m,[-14,26.6],footCycle(ph,A,H),-5.8);
  const head=buildHead(o.blink);
  attach(m,head,[35,40+wob*.6,0],-.12,1.4);
  frontLeg(m,[14.5,27.6],footCycle(ph,A,H),5.4);
  hindLeg(m,[-14,26.6],footCycle(ph+Math.PI,A,H),5.8);
}
function rigSit(m,o){
  const s=o.side||1,sw=o.tail;
  m.anchor=[0,0,0];
  // 尾巴貼地,繞到身體前面
  const tp=[[-16,3.6,0],[-24,3.4,s*4],[-27,3.2,s*12],[-21,3.2,s*19],[-11,3.2,s*22],[-2,3.3,s*(20+sw*3)]];
  tube(m,tp,[[3.5,3.5],[3.4,3.4],[3.3,3.3],[3.1,3.1],[2.8,2.8],[2.3,2.3]],{tag:'tail',sides:8,ref:[0,1,0],smooth:2});
  // 後腿:大腿(橢球)與向前的腳掌
  [-1,1].forEach(z=>{
    ellipsoid(m,[-8,7.4,z*8.6],9.4,7.6,5.4,'leg',{rows:4,sides:8});
    ellipsoid(m,[1.8,1.7,z*7.8],6.0,1.9,2.9,'paw',{rows:3,sides:8});
  });
  const spine=[[-15,7.5,0],[-11,13.5,0],[-6,21,0],[0,29,0],[5,36,0],[8.5,42,0]];
  tube(m,spine,[[8.6,9.8],[9.6,10.4],[9.6,9.9],[10.2,9.6],[9.6,8.8],[7.4,6.8]],{tag:'body',sides:10,smooth:3});
  [-1,1].forEach(z=>{
    const path=[[5.4,29.5,z*4.7],[6.4,18,z*4.7],[8,7,z*4.7],[9.3,3.4,z*4.7],[11.4,1.4,z*4.7]];
    tube(m,path,[[5.8,5.4],[4.4,4.2],[3.5,3.3],[3.9,3.5],[4.3,3.5]],{tagAt:LEGTAG,sides:8,smooth:2});
  });
  const head=buildHead(o.blink);
  attach(m,head,[12.5,51.5,0],.02,1.42);
}
function buildCat(o){
  const m=new Mesh();
  if(o.act==='sit'){rigSit(m,o);shiftMesh(m,2.5);}else{rigWalk(m,o);shiftMesh(m,-4);}
  return m;
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
const _colorFns={};
function drawCat(c,o){
  const t=o.t||0,coat=o.coat||'orange';
  const cf=_colorFns[coat]||(_colorFns[coat]=makeColorAt(COATS[coat]));
  const mesh=buildCat({act:o.act,phase:t*6,tail:Math.sin(t*2.2)*.5,blink:o.blink===undefined?1:o.blink,side:o.dir==='left'?-1:1});
  renderMesh(c,mesh,{dir:o.dir,pitch:o.pitch},cf);
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
