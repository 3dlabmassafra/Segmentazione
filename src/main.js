import './style.css';
import {FRAMES, newCurve, curveSamples, localToWorld} from './curve-math.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import {createIcons,ChevronRight,CircleHelp,Plus,Download,SlidersHorizontal,FolderOpen,Upload,Box,CircleCheck,Sparkles,Scissors,Info,ShieldCheck,CircleAlert,Scan,ScanLine,Grid2x2,ArrowDownToLine,Mouse,Layers2,Check,Lightbulb,Printer,ArrowUpRight,X,ArrowRight} from 'lucide';
const icons={ChevronRight,CircleHelp,Plus,Download,SlidersHorizontal,FolderOpen,Upload,Box,CircleCheck,Sparkles,Scissors,Info,ShieldCheck,CircleAlert,Scan,ScanLine,Grid2x2,ArrowDownToLine,Mouse,Layers2,Check,Lightbulb,Printer,ArrowUpRight,X,ArrowRight};
import { zipSync, strToU8 } from 'fflate';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const refreshIcons=()=>createIcons({icons,attrs:{'stroke-width':1.7}});
refreshIcons();
const palette=['#bdcec5','#cdb6a4','#b1c2dd','#d8cae0','#d7ceab','#a5c8ca'];
const state={mode:'curve',appliedMode:'curve',curve:newCurve(),appliedCurve:null,editing:false,curvePoint:1,original:null,parts:[],axis:2,appliedAxis:2,planes:[60,120],appliedPlanes:[],name:'Vaso Onda',demo:true,busy:true,dirty:false,selected:-1,wire:false};
let toastTimer;
function toast(message,error=false){const el=$('#toast');el.querySelector('span').textContent=message;el.classList.toggle('error',error);el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),error?8500:4500);}
function loading(on,text='Elaborazione del modello…') {state.busy=on;$('#loading').hidden=!on;$('#loading-text').textContent=text;$('#engine-status').textContent=on?'Elaborazione in corso…':'Motore pronto';updateButtons();}
function updateButtons(){for(const s of ['#apply-cuts','#open-file','#upload-zone','#add-plane','#reset-project','#load-demo']) $(s).disabled=state.busy;$('#add-plane').disabled=state.busy||state.planes.length>=5;$('#export-all').disabled=state.busy||state.dirty||!state.parts.length;$$('[data-download]').forEach(b=>b.disabled=state.busy||state.dirty);$$('[data-axis], .plane-slider, .plane-number, [data-remove], [data-mode], [data-preset], #curve-frame, #edit-curve, #point-u, #point-v, #curve-point-select, #exit-curve, #quick-curve-cut').forEach(b=>b.disabled=state.busy);}
function markDirty(){const redraw=!state.dirty&&!state.editing;state.dirty=true;$('#dirty-banner').hidden=false;$('#results-status').textContent='Anteprima da aggiornare';updateButtons();if(redraw)drawParts();else updatePlanes();}
const fmt=n=>new Intl.NumberFormat('it-IT',{maximumFractionDigits:1}).format(n);
const sizeOf=b=>b.max.map((v,i)=>v-b.min[i]);
const dimensions=b=>sizeOf(b).map(fmt).join(' × ');
const num=n=>n.toLocaleString('it-IT');
const escapeHtml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName=s=>s.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,80)||'modello';
const worker=new Worker(new URL('./geometry.worker.js',import.meta.url),{type:'module'});
let taskId=0;const pending=new Map();
worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error)p.reject(new Error(data.error));else p.resolve(data.result);};
worker.onerror=e=>{for(const p of pending.values())p.reject(new Error('Il motore 3D non è disponibile. Ricarica la pagina e riprova.'));pending.clear();};
function request(type,data={}){return new Promise((resolve,reject)=>{const id=++taskId;pending.set(id,{resolve,reject});worker.postMessage({id,type,...data});});}

