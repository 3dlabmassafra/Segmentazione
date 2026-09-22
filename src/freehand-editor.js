import {prepareStroke,strokeWorld,frameBounds,validateFrame} from './freehand-math.js';

export function createFreehandEditor(env){
  const {THREE,state,$,$$,container,camera,controls,planesGroup,toast,markDirty,drawParts,updatePlanes,fitView,refreshIcons}=env;
  let points=[],pixels=[],frame=null,activePointer=null,replacing=null;
  const overlay=$('#stroke-overlay');
  const selected=()=>state.freeCuts.find(c=>c.id===state.freeSelected);
  const saveHistory=()=>{state.freeHistory.push({cuts:structuredClone(state.freeCuts),selected:state.freeSelected});if(state.freeHistory.length>25)state.freeHistory.shift();};
  function sync(){
    const active=state.mode==='freehand';
    $('#freehand-controls').hidden=!active;$('#draw-toolbar').hidden=!active||state.drawing;
    $('#fh-count').textContent=`${state.freeCuts.length} / 8`;
    if(active)$('#plane-count').textContent=`${state.freeCuts.length} TAGLI`;
    $('#no-strokes').hidden=state.freeCuts.length>0;
    $('#stroke-list').innerHTML=state.freeCuts.map((c,i)=>`<div class="stroke-card ${c.id===state.freeSelected?'selected':''} ${c.enabled===false?'inactive':''}" data-stroke-select="${c.id}"><button class="stroke-select" data-stroke-select="${c.id}" aria-label="Seleziona taglio ${i+1}"><span class="stroke-number">${String(i+1).padStart(2,'0')}</span><span><strong>Taglio ${i+1} · ${c.kind==='line'?'retto':'curvo'}</strong><small>${c.points.length} punti · ${c.enabled===false?'disattivato':'disegnato sul modello'}</small></span></button><input type="checkbox" data-stroke-enabled="${c.id}" ${c.enabled!==false?'checked':''} aria-label="Abilita taglio ${i+1}"><button class="icon-button" data-stroke-delete="${c.id}" title="Elimina taglio ${i+1}" aria-label="Elimina taglio ${i+1}"><i data-lucide="x"></i></button></div>`).join('');
    const cut=selected();$('#stroke-options').hidden=!cut;
    if(cut){$('#stroke-smooth').value=cut.smooth;$('#smooth-label').textContent=['Nessuna','Leggera','Morbida'][cut.smooth];$('#stroke-smooth').disabled=state.busy||cut.kind==='line'||state.drawing;}
    $$('[data-stroke-kind]').forEach(b=>b.classList.toggle('active',b.dataset.strokeKind===state.strokeKind));$('#viewport-kind').value=state.strokeKind;
    syncButtons();refreshIcons();
  }
  function syncButtons(){
    const blocked=state.busy||state.drawing;
    for(const sel of ['#start-stroke','#viewport-draw'])$(sel).disabled=blocked||state.freeCuts.length>=8||!state.original;
    $('#undo-stroke').disabled=blocked||!state.freeHistory.length;
    $$('[data-stroke-kind],#viewport-kind,#view-orientation,#xray-view,#view-stroke,#redraw-stroke,[data-stroke-delete],[data-stroke-enabled],.stroke-select').forEach(e=>e.disabled=blocked);
    $$('[data-mode]').forEach(b=>b.disabled=blocked);
    $('#quick-preview').disabled=blocked||(!state.dirty&&!state.freeCuts.some(c=>c.enabled!==false));
    if(state.mode==='freehand')$('#apply-cuts').disabled=blocked||(!state.dirty&&!state.freeCuts.some(c=>c.enabled!==false));
    $('#export-all').disabled=state.busy||state.dirty||state.drawing||!state.parts.length||(state.mode==='freehand'&&!state.appliedFreeCuts.some(c=>c.enabled!==false));
    $$('[data-download]').forEach(b=>b.disabled=state.busy||state.dirty||state.drawing);
  }
  function snapshotFrame(){
    camera.updateMatrixWorld(true);
    const center=new THREE.Vector3(...state.original.bounds.min.map((n,i)=>(n+state.original.bounds.max[i])/2));
    const u=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),v=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),w=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,2);
    const distance=new THREE.Vector3().subVectors(camera.position,center).dot(w);
    const origin=camera.position.clone().addScaledVector(w,-distance);
    const f={origin:origin.toArray(),u:u.toArray(),v:v.toArray(),w:w.toArray(),distance,perspective:camera.isPerspectiveCamera,camera:{position:camera.position.toArray(),up:camera.up.toArray(),target:controls.target.toArray(),fov:camera.fov}};
    validateFrame(f);const b=frameBounds(state.original.bounds,f);
    if(b.max[2]>=distance*.95)throw Error('Allontana la camera dal modello prima di disegnare.');return f;
  }
  function start(id=null){
    if(state.busy||!state.original||state.drawing)return;
    if(state.freeCuts.length>=8&&!id){toast('Puoi inserire al massimo 8 tagli.',true);return;}
    if(id){const c=state.freeCuts.find(c=>c.id===id);if(!c)return;restoreCamera(c);state.strokeKind=c.kind;}
    // Stop camera damping before capturing its exact orientation.
    controls.update();
    try{frame=snapshotFrame();}catch(e){toast(e.message,true);return;}
    replacing=id;points=[];pixels=[];activePointer=null;
    state.drawing=true;controls.enabled=false;
    $('#stroke-live').setAttribute('d','');$('#stroke-live-outline').setAttribute('d','');
    overlay.removeAttribute('hidden');$('#stroke-banner').hidden=false;
    $('#stroke-banner-title').textContent=state.strokeKind==='line'?'Disegna il taglio retto':'Disegna il taglio curvo a mano libera';
    $('.viewport').classList.add('drawing-stroke');
    drawParts();sync();
    if(innerWidth<650)$('.viewport').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function cancel(redraw=true){
    const was=state.drawing;state.drawing=false;controls.enabled=true;
    if(activePointer!==null&&overlay.hasPointerCapture(activePointer))overlay.releasePointerCapture(activePointer);
    activePointer=null;points=[];pixels=[];
    overlay.setAttribute('hidden','');$('#stroke-banner').hidden=true;$('.viewport').classList.remove('drawing-stroke');
    if(was&&redraw)drawParts();sync();
  }
  function restoreCamera(c){
    if(!c?.frame.camera)return;
    const saved=c.frame.camera;camera.position.fromArray(saved.position);camera.up.fromArray(saved.up);controls.target.fromArray(saved.target);camera.fov=saved.fov;
    camera.updateProjectionMatrix();controls.update();$('#view-orientation').value='3d';$('#camera-label').textContent='Vista del taglio';
  }
  function pointerPoint(e){
    const r=overlay.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/r.width*2-1,1-y/r.height*2),camera);
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...frame.w),new THREE.Vector3(...frame.origin));
    const p=ray.ray.intersectPlane(plane,new THREE.Vector3());if(!p)return null;
    p.sub(new THREE.Vector3(...frame.origin));
    return {point:[p.dot(new THREE.Vector3(...frame.u)),p.dot(new THREE.Vector3(...frame.v))],pixel:[x,y]};
  }
  function append(e,force=false){
    const result=pointerPoint(e);if(!result)return;
    if(pixels.length&&!force&&Math.hypot(result.pixel[0]-pixels.at(-1)[0],result.pixel[1]-pixels.at(-1)[1])<2)return;
    if(points.length>=4095)return;
    points.push(result.point);pixels.push(result.pixel);
    const path=state.strokeKind==='line'?[pixels[0],pixels.at(-1)]:pixels;
    const d=path.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    $('#stroke-live').setAttribute('d',d);$('#stroke-live-outline').setAttribute('d',d);
    $('#stroke-banner-title').textContent=`${state.strokeKind==='line'?'Taglio retto':'Tratto curvo'} · ${points.length} punti — rilascia per confermare`;
  }
  function finish(){
    if(!points.length)return;
    const candidate={id:replacing||crypto.randomUUID(),name:`Taglio ${state.freeCuts.length+1}`,frame,points:state.strokeKind==='line'?[points[0],points.at(-1)]:points,kind:state.strokeKind,smooth:state.strokeKind==='line'?0:1,enabled:true};
    try{
      prepareStroke(state.original.bounds,candidate);
      saveHistory();
      if(replacing){const index=state.freeCuts.findIndex(c=>c.id===replacing);candidate.name=state.freeCuts[index].name;state.freeCuts[index]=candidate;}
      else state.freeCuts.push(candidate);
      state.freeSelected=candidate.id;cancel(false);markDirty();drawParts();sync();
      toast('Percorso acquisito. Aggiungi altri tagli oppure premi «Anteprima divisa».');
    }catch(e){cancel();toast(e.message,true);}
  }
  overlay.addEventListener('pointerdown',e=>{
    if(!state.drawing||state.busy||activePointer!==null||e.button!==0)return;e.preventDefault();
    activePointer=e.pointerId;points=[];pixels=[];overlay.setPointerCapture(e.pointerId);append(e,true);
  });
  overlay.addEventListener('pointermove',e=>{
    if(e.pointerId!==activePointer)return;e.preventDefault();
    const events=e.getCoalescedEvents?.()||[];for(const ev of events.length?events:[e])append(ev);
  });
  overlay.addEventListener('pointerup',e=>{if(e.pointerId!==activePointer)return;e.preventDefault();append(e,true);const id=activePointer;activePointer=null;if(overlay.hasPointerCapture(id))overlay.releasePointerCapture(id);finish();});
  overlay.addEventListener('pointercancel',()=>cancel());
  $('#cancel-stroke').onclick=()=>cancel();
  $('#quick-preview').onclick=()=>$('#apply-cuts').click();
  $('#start-stroke').onclick=$('#viewport-draw').onclick=()=>start();
  $$('[data-stroke-kind]').forEach(b=>b.onclick=()=>{state.strokeKind=b.dataset.strokeKind;sync();});
  $('#viewport-kind').onchange=()=>{state.strokeKind=$('#viewport-kind').value;sync();};
  $('#undo-stroke').onclick=()=>{
    if(state.busy||state.drawing||!state.freeHistory.length)return;const prev=state.freeHistory.pop();state.freeCuts=prev.cuts;state.freeSelected=prev.selected;
    markDirty();sync();updatePlanes();
  };
  $('#stroke-list').onclick=e=>{
    if(state.busy||state.drawing)return;
    const del=e.target.closest('[data-stroke-delete]');
    if(del){saveHistory();state.freeCuts=state.freeCuts.filter(c=>c.id!==del.dataset.strokeDelete);state.freeSelected=state.freeCuts.at(-1)?.id||null;markDirty();sync();return;}
    if(e.target.closest('[data-stroke-enabled]'))return;
    const card=e.target.closest('[data-stroke-select]');if(card){state.freeSelected=card.dataset.strokeSelect;sync();updatePlanes();}
  };
  $('#stroke-list').onchange=e=>{if(!e.target.matches('[data-stroke-enabled]')||state.busy)return;saveHistory();const c=state.freeCuts.find(c=>c.id===e.target.dataset.strokeEnabled);c.enabled=e.target.checked;markDirty();sync();};
  $('#view-stroke').onclick=()=>{if(!state.busy&&!state.drawing)restoreCamera(selected());};
  $('#redraw-stroke').onclick=()=>start(state.freeSelected);
  $('#stroke-smooth').onchange=()=>{const c=selected();if(!c||state.busy||state.drawing)return;const next={...c,smooth:Number($('#stroke-smooth').value)};try{prepareStroke(state.original.bounds,next);saveHistory();c.smooth=next.smooth;markDirty();sync();}catch(e){toast(e.message,true);sync();}};
  $('#view-orientation').onchange=()=>{
    if(state.drawing||state.busy)return;
    const name=$('#view-orientation').value;if(name==='3d'){camera.up.set(0,0,1);fitView();return;}
    const bounds=new THREE.Box3(...[state.original.bounds.min,state.original.bounds.max].map(p=>new THREE.Vector3(...p)));
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const d=size.length()/Math.tan(camera.fov*Math.PI/360)*.75*Math.max(1,1/camera.aspect);
    const direction={front:[0,-1,0],side:[1,0,0],top:[0,0,1]}[name];
    camera.up.set(0,name==='top'?1:0,name==='top'?0:1);camera.position.copy(center).addScaledVector(new THREE.Vector3(...direction),d);controls.target.copy(center);camera.near=d/10000;camera.far=d*30;camera.updateProjectionMatrix();controls.update();$('#camera-label').textContent={front:'Frontale',side:'Laterale',top:'Dall’alto'}[name];
  };
  $('#xray-view').onclick=()=>{state.xray=!state.xray;$('#xray-view').classList.toggle('active',state.xray);env.updateXray();};
  window.addEventListener('keydown',e=>{
    if($('#guide-dialog').open)return;
    if(e.key==='Escape'&&state.drawing){e.preventDefault();cancel();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&state.mode==='freehand'&&!e.target.matches('input,textarea,select')){e.preventDefault();$('#undo-stroke').click();}
  });
  function drawSurface(){
    if(!state.original)return;
    for(const cut of state.freeCuts){
      if(cut.enabled===false)continue;
      let prepared;try{prepared=prepareStroke(state.original.bounds,cut);}catch{continue;}
      const selectedCut=cut.id===state.freeSelected;
      const pts=prepared.seam.map(p=>new THREE.Vector3(...strokeWorld(cut.frame,p)));
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:selectedCut?0x654ae6:0x8194b8,transparent:true,opacity:selectedCut?.95:.6,depthTest:false}));line.renderOrder=3;planesGroup.add(line);
      if(selectedCut&&!state.drawing){
        const low=prepared.frameBounds.min[2],high=prepared.frameBounds.max[2],vertices=[],indices=[];
        prepared.seam.forEach(p=>vertices.push(...strokeWorld(cut.frame,p,low),...strokeWorld(cut.frame,p,high)));
        for(let i=0;i<prepared.seam.length-1;i++){const n=2*i;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);
        planesGroup.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x8a70ed,side:THREE.DoubleSide,transparent:true,opacity:.09,depthWrite:false})));
      }
    }
  }
  function reset(){cancel(false);state.freeCuts=[];state.appliedFreeCuts=[];state.freeHistory=[];state.freeSelected=null;sync();}
  return {sync,syncButtons,start,cancel,reset,drawSurface};
}
