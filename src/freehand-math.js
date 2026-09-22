// A stroke is drawn on the camera's reference plane. The cutter follows the
// camera rays, so its boundary matches the user's stroke even in perspective.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const len=a=>Math.hypot(...a);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function boundingCorners(bounds){return Array.from({length:8},(_,i)=>[0,1,2].map(a=>((i>>a)&1)?bounds.max[a]:bounds.min[a]));}
export function frameBounds(bounds,frame){
  const points=boundingCorners(bounds).map(p=>{
    const d=sub(p,frame.origin),z=dot(d,frame.w),scale=frame.perspective?frame.distance/(frame.distance-z):1;
    return [dot(d,frame.u)*scale,dot(d,frame.v)*scale,z];
  });
  return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
export function validateFrame(f){
  if(!f||!['origin','u','v','w'].every(k=>Array.isArray(f[k])&&f[k].length===3&&f[k].every(Number.isFinite))||!Number.isFinite(f.distance)||f.distance<=0)throw Error('Vista di disegno non valida.');
  if(['u','v','w'].some(k=>Math.abs(len(f[k])-1)>1e-5)||Math.abs(dot(cross(f.u,f.v),f.w)-1)>1e-5)throw Error('Orientamento di taglio non valido.');
}
function pointSegmentDistance(p,a,b){const v=sub(b,a),l=dot(v,v);const t=l?Math.max(0,Math.min(1,dot(sub(p,a),v)/l)):0;return distance(p,a.map((n,i)=>n+v[i]*t));}
function simplify(points,epsilon){
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){const [a,b]=stack.pop();let best=epsilon,index=-1;for(let i=a+1;i<b;i++){const d=pointSegmentDistance(points[i],points[a],points[b]);if(d>best){best=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
function intersect(a,b,c,d,eps){
  const orient=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if(((o1>eps&&o2 < -eps)||(o1 < -eps&&o2>eps))&&((o3>eps&&o4 < -eps)||(o3 < -eps&&o4>eps)))return true;
  const on=(p,q,r)=>r[0]>=Math.min(p[0],q[0])-eps&&r[0]<=Math.max(p[0],q[0])+eps&&r[1]>=Math.min(p[1],q[1])-eps&&r[1]<=Math.max(p[1],q[1])+eps;
  return (Math.abs(o1)<=eps&&on(a,b,c))||(Math.abs(o2)<=eps&&on(a,b,d))||(Math.abs(o3)<=eps&&on(c,d,a))||(Math.abs(o4)<=eps&&on(c,d,b));
}
function simple(points,closed=false){
  const n=points.length-(closed?0:1),span=Math.max(...points.flat().map(Math.abs),1),eps=span*1e-9;
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(closed&&i===0&&j===n-1)continue;
    if(intersect(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length],eps))return false;
  }
  return true;
}
function rayToBox(p,d,rect){
  const [L,B,R,T]=rect,candidates=[];
  for(let axis=0;axis<2;axis++)if(Math.abs(d[axis])>1e-12){
    for(const value of axis===0?[L,R]:[B,T]){
      const t=(value-p[axis])/d[axis];if(t<=0)continue;
      const q=[p[0]+t*d[0],p[1]+t*d[1]];
      if(q[0]>=L-1e-7&&q[0]<=R+1e-7&&q[1]>=B-1e-7&&q[1]<=T+1e-7)candidates.push({t,q});
    }
  }
  candidates.sort((a,b)=>a.t-b.t);if(!candidates.length)throw Error('Impossibile prolungare il tratto. Ridisegna gli estremi verso l’esterno del modello.');return candidates[0].q;
}
function perimeter(p,r){const [L,B,R,T]=r,W=R-L,H=T-B;const d=[Math.abs(p[1]-B),Math.abs(p[0]-R),Math.abs(p[1]-T),Math.abs(p[0]-L)];switch(d.indexOf(Math.min(...d))){case 0:return p[0]-L;case 1:return W+p[1]-B;case 2:return W+H+R-p[0];default:return 2*W+H+T-p[1];}}
export function prepareStroke(bounds,cut){
  validateFrame(cut.frame);
  if(!Array.isArray(cut.points)||cut.points.length<2||cut.points.length>4096||cut.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw Error('Traccia un percorso continuo sul modello.');
  const fb=frameBounds(bounds,cut.frame);
  if(cut.frame.perspective&&fb.max[2]>=cut.frame.distance*.95)throw Error('La camera è troppo vicina. Allontanati dal modello e ridisegna.');
  const span=Math.max(fb.max[0]-fb.min[0],fb.max[1]-fb.min[1],.01);
  let points=cut.kind==='line'?[cut.points[0],cut.points.at(-1)]:cut.points;
  points=points.filter((p,i)=>!i||distance(p,points[i-1])>span*1e-6);
  if(points.length<2||distance(points[0],points.at(-1))<span*.015)throw Error('Disegna una linea aperta con estremi distinti, non un anello chiuso.');
  points=simplify(points,span/2000);
  if(points.length>512){points=Array.from({length:512},(_,i)=>points[Math.round(i*(points.length-1)/511)]);}
  if(cut.kind!=='line'&&cut.smooth){
    for(let pass=0;pass<Math.min(2,cut.smooth);pass++){
      const smooth=[points[0]];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];smooth.push(a.map((v,j)=>.75*v+.25*b[j]),a.map((v,j)=>.25*v+.75*b[j]));}smooth.push(points.at(-1));points=simplify(smooth,span/3000);
    }
  }
  const pad=span*.15;
  const rect=[Math.min(fb.min[0],...points.map(p=>p[0]))-pad,Math.min(fb.min[1],...points.map(p=>p[1]))-pad,Math.max(fb.max[0],...points.map(p=>p[0]))+pad,Math.max(fb.max[1],...points.map(p=>p[1]))+pad];
  const first=rayToBox(points[0],sub(points[0],points[1]),rect);
  const last=rayToBox(points.at(-1),sub(points.at(-1),points.at(-2)),rect);
  const seam=[first,...points,last];
  if(!simple(seam))throw Error('Il percorso o i suoi prolungamenti si incrociano. Ridisegna una linea aperta senza incroci.');
  const [L,B,R,T]=rect,W=R-L,H=T-B,P=2*(W+H);
  const ta=perimeter(first,rect),tb=perimeter(last,rect),end=ta<=tb?ta+P:ta;
  const corners=[{p:[L,B],t:0},{p:[R,B],t:W},{p:[R,T],t:W+H},{p:[L,T],t:2*W+H}];
  const arc=corners.map(c=>({...c,t:c.t<=tb?c.t+P:c.t})).filter(c=>c.t<end-1e-8).sort((a,b)=>a.t-b.t).map(c=>c.p);
  let polygon=[...seam,...arc];
  if(!simple(polygon,true))throw Error('Gli estremi producono un contorno ambiguo. Traccia il taglio attraversando il modello da un bordo all’altro.');
  const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-a[1]*b[0];},0);
  if(Math.abs(area)<span*span*1e-8)throw Error('Il tratto è troppo corto per un taglio.');
  if(area<0)polygon=polygon.toReversed();
  return {seam,polygon,frameBounds:fb};
}
export function strokeWorld(frame,point,depth=0){
  const scale=frame.perspective?(frame.distance-depth)/frame.distance:1;
  return frame.origin.map((v,i)=>v+frame.u[i]*point[0]*scale+frame.v[i]*point[1]*scale+frame.w[i]*depth);
}
export function freehandCutter(lib,bounds,cut){
  const {polygon,frameBounds:fb}=prepareStroke(bounds,cut),f=cut.frame;
  const span=Math.max(...bounds.max.map((v,i)=>v-bounds.min[i]),.01),pad=span*.05;
  const low=fb.min[2]-pad,high=fb.max[2]+pad;
  const s0=f.perspective?(f.distance-low)/f.distance:1,s1=f.perspective?(f.distance-high)/f.distance:1;
  if(s1<=0)throw Error('Allontana la camera dal modello prima di disegnare.');
  const extrusion=lib.Manifold.extrude([polygon.map(p=>p.map(n=>n*s0))],high-low,0,0,[s1/s0,s1/s0]);
  try {
    const translation=f.origin.map((v,i)=>v+f.w[i]*low);
    return extrusion.transform([...f.u,0,...f.v,0,...f.w,0,...translation,1]);
  } finally {extrusion.delete();}
}
export function splitFreehand(lib,original,cuts){
  if(!Array.isArray(cuts)||cuts.length>8)throw Error('Sono supportati fino a 8 tagli per progetto.');
  const enabled=cuts.filter(c=>c.enabled!==false);
  let solids=[original];
  try {
    for(const cut of enabled){
      const cutter=freehandCutter(lib,original.boundingBox(),cut),next=[];let splits=0;
      try {
        for(const solid of solids){
          const pair=solid.split(cutter);
          const valid=pair.filter(p=>!p.isEmpty()&&p.volume()>0);
          pair.filter(p=>!valid.includes(p)).forEach(p=>p.delete());
          if(valid.length===2)splits++;
          next.push(...valid);
        }
      } catch(e){next.forEach(s=>s.delete());throw e;}
      finally {cutter.delete();}
      if(!splits){next.forEach(s=>s.delete());throw Error(`Il taglio «${cut.name||'senza nome'}» non divide il modello. Ridisegnalo o disattivalo.`);}
      solids.forEach(s=>{if(s!==original)s.delete();});solids=next;
      if(solids.length>32)throw Error('Sono state generate più di 32 parti. Riduci il numero di tagli.');
    }
    if(!enabled.length)return [original];
    const components=[];
    try {for(const s of solids)components.push(...s.decompose());}
    catch(e){components.forEach(s=>s.delete());throw e;}
    solids.forEach(s=>{if(s!==original)s.delete();});solids=components;
    if(solids.length>32)throw Error('La mesh contiene più di 32 componenti risultanti. Riduci i tagli o separa il modello.');
    if(solids.some(s=>s.status()!=='NoError'))throw Error('Il taglio non ha prodotto solidi validi.');
    return solids;
  } catch(e){solids.forEach(s=>{if(s!==original)s.delete();});throw e;}
}
