// Drawing seams directly on the model surface.
//
// The pointer is raycast against the mesh, so every sample is a real point of
// the surface. The view ray travels with it: the user can orbit the model with
// the right button (or two fingers), keep drawing, and the strokes are chained
// into one seam until it comes back to where it started and closes around the
// object.
import {
  appendSample, modelSpan, sampleStep, seamClosure, seamLength, seamPayload,
  seamPoints, seamStart, seamEnd, smoothStroke, straightStroke, strokeLength, validSample
} from './seam-math.js';

const KINDS = { curve: 'curvo', line: 'retto' };

export function createFreehandEditor(env) {
  const {
    THREE, state, $, $$, canvas, camera, controls, planesGroup, toast,
    markDirty, drawParts, updatePlanes, fitView, refreshIcons, previewCuts
  } = env;
  let strokes = [], live = null, pointer = null, pixel = null, activeId = null, notice = '';
  const pointerRay = new THREE.Raycaster();

  const span = () => (state.original ? modelSpan(state.original.bounds) : 1);
  const activeCut = () => state.freeCuts.find(cut => cut.id === activeId) || null;
  const unfinished = cut => !!cut && cut.strokes.length > 0 && !seamClosure(cut.strokes, state.original.bounds).closed;

  function ensureLive() {
    if (live && live.parent === planesGroup) return live;
    live = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x654ae6, depthTest: false, transparent: true, opacity: .95 }));
    live.renderOrder = 5; live.frustumCulled = false; live.visible = false;
    planesGroup.add(live);
    return live;
  }
  function refreshLive() {
    const line = ensureLive();
    const points = (strokes.at(-1) || []).map(sample => new THREE.Vector3(...sample.p));
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    line.visible = points.length > 1;
  }

  // --- interface -----------------------------------------------------------
  function saveHistory(dropEmpty = false) {
    // A cut that has no strokes yet is only a shell: snapshots for «Annulla»
    // record real content, so undoing after a scratch never restores shells.
    const cuts = dropEmpty ? state.freeCuts.filter(cut => cut.strokes.length) : state.freeCuts;
    state.freeHistory.push({ cuts: structuredClone(cuts), selected: state.freeSelected });
    if (state.freeHistory.length > 25) state.freeHistory.shift();
  }
  function sync() {
    const active = state.mode === 'freehand';
    $('#freehand-controls').hidden = !active;
    $('#draw-toolbar').hidden = !active || state.drawing;
    $('#fh-count').textContent = `${state.freeCuts.length} / 8`;
    if (active) $('#plane-count').textContent = `${state.freeCuts.length} TAGLI`;
    $('#no-strokes').hidden = state.freeCuts.length > 0;
    $('#stroke-list').innerHTML = state.freeCuts.map((cut, i) => {
      const closure = seamClosure(cut.strokes, state.original ? state.original.bounds : { min: [0, 0, 0], max: [1, 1, 1] });
      const points = seamPoints(cut.strokes);
      const state1 = !points ? 'nessun tratto' : closure.closed ? 'anello chiuso' : `${cut.strokes.length} tratti · ${points} punti`;
      return `<div class="stroke-card ${cut.id === state.freeSelected ? 'selected' : ''} ${cut.enabled === false ? 'inactive' : ''}" data-stroke-select="${cut.id}">`
        + `<button class="stroke-select" data-stroke-select="${cut.id}" aria-label="Seleziona taglio ${i + 1}">`
        + `<span class="stroke-number">${String(i + 1).padStart(2, '0')}</span>`
        + `<span><strong>Taglio ${i + 1} · ${KINDS[cut.kind] || 'curvo'}</strong><small>${state1}</small></span></button>`
        + `<input type="checkbox" data-stroke-enabled="${cut.id}" ${cut.enabled !== false ? 'checked' : ''} aria-label="Abilita taglio ${i + 1}">`
        + `<button class="icon-button" data-stroke-delete="${cut.id}" title="Elimina taglio ${i + 1}" aria-label="Elimina taglio ${i + 1}"><i data-lucide="x"></i></button></div>`;
    }).join('');
    const cut = activeCut() || state.freeCuts.find(c => c.id === state.freeSelected);
    $('#stroke-options').hidden = !cut || state.drawing;
    if (cut) $('#stroke-smooth').value = cut.smooth;
    $$('[data-stroke-kind]').forEach(b => b.classList.toggle('active', b.dataset.strokeKind === state.strokeKind));
    $('#viewport-kind').value = state.strokeKind;
    syncButtons();
    refreshIcons();
  }
  function syncButtons() {
    const blocked = state.busy || state.drawing;
    for (const sel of ['#start-stroke', '#viewport-draw']) $(sel).disabled = blocked || state.freeCuts.length >= 8 || !state.original;
    $('#undo-stroke').disabled = state.busy || !state.freeHistory.length;
    $('#close-seam').disabled = !state.drawing;
    $$('[data-stroke-kind],#viewport-kind,#xray-view,#view-stroke,#redraw-stroke,#continue-seam,#stroke-smooth,[data-stroke-delete],[data-stroke-enabled],.stroke-select').forEach(e => { e.disabled = blocked; });
    $('#continue-seam').disabled = blocked || !state.freeSelected;
    $$('[data-mode]').forEach(b => { b.disabled = blocked; });
    $('#quick-preview').disabled = blocked || (!state.dirty && !state.freeCuts.some(c => c.enabled !== false));
    if (state.mode === 'freehand') $('#apply-cuts').disabled = blocked || (!state.dirty && !state.freeCuts.some(c => c.enabled !== false));
    $('#export-all').disabled = state.busy || state.dirty || state.drawing || !state.parts.length || (state.mode === 'freehand' && !state.appliedFreeCuts.some(c => c.enabled !== false));
    $$('[data-download]').forEach(b => { b.disabled = state.busy || state.dirty || state.drawing; });
    $('#view-orientation').disabled = state.busy;
  }

  // --- drawing -------------------------------------------------------------
  function sampleAt(event) {
    if (!state.original || !state.picking) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    const direction = new THREE.Vector3(x * 2 - 1, 1 - y * 2, .5).unproject(camera).sub(camera.position).normalize();
    const origin = camera.position;
    const hit = state.picking(origin.toArray(), direction.toArray());
    if (!hit || !Number.isFinite(hit.distance) || hit.distance <= 0) return null;
    const point = origin.clone().addScaledVector(direction, hit.distance);
    const normal = hit.normal ? hit.normal.map((v, i) => (v * direction.getComponent(i) > 0 ? -v : v)) : null;
    return { p: point.toArray(), r: direction.toArray(), t: hit.distance, n: normal };
  }
  function addSample(event, force = false) {
    const stroke = strokes.at(-1);
    if (!stroke) return;
    if (pixel && !force && Math.hypot(event.clientX - pixel[0], event.clientY - pixel[1]) < 2) return;
    const sample = sampleAt(event);
    if (!sample || !validSample(sample)) return;
    if (!appendSample(strokes, sample, sampleStep(state.original.bounds)) && !force) return;
    pixel = [event.clientX, event.clientY];
    refreshLive();
    const points = seamPoints(strokes);
    $('#stroke-banner-title').textContent = state.strokeKind === 'line'
      ? `Taglio retto · ${points} punti`
      : `Tratto curvo · ${points} punti`;
  }
  function onPointerDown(event) {
    if (!state.drawing || state.busy || pointer !== null || (event.button !== undefined && event.button !== 0)) return;
    if (!state.picking) return;
    event.preventDefault();
    pointer = event.pointerId; pixel = null;
    saveHistory(true);
    strokes.push([]);
    try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* not capturable */ }
    addSample(event, true);
  }
  function onPointerMove(event) {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
    for (const item of events.length ? events : [event]) addSample(item);
  }
  function onPointerUp(event) {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    addSample(event, true);
    const id = pointer; pointer = null; pixel = null;
    try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (e) { /* already released */ }
    endStroke();
  }
  function onPointerCancel() {
    if (pointer === null) return;
    pointer = null; pixel = null;
    if (strokes.length) strokes.pop();
    refreshLive(); sync();
  }
  function endStroke() {
    const stroke = strokes.at(-1);
    const cut = activeCut();
    if (!stroke || !cut) { if (strokes.length) strokes.pop(); refreshLive(); return; }
    if (stroke.length < 2) { strokes.pop(); refreshLive(); toast('Tratto troppo corto: disegna un percorso più lungo sul modello.', true); return; }
    let drawn = state.strokeKind === 'line' ? straightStroke(stroke[0], stroke.at(-1)) : stroke;
    drawn = smoothStroke(drawn, cut.smooth);
    // A piece drawn after orbiting can continue the seam at either end of the
    // seam already drawn, and the drag direction may be reversed: attach the
    // new stroke where it actually meets the seam and flip it when needed, so
    // the strokes always chain head-to-tail around the object.
    const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const chain = cut.strokes.slice(0, -1);
    if (chain.length) {
      const head = chain[0][0].p, tail = chain.at(-1).at(-1).p;
      const first = drawn[0].p, last = drawn.at(-1).p;
      const reach = Math.min(gap(first, head), gap(last, head), gap(first, tail), gap(last, tail));
      const toTail = Math.min(gap(first, tail), gap(last, tail));
      if (reach < span() * .25 && toTail <= Math.min(gap(first, head), gap(last, head))) {
        if (gap(first, tail) > gap(last, tail)) drawn.reverse(); // stored strokes start at the seam tail
        chain.push(drawn);
      } else if (reach < span() * .25) {
        if (gap(last, head) > gap(first, head)) drawn.reverse(); // stored strokes end at the seam head
        chain.unshift(drawn);
      } else {
        chain.push(drawn); // a separate island: keep the drawing order
      }
      cut.strokes.length = 0;
      for (const item of chain) cut.strokes.push(item);
    } else {
      cut.strokes[0] = drawn;
    }
    const closure = seamClosure(cut.strokes, state.original.bounds);
    cut.camera = cut.camera || cameraSnapshot();
    refreshLive();
    markDirty();
    sync();
    previewCuts({ quiet: true }).then(ok => {
      if (closure.closed) toast(ok
        ? 'Anello chiuso: il modello è diviso in due parti. Premi «Chiudi il taglio».'
        : 'Anello chiuso, ma il taglio non divide ancora il modello. Prova ad allargare la curva.');
      notice = closure.closed ? 'anello chiuso' : '';
      updateBanner();
      if (ok) $('#dirty-banner').hidden = true;
    });
  }
  function updateBanner() {
    const cut = activeCut();
    if (!cut) return;
    const closure = seamClosure(cut.strokes, state.original.bounds);
    const hint = $('#stroke-banner-hint');
    $('#stroke-banner-title').textContent = closure.closed
      ? 'Anello chiuso attorno al modello'
      : `Tratto ${cut.strokes.length} · ${seamPoints(cut.strokes)} punti`;
    if (hint) {
      hint.textContent = closure.closed
        ? 'Premi «Chiudi il taglio» per uscire dal disegno.'
        : 'Tieni premuto il tasto sinistro e trascina sul modello · tasto destro o due dita per ruotare e continuare il tratto · Esc annulla';
    }
  }
  function cameraSnapshot() {
    return { position: camera.position.toArray(), up: camera.up.toArray(), target: controls.target.toArray(), fov: camera.fov };
  }
  function restoreCamera(cut) {
    const saved = cut?.camera;
    if (!saved) return;
    camera.position.fromArray(saved.position); camera.up.fromArray(saved.up);
    controls.target.fromArray(saved.target); camera.fov = saved.fov;
    camera.updateProjectionMatrix(); controls.update();
    $('#view-orientation').value = '3d'; $('#camera-label').textContent = 'Vista del taglio';
  }

  function start(id = null) {
    if (state.busy || !state.original || state.drawing) return;
    if (state.pickingBuilding || !state.picking) {
      if (state.pickingBuilding) {
        state.pendingDraw = id || true;
        toast('Sto preparando il modello per il disegno, un attimo…', true);
      } else {
        toast('Il modello non è ancora pronto per il disegno. Riprova tra un istante.', true);
      }
      return;
    }
    let cut = id ? state.freeCuts.find(c => c.id === id) : null;
    if (!cut) {
      if (state.freeCuts.length >= 8) { toast('Puoi inserire al massimo 8 tagli.', true); return; }
      cut = { id: crypto.randomUUID(), name: `Taglio ${state.freeCuts.length + 1}`, kind: state.strokeKind, smooth: 1, enabled: true, strokes: [], camera: null };
      state.freeCuts.push(cut);
    }
    activeId = cut.id; state.freeSelected = cut.id; strokes = cut.strokes;
    state.strokeKind = cut.kind || 'curve';
    state.drawing = true;
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    overlay(true);
    refreshLive();
    updateBanner();
    drawParts(); sync(); updatePlanes();
    previewCuts({ quiet: true });
    if (innerWidth < 650) $('.viewport').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function overlay(on) {
    $('.viewport').classList.toggle('drawing-stroke', on);
    $('#stroke-banner').hidden = !on;
    $('#stroke-overlay').toggleAttribute('hidden', !on);

  }
  function stop() {
    state.drawing = false; pointer = null; pixel = null; activeId = null;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    overlay(false);
    refreshLive();
  }
  // Escape during a stroke: throw the current stroke away and stay in drawing.
  function cancel() {
    if (!state.drawing) return;
    if (pointer !== null) {
      try { if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer); } catch (e) { /* already released */ }
      pointer = null; pixel = null;
      if (strokes.length) strokes.pop();
      if (state.freeHistory.length) {
        const previous = state.freeHistory.pop();
        state.freeCuts = previous.cuts; state.freeSelected = previous.selected;
        const cut = activeCut() || state.freeCuts.find(c => c.id === state.freeSelected);
        strokes = cut ? cut.strokes : [];
      }
      markDirty(); sync(); updatePlanes(); previewCuts({ quiet: true });
      return;
    }
    finish();
  }
  // Closing the seam: the cut stays, the user leaves the drawing mode.
  function finish() {
    if (!state.drawing) return;
    const cut = activeCut();
    if (cut && !cut.strokes.length) {
      state.freeCuts = state.freeCuts.filter(item => item.id !== cut.id);
      state.freeSelected = state.freeCuts.at(-1)?.id || null;
    }
    // Leaving the drawing mode changes nothing by itself: adding or dropping an
    // empty cut does not invalidate the parts, and the last preview already
    // decided whether they are up to date.
    stop(); sync(); updatePlanes();
    const closed = cut && cut.strokes.length ? seamClosure(cut.strokes, state.original.bounds).closed : false;
    if (cut && cut.strokes.length) {
      if (state.dirty) previewCuts().then(ok => {
        if (ok) toast(closed
          ? 'Taglio chiuso: il modello è stato diviso in due parti con superfici di taglio chiuse.'
          : 'Taglio acquisito. Ruota il modello e premi «Continua il taglio» per allungarlo, oppure «Anteprima divisa».');
      });
      else toast(closed
        ? 'Taglio chiuso: il modello è stato diviso in due parti con superfici di taglio chiuse.'
        : 'Taglio acquisito. Ruota il modello e premi «Continua il taglio» per allungarlo, oppure «Anteprima divisa».');
    }
  }

  // --- events --------------------------------------------------------------
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  $('#cancel-stroke').onclick = () => cancel();
  $('#close-seam').onclick = () => finish();
  $('#quick-preview').onclick = () => $('#apply-cuts').click();
  $('#start-stroke').onclick = $('#viewport-draw').onclick = () => start();
  $$('[data-stroke-kind]').forEach(button => { button.onclick = () => { state.strokeKind = button.dataset.strokeKind; if (activeCut()) activeCut().kind = state.strokeKind; sync(); }; });
  $('#viewport-kind').onchange = () => { state.strokeKind = $('#viewport-kind').value; if (activeCut()) activeCut().kind = state.strokeKind; sync(); };
  $('#undo-stroke').onclick = () => {
    if (state.busy || !state.freeHistory.length) return;
    const weight = cuts => cuts.reduce((n, cut) => n + cut.strokes.reduce((m, stroke) => m + stroke.length, 0), cuts.length * 1000);
    const before = weight(state.freeCuts);
    let previous = null;
    // Snapshots equal to the current state (an opened and immediately closed
    // empty cut, say) must not eat an undo step.
    while (state.freeHistory.length) {
      previous = state.freeHistory.pop();
      if (weight(previous.cuts) !== before || state.freeCuts.length !== previous.cuts.length) break;
      previous = null;
    }
    if (!previous) return;
    state.freeCuts = previous.cuts; state.freeSelected = previous.selected;
    const cut = state.freeCuts.find(item => item.id === activeId);
    strokes = cut ? cut.strokes : [];
    markDirty(); sync(); updatePlanes(); refreshLive();
  };
  $('#stroke-list').onclick = event => {
    if (state.busy || state.drawing) return;
    const remove = event.target.closest('[data-stroke-delete]');
    if (remove) {
      saveHistory();
      state.freeCuts = state.freeCuts.filter(cut => cut.id !== remove.dataset.strokeDelete);
      state.freeSelected = state.freeCuts.at(-1)?.id || null;
      markDirty(); sync(); updatePlanes();
      return;
    }
    if (event.target.closest('[data-stroke-enabled]')) return;
    const card = event.target.closest('[data-stroke-select]');
    if (card) { state.freeSelected = card.dataset.strokeSelect; sync(); updatePlanes(); }
  };
  $('#stroke-list').onchange = event => {
    if (!event.target.matches('[data-stroke-enabled]') || state.busy) return;
    saveHistory();
    const cut = state.freeCuts.find(item => item.id === event.target.dataset.strokeEnabled);
    cut.enabled = event.target.checked;
    markDirty(); sync();
  };
  $('#view-stroke').onclick = () => { if (!state.busy) restoreCamera(activeCut() || state.freeCuts.find(c => c.id === state.freeSelected)); };
  $('#continue-seam').onclick = () => { if (!state.busy && !state.drawing && state.freeSelected) start(state.freeSelected); };
  $('#redraw-stroke').onclick = () => {
    const cut = state.freeCuts.find(item => item.id === state.freeSelected);
    if (!cut || state.busy) return;
    saveHistory();
    cut.strokes = [];
    start(cut.id);
  };
  $('#view-orientation').onchange = () => {
    if (state.drawing || state.busy || !state.original) return;
    const name = $('#view-orientation').value;
    if (name === '3d') { camera.up.set(0, 0, 1); fitView(); return; }
    const bounds = new THREE.Box3(...[state.original.bounds.min, state.original.bounds.max].map(p => new THREE.Vector3(...p)));
    const centre = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const distance = size.length() / Math.tan(camera.fov * Math.PI / 360) * .75 * Math.max(1, 1 / camera.aspect);
    const direction = { front: [0, -1, 0], side: [1, 0, 0], top: [0, 0, 1] }[name];
    camera.up.set(0, name === 'top' ? 1 : 0, name === 'top' ? 0 : 1);
    camera.position.copy(centre).addScaledVector(new THREE.Vector3(...direction), distance);
    controls.target.copy(centre); camera.near = distance / 10000; camera.far = distance * 30;
    camera.updateProjectionMatrix(); controls.update();
    $('#camera-label').textContent = { front: 'Frontale', side: 'Laterale', top: 'Dall’alto' }[name];
  };
  $('#stroke-smooth').onchange = () => {
    const cut = activeCut() || state.freeCuts.find(item => item.id === state.freeSelected);
    if (!cut || state.busy) return;
    saveHistory();
    cut.smooth = Number($('#stroke-smooth').value);
    sync();
  };
  window.addEventListener('keydown', event => {
    if ($('#guide-dialog').open) return;
    if (event.key === 'Escape' && state.drawing) { event.preventDefault(); cancel(); }
    if (event.key === 'Enter' && state.drawing && !event.target.matches('input,textarea,select')) { event.preventDefault(); finish(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && state.mode === 'freehand' && !event.target.matches('input,textarea,select')) { event.preventDefault(); $('#undo-stroke').click(); }
  });

  // --- seam on screen ------------------------------------------------------
  function drawSurface() {
    if (!state.original) return;
    for (const cut of state.freeCuts) {
      if (cut.enabled === false || !cut.strokes.length) continue;
      const selected = cut.id === state.freeSelected || cut.id === activeId;
      for (const stroke of cut.strokes) {
        if (stroke.length < 2) continue;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(stroke.map(sample => new THREE.Vector3(...sample.p))),
          new THREE.LineBasicMaterial({ color: selected ? 0x654ae6 : 0x8194b8, transparent: true, opacity: selected ? .95 : .6, depthTest: false })
        );
        line.renderOrder = 4; line.frustumCulled = false;
        planesGroup.add(line);
      }
    }
    refreshLive();
  }
  function reset() {
    stop(); strokes = []; state.freeCuts = []; state.appliedFreeCuts = [];
    state.freeHistory = []; state.freeSelected = null; state.strokeKind = 'curve';
    sync();
  }
  function length(cut) { return seamLength(cut.strokes); }

  return { sync, syncButtons, start, cancel, finish, reset, drawSurface, isDrawing: () => state.drawing, activeCut, closure: cut => seamClosure(cut.strokes, state.original ? state.original.bounds : { min: [0, 0, 0], max: [1, 1, 1] }), length, payload: cut => ({ strokes: seamPayload(cut.strokes) }), validSample, strokeLength, seamStart, seamEnd, summarize: cut => ({ strokes: cut.strokes.length, points: seamPoints(cut.strokes) }) };
}