// All processing and rendering stay on this device.
const scene=new THREE.Scene();
const container=$('#canvas-container');
const camera=new THREE.PerspectiveCamera(33,1,.1,10000);camera.up.set(0,0,1);
const curveCamera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10000);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;container.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.maxPolarAngle=Math.PI*.94;controls.minDistance=10;controls.maxDistance=100000;controls.target.set(0,0,100);
scene.add(new THREE.HemisphereLight(0xffffff,0xc2c5cc,2));
const key=new THREE.DirectionalLight(0xfff6ea,3.2);key.position.set(-250,-300,420);scene.add(key);
const fill=new THREE.DirectionalLight(0xe6edff,1.5);fill.position.set(250,120,200);scene.add(fill);
const rim=new THREE.DirectionalLight(0xffffff,2);rim.position.set(0,250,400);scene.add(rim);
const group=new THREE.Group();scene.add(group);const planesGroup=new THREE.Group();scene.add(planesGroup);
let grid;
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d');const grad=ctx.createRadialGradient(64,64,0,64,64,64);grad.addColorStop(0,'rgba(63,78,99,0.20)');grad.addColorStop(.45,'rgba(63,78,99,0.09)');grad.addColorStop(1,'rgba(63,78,99,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.position.z=-.3;scene.add(shadow);
const ro=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();if(state.editing)updateCurveCamera();});ro.observe(container);
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,state.editing?curveCamera:camera);});
function geometryFor(part){let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(part.positions,3));g.setIndex(new THREE.BufferAttribute(part.indices,1));const smooth=toCreasedNormals(g,Math.PI/3);if(smooth!==g)g.dispose();return smooth;}
function disposeGroup(g){while(g.children.length){const child=g.children[0];child.traverse(o=>{o.geometry?.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{m.map?.dispose();m.dispose();});}});g.remove(child);}}
function drawParts(){disposeGroup(group);const preview=state.editing||state.dirty;const parts=preview&&state.original?[state.original]:state.parts;parts.forEach((part,i)=>{const mesh=new THREE.Mesh(geometryFor(part),new THREE.MeshStandardMaterial({color:preview?'#c9d1df':palette[i%palette.length],roughness:.74,metalness:.04,wireframe:state.wire}));mesh.userData.part=preview?-1:i;group.add(mesh);});updateExplosion();updateSelection();}
function setGrid(){if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}const d=sizeOf(state.original.bounds);const size=Math.max(...d)*3;grid=new THREE.GridHelper(size,30,0xc4cedd,0xdde3ec);grid.rotation.x=Math.PI/2;grid.position.z=-.6;grid.material.transparent=true;grid.material.opacity=.36;grid.material.depthWrite=false;grid.visible=$('#grid-view').classList.contains('active');scene.add(grid);shadow.scale.set(Math.max(d[0],d[1])*2.1,Math.max(d[0],d[1])*2.1,1);}
function gap(){return $('#explode').checked?Number($('#separation').value):0;}
function updateExplosion(){const axis=state.appliedAxis;group.children.forEach((m,i)=>{m.position.set(0,0,0);if(!state.editing&&!state.dirty)m.position.setComponent(axis,(i-(axis===2?0:(state.parts.length-1)/2))*gap());});updatePlanes();}
function fitView(top=false){if(state.editing){updateCurveCamera();return;}if(!state.parts.length)return;const bounds=new THREE.Box3().setFromObject(group);const center=bounds.getCenter(new THREE.Vector3());const size=bounds.getSize(new THREE.Vector3());const vfov=camera.fov*Math.PI/180;const hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect);const distance=Math.max(size.z/2/Math.tan(vfov/2),Math.max(size.x,size.y)/2/Math.tan(hfov/2),size.length()*.75)*(camera.aspect<.8?1.88:1.6);if(camera.aspect<.8)center.z+=size.z*.025;controls.target.copy(center);if(top){camera.position.copy(center).add(new THREE.Vector3(.001,-.001,distance*1.1));$('#camera-label').textContent='Dall’alto';}else{camera.position.copy(center).add(new THREE.Vector3(1,-1.6,.95).normalize().multiplyScalar(distance));$('#camera-label').textContent='Prospettiva';}camera.near=Math.max(.01,distance/1000);camera.far=distance*50;camera.updateProjectionMatrix();controls.update();}
controls.addEventListener('start',()=>$('#camera-label').textContent='Prospettiva');
function textSprite(text){const c=document.createElement('canvas');c.width=256;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='rgba(247,250,255,0.94)';ctx.beginPath();ctx.roundRect(0,0,256,64,12);ctx.fill();ctx.strokeStyle='#bdcce8';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#859bbf';ctx.font='500 24px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,128,33);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,toneMapped:false}));return sprite;}
function updatePlanes(){disposeGroup(planesGroup);if(!state.original||!$('#show-planes').checked)return;if(state.mode==='curve'){if(!state.editing)drawCurveSurface();return;}const b=state.original.bounds,dim=sizeOf(b);const axis=state.axis;const other=[0,1,2].filter(a=>a!==axis);const w=dim[other[0]]*1.42,h=dim[other[1]]*1.28;const max=Math.max(...dim);[...state.planes].sort((a,b)=>a-b).forEach((value,i)=>{const center=new THREE.Vector3(...b.min.map((v,a)=>(v+b.max[a])/2));center.setComponent(axis,value);if(!state.dirty&&axis===state.appliedAxis)center.setComponent(axis,value+(i+.5-(axis===2?0:(state.parts.length-1)/2))*gap());const p=new THREE.Group();const geom=new THREE.PlaneGeometry(w,h);if(axis===0){geom.rotateY(Math.PI/2);geom.rotateX(Math.PI/2);}else if(axis===1)geom.rotateX(Math.PI/2);const face=new THREE.Mesh(geom,new THREE.MeshBasicMaterial({color:0x8facd8,side:THREE.DoubleSide,transparent:true,opacity:.045,depthWrite:false}));p.add(face);const edges=new THREE.EdgesGeometry(geom);const line=new THREE.LineSegments(edges,new THREE.LineDashedMaterial({color:0x93aed6,dashSize:max*.022,gapSize:max*.014,transparent:true,opacity:.56,depthWrite:false}));line.computeLineDistances();p.add(line);p.position.copy(center);const label=textSprite(`${['X','Y','Z'][axis]} · ${fmt(value-b.min[axis])} mm`);label.scale.set(max*.28,max*.07,1);label.position.setComponent(other[0],w*.53);label.position.setComponent(other[1],-h*.38);p.add(label);planesGroup.add(p);});}
function renderPlaneControls(){const b=state.original?.bounds||{min:[-60,-60,0],max:[60,60,180]};const min=b.min[state.axis],len=b.max[state.axis]-min;$('#plane-count').textContent=state.mode==='curve'?'1 CURVA':`${state.planes.length} ${state.planes.length===1?'PIANO':'PIANI'}`;$('#plane-list').innerHTML=state.planes.map((v,i)=>{const local=v-min;return `<div class="plane-item"><div class="plane-item-header"><span class="plane-index">${String(i+1).padStart(2,'0')}</span><span class="plane-name">Piano ${i+1}</span><div class="plane-value"><input class="plane-number" data-plane="${i}" type="number" value="${local.toFixed(1)}" min="${(len*.001).toFixed(3)}" max="${(len*.999).toFixed(3)}" step="0.1" aria-label="Posizione piano ${i+1} in millimetri"><span>mm</span></div><button class="icon-button" data-remove="${i}" title="Rimuovi piano ${i+1}" aria-label="Rimuovi piano ${i+1}"><i data-lucide="x"></i></button></div><input class="plane-slider" data-plane="${i}" type="range" min="${len*.001}" max="${len*.999}" step="${Math.min(.1,len/1000)}" value="${local}" style="--pct:${local/len*100}%" aria-label="Posizione piano ${i+1}"><div class="range-labels"><span>0 mm</span><span>${fmt(len)} mm</span></div></div>`;}).join('');refreshIcons();updateButtons();}
$('#plane-list').addEventListener('input',e=>{if(!e.target.matches('.plane-slider,.plane-number')||state.busy)return;const i=Number(e.target.dataset.plane);const b=state.original.bounds;const len=b.max[state.axis]-b.min[state.axis];const n=Number(e.target.value);if(!Number.isFinite(n))return;state.planes[i]=b.min[state.axis]+Math.min(len*.999,Math.max(len*.001,n));if(e.target.matches('.plane-slider')){$(`.plane-number[data-plane="${i}"]`).value=(state.planes[i]-b.min[state.axis]).toFixed(1);}else $(`.plane-slider[data-plane="${i}"]`).value=state.planes[i]-b.min[state.axis];$(`.plane-slider[data-plane="${i}"]`).style.setProperty('--pct',`${(state.planes[i]-b.min[state.axis])/len*100}%`);markDirty();});
$('#plane-list').addEventListener('change',e=>{if(e.target.matches('.plane-number'))renderPlaneControls();});
$('#plane-list').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b||state.busy)return;state.planes.splice(Number(b.dataset.remove),1);renderPlaneControls();markDirty();});
$$('[data-axis]').forEach(button=>button.addEventListener('click',()=>{if(state.busy||!state.original)return;const old=state.axis;state.axis=Number(button.dataset.axis);if(old===state.axis)return;const b=state.original.bounds;state.planes=state.planes.map(v=>b.min[state.axis]+(v-b.min[old])/(b.max[old]-b.min[old])*(b.max[state.axis]-b.min[state.axis]));$$('[data-axis]').forEach(b=>b.classList.toggle('active',b===button));$('#axis-description').textContent=['Larghezza','Profondità','Verticale'][state.axis];renderPlaneControls();markDirty();}));
$('#add-plane').onclick=()=>{if(state.busy||state.planes.length>=5)return;const b=state.original.bounds;const all=[b.min[state.axis],...state.planes,b.max[state.axis]].sort((a,b)=>a-b);let index=0;for(let i=1;i<all.length-1;i++)if(all[i+1]-all[i]>all[index+1]-all[index])index=i;state.planes.push((all[index]+all[index+1])/2);state.planes.sort((a,b)=>a-b);renderPlaneControls();markDirty();};

const thumbRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});thumbRenderer.setSize(150,150);thumbRenderer.setPixelRatio(1);thumbRenderer.toneMapping=THREE.ACESFilmicToneMapping;thumbRenderer.toneMappingExposure=1.35;
function thumbnail(part,color){const s=new THREE.Scene();s.add(new THREE.HemisphereLight(0xffffff,0xbdc4d0,2.8));const l=new THREE.DirectionalLight(0xffffff,3);l.position.set(-3,-4,7);s.add(l);const mesh=new THREE.Mesh(geometryFor(part),new THREE.MeshStandardMaterial({color,roughness:.8}));s.add(mesh);const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());const cam=new THREE.PerspectiveCamera(33,1,.01,100000);cam.up.set(0,0,1);cam.position.copy(center).add(new THREE.Vector3(1,-1.6,1.25).normalize().multiplyScalar(Math.max(...size.toArray())*2.5));cam.lookAt(center);thumbRenderer.render(s,cam);const url=thumbRenderer.domElement.toDataURL('image/png');mesh.geometry.dispose();mesh.material.dispose();return url;}
function renderResults(){const count=state.parts.length;$('#parts-count').textContent=count;$('#export-count').textContent=count;$('#total-parts').textContent=count;$('#results-status').textContent='Pronte per il prossimo passo';$('#parts-list').innerHTML=state.parts.map((p,i)=>`<article class="part-card" data-select="${i}" tabindex="0" role="button" aria-label="Seleziona parte ${i+1}"><div class="part-top"><img class="part-thumbnail" alt="Anteprima parte ${i+1}" src="${thumbnail(p,palette[i%palette.length])}"><div class="part-info"><h3><i style="background:${palette[i%palette.length]}"></i>Parte ${String(i+1).padStart(2,'0')}</h3><p>${dimensions(p.bounds)} mm</p><p class="part-triangles">${num(p.triangles)} triangoli</p></div><button class="part-download" data-download="${i}" title="Scarica parte ${i+1}" aria-label="Scarica parte ${i+1} in STL"><i data-lucide="download"></i></button></div><div class="part-bottom"><span><i data-lucide="circle-check"></i> Solido chiuso</span><b>STL · ${fmt((84+p.triangles*50)/1024)} KB</b></div></article>`).join('');$('.viewport-legend').innerHTML=state.parts.map((p,i)=>`<span><i style="background:${palette[i%palette.length]}"></i>Parte ${String(i+1).padStart(2,'0')}</span>`).join('');$('#triangle-count').textContent=`${num(state.parts.reduce((n,p)=>n+p.triangles,0))} triangoli`;refreshIcons();updateButtons();}
function updateSelection(){group.children.forEach((m,i)=>{m.material.emissive.set(m.userData.part>=0&&m.userData.part===state.selected?0x263c6e:0x000000);m.material.emissiveIntensity=.15;});$$('[data-select]').forEach(card=>{const active=Number(card.dataset.select)===state.selected;card.classList.toggle('selected',active);card.setAttribute('aria-pressed',String(active));});}
function selectPart(i){state.selected=state.selected===i?-1:i;updateSelection();}
$('#parts-list').onclick=e=>{const download=e.target.closest('[data-download]');if(download){downloadPart(Number(download.dataset.download));return;}const card=e.target.closest('[data-select]');if(card)selectPart(Number(card.dataset.select));};
$('#parts-list').onkeydown=e=>{if(e.target.matches('[data-select]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectPart(Number(e.target.dataset.select));}};
let pointerDown;renderer.domElement.addEventListener('pointerdown',e=>pointerDown=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(state.editing||!pointerDown||Math.hypot(e.clientX-pointerDown[0],e.clientY-pointerDown[1])>5)return;const r=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(group.children)[0];if(hit&&hit.object.userData.part>=0)selectPart(hit.object.userData.part);else{state.selected=-1;updateSelection();}});

async function cut(fit=false){
  if(!state.original)return;
  loading(true,state.mode==='curve'?'Calcolo del taglio curvo e chiusura delle superfici…':'Taglio e chiusura delle superfici…');
  try{
    const parts=await request(state.mode==='curve'?'curve-cut':'cut',state.mode==='curve'?{curve:state.curve}:{axis:state.axis,planes:state.planes});
    if(!parts.length)throw new Error('Nessuna parte generata. Controlla il taglio.');
    state.parts=parts;state.appliedMode=state.mode;
    state.appliedAxis=state.mode==='curve'?FRAMES[state.curve.frame].v:state.axis;
    state.appliedCurve=state.mode==='curve'?structuredClone(state.curve):null;
    state.appliedPlanes=[...state.planes];state.dirty=false;state.selected=-1;
    const wasEditing=state.editing;setCurveEditing(false,false);
    $('#dirty-banner').hidden=true;drawParts();renderResults();
    if(fit||wasEditing)fitView();return true;
  }catch(e){toast(e.message,true);return false;}finally{loading(false);}
}
$('#apply-cuts').onclick=async()=>{if(state.busy)return;if(await cut())toast(`${state.parts.length} parti generate. Le superfici di taglio sono chiuse.`);};
async function loadModel(type,positions=null,file=null){if(state.busy&&state.original)return;loading(true,type==='demo'?'Diamo forma al tuo primo progetto…':'Controllo della mesh STL…');try{const original=await request(type,positions?{positions}:{});state.original=original;state.demo=type==='demo';state.name=file?file.name.replace(/\.stl$/i,''):'Vaso Onda';state.axis=2;state.curve=newCurve();setCurveEditing(false,false);syncCurveUI();state.planes=[original.bounds.max[2]/3,original.bounds.max[2]*2/3];state.dirty=true;$('#file-name').textContent=state.name+'.stl';$('#file-meta').textContent=file?`${fmt(file.size/1024/1024)} MB · ${num(original.triangles)} triangoli`:'Modello dimostrativo';$('#model-size').textContent=dimensions(original.bounds)+' mm';$('#model-title').textContent=state.name;$('#project-title').textContent=state.demo?'Progetto senza titolo':state.name;$('#caption-kind').textContent=state.demo?'MODELLO DEMO':'IL TUO MODELLO';$('#model-subtitle').textContent=state.demo?'Un’unica forma, infinite possibilità.':'Il tuo prossimo progetto inizia qui.';$$('[data-axis]').forEach(b=>b.classList.toggle('active',Number(b.dataset.axis)===2));$('#axis-description').textContent='Verticale';$('#explode').checked=true;$('#separation').disabled=false;$('#separation').value=Math.min(18,Math.round(original.bounds.max[2]*.1));$('#separation-value').textContent=$('#separation').value;setGrid();renderPlaneControls();await cut(true);if(type==='import')toast('Modello importato. Personalizza il profilo del taglio.');}catch(e){toast(e.message,true);}finally{loading(false);}}
async function importFile(file){if(!file||state.busy)return;if(!file.name.toLowerCase().endsWith('.stl')){toast('Scegli un file STL binario o ASCII.',true);return;}if(file.size>30*1024*1024){toast('Il limite è 30 MB per file.',true);return;}try{const buffer=await file.arrayBuffer();const geometry=new STLLoader().parse(buffer);const positions=new Float32Array(geometry.attributes.position.array);geometry.dispose();if(positions.length/9>500000){toast('Il modello supera il limite di 500.000 triangoli. Riduci la mesh e riprova.',true);return;}await loadModel('import',positions,file);}catch(e){toast('Impossibile leggere il file STL. Verifica che non sia danneggiato.',true);}}
$('#open-file').onclick=$('#upload-zone').onclick=()=>$('#file-input').click();$('#file-input').onchange=async e=>{await importFile(e.target.files[0]);e.target.value='';};
let dragDepth=0;window.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('#drag-overlay').classList.add('visible');}});window.addEventListener('dragover',e=>{e.preventDefault();});window.addEventListener('dragleave',e=>{e.preventDefault();if(--dragDepth<=0)$('#drag-overlay').classList.remove('visible');});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('#drag-overlay').classList.remove('visible');importFile(e.dataTransfer.files[0]);});
$('#load-demo').onclick=()=>{if(!state.demo&&!confirm('Sostituire il modello attuale con il modello demo?'))return;loadModel('demo');};$('#reset-project').onclick=()=>{if(confirm('Iniziare un nuovo progetto? I tagli attuali verranno sostituiti dal modello demo.'))loadModel('demo');};
$('#show-planes').onchange=updatePlanes;$('#explode').onchange=()=>{updateExplosion();$('#separation').disabled=!$('#explode').checked;};$('#separation').oninput=()=>{$('#separation-value').textContent=$('#separation').value;$('#separation').style.setProperty('--pct',`${Number($('#separation').value)/70*100}%`);updateExplosion();};
$('#fit-view').onclick=()=>fitView();$('#top-view').onclick=()=>fitView(true);function setWire(wire){state.wire=wire;group.children.forEach(m=>m.material.wireframe=wire);$('#solid-view').classList.toggle('active',!wire);$('#wire-view').classList.toggle('active',wire);}$('#solid-view').onclick=()=>setWire(false);$('#wire-view').onclick=()=>setWire(true);$('#grid-view').onclick=()=>{const show=$('#grid-view').classList.toggle('active');if(grid)grid.visible=show;};

