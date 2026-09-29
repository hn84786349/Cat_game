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
