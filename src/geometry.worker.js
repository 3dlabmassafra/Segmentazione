import { splitCurved } from './curve-math.js';
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
let lib, original;
const ready = Module({locateFile: () => wasmUrl}).then(m => {m.setup(); lib = m;});
function pack(solid) {
  const m = solid.getMesh();
  const positions = new Float32Array(m.numVert * 3);
  for(let i=0;i<m.numVert;i++) for(let a=0;a<3;a++) positions[3*i+a] = m.vertProperties[m.numProp*i+a];
  return {positions, indices: new Uint32Array(m.triVerts), bounds:solid.boundingBox(), volume:solid.volume(), triangles:solid.numTri()};
}
function validate(solid) {
  if(solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) {
    solid.delete();
    throw new Error('La mesh non è un solido chiuso valido. Ripara buchi, facce invertite o bordi non-manifold nel tuo slicer e riprova.');
  }
}
function demo() {
  const radius = z => 38 + 22*Math.sin(Math.PI*z/210) + 5*Math.sin(2*Math.PI*z/180);
  const p=[[0,0]];
  for(let z=0;z<=180;z+=3) p.push([radius(z),z]);
  for(let z=180;z>=3;z-=3) p.push([radius(z)-3,z]);
  p.push([0,3]);
  const base=lib.Manifold.revolve([p],384);
  const ribbed=base.warp(v=>{
    const r=Math.hypot(v[0],v[1]);
    if(r<.01) return;
    const a=Math.atan2(v[1],v[0]);
    const delta=1.35*Math.cos(48*a+v[2]*.018);
    v[0]*=(r+delta)/r;v[1]*=(r+delta)/r;
  });
  base.delete();
  return ribbed;
}
self.onmessage = async ({data}) => {
  const {id,type}=data;
  try {
    await ready;
    if(type==='demo'||type==='import') {
      let next;
      if(type==='demo') next=demo();
      else {
        if(!data.positions.length || data.positions.length>4500000 || !data.positions.every(Number.isFinite)) throw new Error('STL vuoto, non valido o oltre il limite di 500.000 triangoli.');
        const n=data.positions.length/3;
        const mesh=new lib.Mesh({numProp:3,vertProperties:data.positions,triVerts:Uint32Array.from({length:n},(_,i)=>i)});
        mesh.merge();
        try {next=new lib.Manifold(mesh);} catch(e) {throw new Error('La mesh non è chiusa o contiene geometrie non valide. Ripara il file STL nel tuo slicer prima di importarlo.');}
      }
      validate(next);
      const b=next.boundingBox();
      const dims=b.max.map((v,i)=>v-b.min[i]);
      if(Math.max(...dims)>100000 || Math.min(...dims)<.001) {next.delete();throw new Error('Dimensioni fuori intervallo. Controlla la scala del modello: le unità sono millimetri.');}
      const normalized=next.translate([-(b.min[0]+b.max[0])/2,-(b.min[1]+b.max[1])/2,-b.min[2]]);
      next.delete();
      if(original) original.delete();
      original=normalized;
      self.postMessage({id,result:pack(original)});
    } else if(type==='curve-cut') {
      if(!original) throw new Error('Carica prima un modello.');
      const solids=splitCurved(lib,original,data.curve);
      try { self.postMessage({id,result:solids.map(pack)}); }
      finally { solids.forEach(s=>s.delete()); }
    } else if(type==='cut') {
      if(!original) throw new Error('Carica prima un modello.');
      const planes=[...data.planes].sort((a,b)=>a-b);
      const bounds=original.boundingBox();
      if(![0,1,2].includes(data.axis) || planes.length>5 || planes.some((p,i)=>!Number.isFinite(p)||p<=bounds.min[data.axis]||p>=bounds.max[data.axis]||(i>0&&p-planes[i-1]<.001))) throw new Error('I piani devono essere distinti e interni al modello.');
      const normal=[0,0,0];normal[data.axis]=1;
      let remaining=original;const solids=[];
      try {
        for(const plane of planes) {
          const [upper,lower]=remaining.splitByPlane(normal,plane);
          if(remaining!==original) remaining.delete();
          remaining=upper;
          if(!lower.isEmpty()) solids.push(lower); else lower.delete();
        }
        if(!remaining.isEmpty()) solids.push(remaining);else if(remaining!==original) remaining.delete();
        const result=solids.map(pack);
        self.postMessage({id,result});
      } finally {for(const s of solids) if(s!==original) s.delete();}
    }
  } catch(error) {self.postMessage({id,error:error.message||'Impossibile elaborare questo modello.'});}
};