function stlBytes(part){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(part.positions.slice(),3));geometry.setIndex(new THREE.BufferAttribute(part.indices,1));const b=part.bounds;geometry.translate(-(b.min[0]+b.max[0])/2,-(b.min[1]+b.max[1])/2,-b.min[2]);const mesh=new THREE.Mesh(geometry);const output=new STLExporter().parse(mesh,{binary:true});geometry.dispose();mesh.material.dispose();return new Uint8Array(output.buffer,output.byteOffset,output.byteLength);}
function save(bytes,name,type='application/octet-stream'){const blob=new Blob([bytes],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function downloadPart(i){if(state.busy||state.dirty)return;save(stlBytes(state.parts[i]),`${safeName(state.name)}_parte_${String(i+1).padStart(2,'0')}.stl`);toast(`Parte ${String(i+1).padStart(2,'0')} esportata in STL.`);}
$('#export-all').onclick=()=>{if(state.busy||state.dirty||!state.parts.length)return;try{const files={};state.parts.forEach((p,i)=>files[`${safeName(state.name)}_parte_${String(i+1).padStart(2,'0')}.stl`]=stlBytes(p));files['profilo-taglio.json']=strToU8(JSON.stringify({version:1,units:'mm',mode:state.appliedMode,bounds:state.original.bounds,curve:state.appliedCurve,axis:state.appliedAxis,planes:state.appliedMode==='plane'?state.appliedPlanes:[]},null,2));files['LEGGIMI.txt']=strToU8(`SEZIONE — Esportazione STL\n\nModello: ${state.name}\nUnità: millimetri\n${state.appliedMode==='curve'?`Taglio curvo Bézier · vista ${FRAMES[state.appliedCurve.frame].label} · estrusione lungo ${FRAMES[state.appliedCurve.frame].depth}. Profilo approssimato con 256 segmenti. Parametri nel file profilo-taglio.json.`:`Asse di taglio: ${['X','Y','Z'][state.appliedAxis]} — Piani: ${state.appliedPlanes.map(fmt).join(', ')} mm`}\nParti: ${state.parts.length}\n\nOgni parte è centrata in X/Y, con la base a Z = 0.\nLa distanza della vista esplosa non è inclusa negli STL.\nSuperfici di taglio chiuse; nessun incastro automatico.\nUna sezione può contenere più componenti scollegate.\nControlla scala, orientamento, supporti e dimensioni nel tuo slicer.\n\n${state.parts.map((p,i)=>`Parte ${i+1}: ${dimensions(p.bounds)} mm, ${p.triangles} triangoli`).join('\n')}\n`);save(zipSync(files,{level:3}),`${safeName(state.name)}_parti.zip`,'application/zip');toast(`${state.parts.length} parti esportate in un archivio ZIP.`);}catch(e){toast('Esportazione non riuscita. Prova a scaricare le parti singolarmente.',true);}};
const dialog=$('#guide-dialog');$('#help').onclick=$('#export-help').onclick=()=>dialog.showModal();$('#close-guide').onclick=$('#start-working').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
window.addEventListener('keydown',e=>{if(dialog.open)return;if(e.key==='Escape'&&state.editing){setCurveEditing(false);return;}if((e.ctrlKey||e.metaKey)&&e.key==='o'){e.preventDefault();if(!state.busy)$('#file-input').click();return;}if(e.target.matches('input,textarea,button,select')||e.target.closest('[data-curve-point]')||state.busy)return;if(e.key.toLowerCase()==='r')fitView();if(e.key.toLowerCase()==='w')setWire(!state.wire);if(e.key==='Enter'&&state.dirty)$('#apply-cuts').click();});
setupCurveEditor();
syncCurveUI();
loadModel('demo');

// Curved cuts: an editable cubic Bézier in an orthographic view, extruded
// across the full depth of the solid. The worker uses the same samples.
function syncCurveUI(){
  const curved=state.mode==='curve';
  $('#straight-controls').hidden=curved;$('#curve-controls').hidden=!curved;
  $$('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===state.mode);b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode));});
  $('#plane-count').textContent=curved?'1 CURVA':`${state.planes.length} PIANI`;
  $('#curve-frame').value=state.curve.frame;
  $$('[data-preset]').forEach(b=>b.classList.toggle('active',JSON.stringify(state.curve.points)===JSON.stringify(newCurve(b.dataset.preset).points)));
  $('#curve-axis-label').textContent=FRAMES[state.curve.frame].axes;
  $('#apply-cuts').innerHTML=`<i data-lucide="scissors"></i> ${curved?'Applica taglio curvo':'Applica tagli'} <kbd>↵</kbd>`;
  refreshIcons();updateButtons();updatePointFields();
}
function setCurveEditing(enabled,redraw=true){
  state.editing=enabled&&state.mode==='curve'&&!!state.original;
  controls.enabled=!state.editing;
  $('#curve-overlay').toggleAttribute('hidden',!state.editing);$('#curve-edit-status').hidden=!state.editing;
  $('#curve-point-controls').hidden=!state.editing;
  $('.viewport').classList.toggle('editing-curve',state.editing);
  $('#edit-curve span').textContent=state.editing?'Torna all’anteprima 3D':'Modifica curva sul modello';
  $('#edit-curve').classList.toggle('editing',state.editing);
  if(grid)grid.visible=!state.editing&&$('#grid-view').classList.contains('active');
  shadow.visible=!state.editing;
  if(state.editing){updateCurveCamera();updatePointFields();}
  else $('#camera-label').textContent='Prospettiva';
  if(redraw){drawParts();if(!state.editing)fitView();}
}
function updateCurveCamera(){
  if(!state.original||!state.editing)return;
  const b=state.original.bounds,f=FRAMES[state.curve.frame],d=sizeOf(b);
  const width=container.clientWidth,height=container.clientHeight,aspect=width/height;
  const h=Math.max(d[f.v]*1.95,d[f.u]*1.7/aspect),w=h*aspect;
  curveCamera.left=-w/2;curveCamera.right=w/2;curveCamera.top=h/2;curveCamera.bottom=-h/2;
  const center=new THREE.Vector3(...b.min.map((n,i)=>(n+b.max[i])/2));
  curveCamera.up.set(0,0,0).setComponent(f.v,1);
  const distance=Math.max(...d)*4;
  curveCamera.position.copy(center).setComponent(f.w,center.getComponent(f.w)+f.sign*distance);
  curveCamera.near=Math.max(.00001,distance/10000);curveCamera.far=distance*3;
  curveCamera.lookAt(center);curveCamera.updateProjectionMatrix();curveCamera.updateMatrixWorld(true);
  $('#camera-label').textContent=`Disegno · ${f.label}`;
  renderCurveOverlay();
}
function curveScreenPoints(){
  const b=state.original.bounds,f=FRAMES[state.curve.frame],d=sizeOf(b);
  return state.curve.points.map(p=>{
    const world=localToWorld(b,state.curve.frame,[b.min[f.u]+p[0]*d[f.u],b.min[f.v]+p[1]*d[f.v]]);
    const v=new THREE.Vector3(...world).project(curveCamera);
    return [(v.x+1)/2*container.clientWidth,(1-v.y)/2*container.clientHeight];
  });
}
function renderCurveOverlay(){
  if(!state.editing||!state.original)return;
  const svg=$('#curve-overlay'),width=container.clientWidth,height=container.clientHeight;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const p=curveScreenPoints(),path=`M${p[0]} C${p[1]} ${p[2]} ${p[3]}`;
  $('#curve-path').setAttribute('d',path);$('#curve-outline').setAttribute('d',path);
  $('#curve-handle-lines').setAttribute('d',`M${p[0]} L${p[1]} M${p[2]} L${p[3]}`);
  $$('[data-curve-point]').forEach((g,i)=>{
    g.setAttribute('transform',`translate(${p[i][0]},${p[i][1]})`);
    g.classList.toggle('selected',i===state.curvePoint);
  });
}
function updatePointFields(){
  if(!state.original)return;
  const f=FRAMES[state.curve.frame],d=sizeOf(state.original.bounds),i=state.curvePoint,p=state.curve.points[i];
  $('#curve-point-select').value=i;
  $('#point-u-label').textContent=['X','Y','Z'][f.u];$('#point-v-label').textContent=['X','Y','Z'][f.v];
  $('#point-u').value=(p[0]*d[f.u]).toFixed(2);$('#point-v').value=(p[1]*d[f.v]).toFixed(2);
  $('#point-u').readOnly=i===0||i===3;
  $('#point-u').min=i>0?((state.curve.points[i-1][0]+.02)*d[f.u]).toFixed(2):(-.12*d[f.u]).toFixed(2);
  $('#point-u').max=i<3?((state.curve.points[i+1][0]-.02)*d[f.u]).toFixed(2):(1.12*d[f.u]).toFixed(2);
  $('#point-v').min=(-.4*d[f.v]).toFixed(2);$('#point-v').max=(1.4*d[f.v]).toFixed(2);
}
function moveCurvePoint(i,x,y){
  if(state.busy||!Number.isFinite(x)||!Number.isFinite(y))return;
  const points=state.curve.points;
  if(i>0&&i<3)points[i][0]=Math.max(points[i-1][0]+.02,Math.min(points[i+1][0]-.02,x));
  points[i][1]=Math.max(-.4,Math.min(1.4,y));
  $$('[data-preset]').forEach(b=>b.classList.remove('active'));
  markDirty();renderCurveOverlay();updatePointFields();
}
function drawCurveSurface(){
  const b=state.original.bounds,f=FRAMES[state.curve.frame],d=sizeOf(b);
  const samples=curveSamples(b,state.curve);
  const frontDepth=b.min[f.w]-d[f.w]*.08,backDepth=b.max[f.w]+d[f.w]*.08;
  const coords=[],indices=[];
  samples.forEach(p=>{coords.push(...localToWorld(b,state.curve.frame,p,frontDepth),...localToWorld(b,state.curve.frame,p,backDepth));});
  for(let i=0;i<samples.length-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));geo.setIndex(indices);geo.computeVertexNormals();
  const surface=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x5479f2,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false}));
  const ribbon=new THREE.Group();ribbon.add(surface);
  for(const depth of [frontDepth,backDepth]){
    const pts=samples.map(p=>new THREE.Vector3(...localToWorld(b,state.curve.frame,p,depth)));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x6f91e3,transparent:true,opacity:.8}));ribbon.add(line);
  }
  if(!state.dirty&&state.appliedMode==='curve'&&f.v===2)ribbon.position.setComponent(f.v,gap()/2);
  planesGroup.add(ribbon);
}
function setupCurveEditor(){
  $('#curve-handles').innerHTML=Array.from({length:4},(_,i)=>`<g data-curve-point="${i}" tabindex="0" role="button" aria-label="${['Inizio curva','Controllo curva 1','Controllo curva 2','Fine curva'][i]}. Usa le frecce per spostare il punto."><circle class="handle-target" r="19"/><circle class="handle-ring" r="11"/><circle class="handle-core" r="5"/><text y="-21" text-anchor="middle">P${i}</text></g>`).join('');
  $$('[data-mode]').forEach(b=>b.onclick=()=>{
    if(state.busy||state.mode===b.dataset.mode)return;
    setCurveEditing(false,false);state.mode=b.dataset.mode;syncCurveUI();markDirty();drawParts();fitView();
  });
  $('#curve-frame').onchange=()=>{
    if(state.busy)return;state.curve.frame=$('#curve-frame').value;syncCurveUI();markDirty();
    setCurveEditing(true);
  };
  $$('[data-preset]').forEach(b=>b.onclick=()=>{
    if(state.busy)return;state.curve=newCurve(b.dataset.preset,state.curve.frame);
    $$('[data-preset]').forEach(el=>el.classList.toggle('active',el===b));
    markDirty();setCurveEditing(true);
  });
  $('#edit-curve').onclick=()=>{if(!state.busy){setCurveEditing(!state.editing);if(state.editing&&innerWidth<650)$('.viewport').scrollIntoView({behavior:'smooth',block:'start'});}};
  $('#quick-curve-cut').onclick=()=>{if(!state.busy)$('#apply-cuts').click();};
  $('#exit-curve').onclick=()=>{if(!state.busy)setCurveEditing(false);};
  $('#curve-point-select').onchange=()=>{state.curvePoint=Number($('#curve-point-select').value);renderCurveOverlay();updatePointFields();};
  for(const id of ['#point-u','#point-v'])$(id).onchange=()=>{
    const f=FRAMES[state.curve.frame],d=sizeOf(state.original.bounds);
    moveCurvePoint(state.curvePoint,Number($('#point-u').value)/d[f.u],Number($('#point-v').value)/d[f.v]);
  };
  let dragged=-1;
  const svg=$('#curve-overlay');
  svg.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-curve-point]');if(!handle||state.busy)return;
    e.preventDefault();dragged=Number(handle.dataset.curvePoint);state.curvePoint=dragged;
    svg.setPointerCapture(e.pointerId);handle.focus();renderCurveOverlay();updatePointFields();
  });
  svg.addEventListener('pointermove',e=>{
    if(dragged<0||state.busy)return;e.preventDefault();
    const rect=svg.getBoundingClientRect();
    const world=new THREE.Vector3((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2,0).unproject(curveCamera);
    const f=FRAMES[state.curve.frame],b=state.original.bounds,d=sizeOf(b);
    moveCurvePoint(dragged,(world.getComponent(f.u)-b.min[f.u])/d[f.u],(world.getComponent(f.v)-b.min[f.v])/d[f.v]);
  });
  function endDrag(e){if(dragged<0)return;dragged=-1;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}
  svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);svg.addEventListener('lostpointercapture',()=>dragged=-1);
  svg.addEventListener('keydown',e=>{
    const handle=e.target.closest('[data-curve-point]');if(!handle||state.busy)return;
    if(e.key==='Escape'){setCurveEditing(false);return;}
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();
    const i=Number(handle.dataset.curvePoint),p=state.curve.points[i],step=e.shiftKey?.025:.005;
    state.curvePoint=i;moveCurvePoint(i,p[0]+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),p[1]+(e.key==='ArrowDown'?-step:e.key==='ArrowUp'?step:0));
  });
}
