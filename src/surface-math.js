// Seam-locked surface cutting.
//
// The user draws directly on the mesh and can rotate the model between strokes.
// Every sample keeps its own view ray, so the cut follows the drawn path.
// The cutter is a thin ribbon: at every station its cross section spans from
// just outside the surface, through the whole object, to past the far side, so
// the swept band behaves like a curtain that pierces the solid along the drawn
// seam. The two cut faces stay coincident: the thin material removed by the
// band is given back to the nearest part.

import { raycastFar as raycastFarImpl } from './mesh-bvh.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
function unit(a) { if (!a) return null; const l = len(a); return l < 1e-12 ? null : [a[0] / l, a[1] / l, a[2] / l]; }
const dist = (a, b) => len(sub(a, b));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Deleting a Manifold twice throws in the wasm binding; cleanup must never mask
// the real error.
const drop = solids => solids.forEach(s => { try { s.delete(); } catch (e) { /* already gone */ } });

export function spanOf(bounds) {
  return Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 1e-6);
}
export function boundsCenter(bounds) { return [0, 1, 2].map(a => (bounds.min[a] + bounds.max[a]) / 2); }
export function padBounds(bounds, pad) { return { min: bounds.min.map(v => v - pad), max: bounds.max.map(v => v + pad) }; }
export function kerfFor(bounds) { const span = spanOf(bounds); return clamp(span * .0025, .04, span * .06); }

// Distance from p along d until the box is left.
export function boxExit(bounds, p, d) {
  let exit = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (p[a] < bounds.min[a] || p[a] > bounds.max[a]) return null;
      continue;
    }
    const t1 = (bounds.min[a] - p[a]) / d[a], t2 = (bounds.max[a] - p[a]) / d[a];
    exit = Math.min(exit, Math.max(t1, t2));
  }
  return Number.isFinite(exit) ? exit : null;
}

function boxDistance(a, b) {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const gap = Math.max(0, Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k]));
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}
function perpendicular(v, tangent) {
  if (!v || !tangent) return null;
  return unit(sub(v, mul(tangent, dot(v, tangent))));
}

function normalizeStrokes(cut, bounds, span) {
  if (!cut || !Array.isArray(cut.strokes)) throw Error('Disegna il percorso di taglio sulla superficie del modello.');
  const strokes = [];
  for (const raw of cut.strokes) {
    if (!Array.isArray(raw)) continue;
    const stations = [];
    for (const sample of raw) {
      if (!sample || !Array.isArray(sample.p) || sample.p.length !== 3 || !sample.p.every(Number.isFinite)) continue;
      const ray = unit(sample.r || sample.s);
      if (!ray) continue;
      if (stations.length && dist(stations.at(-1).p, sample.p) < span * .0015) continue;
      let normal = unit(sample.n);
      if (normal && dot(normal, ray) > 0) normal = mul(normal, -1); // face the camera
      stations.push({
        p: [...sample.p], ray, normal, air: false,
        cameraT: Number.isFinite(sample.t) ? Math.max(sample.t, span * .5) : span * 4
      });
    }
    if (stations.length > 1) strokes.push(stations);
  }
  if (!strokes.length) throw Error('Traccia un percorso continuo sulla superficie del modello.');
  if (strokes.reduce((n, s) => n + s.length, 0) < 3) throw Error('Il percorso è troppo corto: disegna un tratto più lungo sulla superficie.');
  return strokes;
}

function rotateTowards(from, to, axis, angle, t) {
  if (!axis) return t < .5 ? from : to;
  const a = angle * t, c = Math.cos(a), s = Math.sin(a);
  return unit(add(add(mul(from, c), mul(cross(axis, from), s)), mul(axis, dot(axis, from) * (1 - c)))) || to;
}

// Open-air route around the model: connects the end of a stroke to the start of
// the next one, and closes the loop at the end. Nothing is cut there, it only
// keeps the cutter a single closed volume.
function airRoute(out, from, to, ctx) {
  const { center, far, span, band } = ctx;
  const air = (p, ray) => out.push({ p, ray: ray || null, normal: null, hb: band * 2, hf: band * 2, cameraT: far, air: true });
  if (!from || !to) return;
  const start = from.p, end = to.p;
  if (dist(start, end) <= Math.max(span * .01, band * 8)) { air(end, to.ray); return; }
  const dirOf = p => unit(sub(p, center)) || [0, 0, 1];
  const nearFrom = add(start, mul(from.ray, -Math.max(from.cameraT * .9, span * .4)));
  const nearTo = add(end, mul(to.ray, -Math.max(to.cameraT * .9, span * .4)));
  const dirFrom = dirOf(nearFrom), dirTo = dirOf(nearTo);
  const farFrom = add(center, mul(dirFrom, far)), farTo = add(center, mul(dirTo, far));
  air(nearFrom, from.ray);
  air(farFrom, dirFrom);
  const angle = Math.acos(clamp(dot(dirFrom, dirTo), -1, 1));
  const axis = unit(cross(dirFrom, dirTo));
  const steps = Math.max(2, Math.ceil(angle / (Math.PI / 24)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, dir = rotateTowards(dirFrom, dirTo, axis, angle, t);
    air(add(center, mul(dir, far)), dir);
  }
  air(farTo, dirTo);
  air(nearTo, to.ray);
  air(end, to.ray);
}

function mixStation(a, b, t) {
  return {
    p: [0, 1, 2].map(k => a.p[k] + (b.p[k] - a.p[k]) * t),
    ray: unit([0, 1, 2].map(k => a.ray[k] + (b.ray[k] - a.ray[k]) * t)) || a.ray,
    normal: unit([0, 1, 2].map(k => (a.normal ? a.normal[k] : 0) + ((b.normal ? b.normal[k] : 0) - (a.normal ? a.normal[k] : 0)) * t)),
    air: !!(a.air || b.air),
    cameraT: a.cameraT + (b.cameraT - a.cameraT) * t
  };
}

function resample(list, maxStep) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i], b = list[(i + 1) % list.length];
    out.push(a);
    const d = dist(a.p, b.p);
    if (d > maxStep * 1.2) {
      const steps = Math.min(80, Math.ceil(d / maxStep));
      for (let k = 1; k < steps; k++) out.push(mixStation(a, b, k / steps));
    }
  }
  return out;
}

// Local path direction per station, ignoring the air hops so a stroke keeps its
// own tangent at both of its ends.
function buildTangents(list) {
  const n = list.length, tangents = new Array(n);
  for (let i = 0; i < n; i++) {
    const station = list[i], previous = list[(i - 1 + n) % n], next = list[(i + 1) % n];
    let tangent = null;
    if (station.air === previous.air && station.air === next.air) tangent = unit(sub(next.p, previous.p));
    if (!tangent) {
      const same = station.air === next.air ? next : previous;
      tangent = unit(sub(same.p, station.p)) || unit(sub(station.p, same.p));
    }
    tangents[i] = tangent || unit(sub(list[(i + 1) % n].p, station.p)) || [0, 0, 1];
  }
  return tangents;
}

// Cross section frame per station: `spine` pierces the object, `width` is the
// thickness of the band. Both stay perpendicular to the path.
function buildFrames(list, tangents) {
  const n = list.length, spines = new Array(n), widths = new Array(n);
  let previousSpine = null;
  for (let i = 0; i < n; i++) {
    const station = list[i], tangent = tangents[i];
    // The blade follows the view: it enters the model behind the drawn seam.
    let spine = perpendicular(station.ray, tangent);
    if (!spine && station.normal && dot(station.normal, station.ray) < -.05) {
      spine = perpendicular(mul(station.normal, -1), tangent);
    }
    if (!spine) spine = perpendicular(previousSpine, tangent);
    if (!spine) {
      const reference = Math.abs(dot(tangent, [0, 0, 1])) < .9 ? [0, 0, 1] : [1, 0, 0];
      spine = unit(cross(tangent, reference)) || [1, 0, 0];
    }
    spines[i] = spine; previousSpine = spine;
  }
  // One global sign: the blade enters the model on the side the camera sees.
  const first = list.findIndex(station => !station.air && station.ray);
  if (first >= 0 && dot(spines[first], list[first].ray) < 0) {
    for (let i = 0; i < n; i++) spines[i] = mul(spines[i], -1);
  }
  for (let i = 0; i < n; i++) {
    let width = unit(cross(spines[i], tangents[i]));
    if (!width) width = unit(cross(spines[i], [0, 0, 1])) || [0, 1, 0];
    if (i && dot(width, widths[i - 1]) < 0) width = mul(width, -1);
    widths[i] = width;
  }
  // A turn must be spread over several stations, otherwise neighbouring cross
  // sections sweep through each other.
  for (let pass = 0; pass < 5; pass++) {
    const next = spines.map((spine, i) => {
      const tangent = tangents[i];
      // Only average with stations of the same kind: the open air route must not
      // tilt the frames of the drawn seam.
      const neighbours = [];
      if (list[(i - 1 + n) % n].air === list[i].air) neighbours.push(spines[(i - 1 + n) % n]);
      if (list[(i + 1) % n].air === list[i].air) neighbours.push(spines[(i + 1) % n]);
      if (!neighbours.length) return spine;
      const merged = unit(add(mul(spine, 4), neighbours.reduce(add))) || spine;
      return perpendicular(merged, tangent) || spine;
    });
    for (let i = 0; i < n; i++) {
      let spine = next[i];
      if (dot(spine, spines[i]) < 0) spine = mul(spine, -1);
      spines[i] = spine;
    }
  }
  for (let i = 0; i < n; i++) {
    const width = unit(cross(spines[i], tangents[i]));
    if (width) widths[i] = width;
  }
  return { spines, widths };
}

function setExtents(list, spines, bounds, span, band, farDistance) {
  const frame = padBounds(bounds, span * .05);
  for (let i = 0; i < list.length; i++) {
    if (list[i].air) { list[i].hb = band * 2; list[i].hf = band * 2; continue; }
    const box = boxExit(frame, list[i].p, spines[i]);
    const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
    const limit = Math.min((Number.isFinite(box) && box > 0 ? box : span) + span * .05, diagonal * 1.6 + span);
    // Prefer stopping on the far side of the object: the curtain stays inside
    // the model and neighbouring cross sections overlap much less.
    let exit = null;
    if (farDistance) { try { exit = farDistance(list[i].p, spines[i], limit); } catch (e) { exit = null; } }
    // The back end must clear the local relief: on a bumpy surface a kerf-thin
    // back extension would stay buried under neighbouring bumps and the cut
    // would never reach the air.
    list[i].hb = Math.max(band * 2, span * .06);
    const reach = exit && Number.isFinite(exit) && exit > 0 ? Math.min(exit + span * .02, limit) : limit;
    list[i].hf = Math.max(reach, band * 4);
  }
  // keep the pierce length smooth, but never shorter than what is needed
  const n = list.length, need = list.map(s => s.hf);
  for (let pass = 0; pass < 2; pass++) {
    const next = list.map((station, i) => station.air ? station.hf : (list[(i - 1 + n) % n].hf + 2 * station.hf + list[(i + 1) % n].hf) / 4);
    for (let i = 0; i < n; i++) if (!list[i].air) list[i].hf = Math.max(next[i], need[i] * .98);
  }
}

function assertSimple(stations, band, span) {
  const step = Math.max(2, Math.ceil(stations.length / 220));
  const points = stations.filter((_, i) => i % step === 0).map(s => Array.isArray(s) ? s : s.p);
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) segments.push([points[i], points[i + 1]]);
  const clearance = Math.max(band * 3, span * .004);
  const distanceTo = (p, segment) => {
    const d = sub(segment[1], segment[0]), l2 = dot(d, d);
    const t = l2 ? clamp(dot(sub(p, segment[0]), d) / l2, 0, 1) : 0;
    return dist(p, add(segment[0], mul(d, t)));
  };
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      if (i === 0 && j === segments.length - 1) continue;
      if (distanceTo(segments[i][0], segments[j]) < clearance || distanceTo(segments[j][0], segments[i]) < clearance) {
        throw Error('Il percorso si incrocia o si sovrappone a sé stesso. Disegna un tratto che non torni sui suoi passi.');
      }
    }
  }
}

// One cross section pair as a small closed solid. Overlapping neighbours are
// merged afterwards by a boolean union, so turns never create a self
// intersecting sweep.
function prismMesh(list, frames, band, i, j, grow = 0) {
  const { spines, widths } = frames;
  const h = band / 2;
  // Each end face is built from the frame of its own station, so the far face
  // of one prism is exactly the near face of the next one: the wall stays
  // watertight along curved seams. The faces are still pushed outward along
  // the prism axis to bridge the remaining frame drift.
  const reach = unit(sub(list[j].p, list[i].p)) || spines[i];
  const shift = [mul(reach, -grow), mul(reach, grow)];
  const corners = [i, j].map(k => {
    const station = list[k], spine = spines[k], width = widths[k], p = station.p;
    const near = add(add(p, mul(spine, -station.hb)), k === i ? shift[0] : shift[1]);
    const far = add(add(p, mul(spine, station.hf)), k === i ? shift[0] : shift[1]);
    return [add(far, mul(width, h)), add(far, mul(width, -h)), add(near, mul(width, -h)), add(near, mul(width, h))];
  });
  const positions = [];
  const ids = corners.map(corner => {
    const base = positions.length / 3;
    for (const p of corner) positions.push(p[0], p[1], p[2]);
    return [base, base + 1, base + 2, base + 3];
  });
  const triangles = [];
  const quad = (i0, i1, i2, i3, want) => {
    const a = positions.slice(3 * i0, 3 * i0 + 3), b = positions.slice(3 * i1, 3 * i1 + 3), c = positions.slice(3 * i2, 3 * i2 + 3);
    if (dot(cross(sub(b, a), sub(c, a)), want) < 0) { const swap = i1; i1 = i3; i3 = swap; }
    triangles.push(i0, i1, i2, i0, i2, i3);
  };
  const [a, b] = ids;
  const axis = unit(sub(list[j].p, list[i].p)) || spines[i];
  quad(a[0], a[1], b[1], b[0], spines[i]);
  quad(a[2], a[3], b[3], b[2], mul(spines[i], -1));
  quad(a[1], a[2], b[2], b[1], mul(widths[i], -1));
  quad(a[3], a[0], b[0], b[3], widths[i]);
  quad(a[0], a[1], a[2], a[3], mul(axis, -1));
  quad(b[0], b[1], b[2], b[3], axis);
  return { positions, triangles };
}

function meshVolume(positions, triangles) {
  let total = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = 3 * triangles[t], b = 3 * triangles[t + 1], c = 3 * triangles[t + 2];
    total += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  return total;
}

function solidFromMesh(lib, positions, triangles) {
  if (!Number.isFinite(meshVolume(positions, triangles))) return null;
  const orientation = orientMesh(triangles, triangles.length / 3);
  if (orientation.conflicts > 0) return null;
  const make = flip => {
    const mesh = new lib.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(positions),
      triVerts: new Uint32Array(flip ? triangles.map((v, i) => (i % 3 === 0 ? triangles[i + 2] : i % 3 === 2 ? triangles[i - 2] : v)) : triangles)
    });
    mesh.merge();
    return new lib.Manifold(mesh);
  };
  let solid = null;
  try { solid = make(false); } catch (e) { solid = null; }
  if (!solid || solid.isEmpty() || solid.volume() <= 0) {
    if (solid) solid.delete();
    try { solid = make(true); } catch (e) { solid = null; }
  }
  if (solid && (solid.isEmpty() || solid.volume() <= 0)) { solid.delete(); solid = null; }
  return solid;
}

// The ribbon is a closed tube. The per-face orientation test above can be
// ambiguous on very thin quads, so the winding is made globally consistent by
// walking the shared edges (the tube is always orientable; a fold is not).
function orientMesh(triangles, triangleCount) {
  const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const shared = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k], b = triangles[3 * t + (k + 1) % 3];
      const id = key(a, b);
      let list = shared.get(id);
      if (!list) shared.set(id, list = []);
      if (list.length < 2) list.push(t);
    }
  }
  const seen = new Uint8Array(triangleCount);
  const stack = [0];
  seen[0] = 1;
  let reversed = 0, conflicts = 0;
  while (stack.length) {
    const t = stack.pop();
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k], b = triangles[3 * t + (k + 1) % 3];
      for (const other of shared.get(key(a, b)) || []) {
        if (other === t) continue;
        let same = false, linked = false;
        for (let q = 0; q < 3; q++) {
          const x = triangles[3 * other + q], y = triangles[3 * other + (q + 1) % 3];
          if ((x === a && y === b) || (x === b && y === a)) { same = x === a; linked = true; break; }
        }
        if (!linked) continue;
        if (seen[other]) { if (same) conflicts++; continue; }
        if (same) {
          const swap = triangles[3 * other + 1];
          triangles[3 * other + 1] = triangles[3 * other + 2];
          triangles[3 * other + 2] = swap;
          reversed++;
        }
        seen[other] = 1;
        stack.push(other);
      }
    }
  }
  return { reversed, conflicts };
}

// Plane that best fits the drawn seam: the kerf opens along its normal, and the
// cut advances inside that plane. One shared direction keeps every prism a clean
// parallelepiped, so neighbouring plates overlap instead of crossing each other.
function seamPlane(points, rays) {
  const n = points.length;
  const center = [0, 1, 2].map(a => points.reduce((sum, p) => sum + p[a], 0) / n);
  let normal = [0, 0, 0];
  for (let i = 0; i < n; i++) normal = add(normal, cross(sub(points[i], center), sub(points[(i + 1) % n], center)));
  let path = 0;
  for (let i = 0; i < n; i++) path += dist(points[i], points[(i + 1) % n]);
  const axis = unit(sub(points[n - 1], points[0]));
  // A seam that is basically a straight line does not define a plane: take the
  // one that lets the blade enter the model along the view ray.
  if (!axis || !unit(normal) || len(normal) < path * path * .02) {
    let ray = [0, 0, 0];
    for (const r of rays) ray = add(ray, r);
    const tangent = axis || unit(sub(points[1], points[0]));
    const chosen = unit(cross(tangent, unit(ray)));
    if (chosen) return chosen;
  }
  let unitNormal = unit(normal);
  if (!unitNormal) {
    let average = [0, 0, 0];
    for (const r of rays) average = add(average, r);
    unitNormal = unit(cross(axis || [1, 0, 0], average)) || unit(average);
  }
  return unitNormal;
}

export function buildCutRegion(lib, bounds, cut, band, farDistance = null) {
  const span = spanOf(bounds), center = boundsCenter(bounds);
  const strokes = normalizeStrokes(cut, bounds, span);
  const far = Math.hypot(...bounds.max.map((v, i) => v - bounds.min[i])) * 2.2 + span;
  const context = { center, far, span, band };
  // A knife keeps going: extend both ends straight ahead so a seam that stops
  // just before the border of the object still crosses it.
  const step = span * .04;
  const extendedStrokes = strokes.map(stroke => {
    const head = unit(sub(stroke[0].p, stroke[1].p)), tail = unit(sub(stroke.at(-1).p, stroke.at(-2).p));
    const extended = [];
    for (let k = 3; k >= 1; k--) if (head) extended.push({ ...stroke[0], p: add(stroke[0].p, mul(head, step * k)) });
    extended.push(...stroke);
    for (let k = 1; k <= 3; k++) if (tail) extended.push({ ...stroke.at(-1), p: add(stroke.at(-1).p, mul(tail, step * k)) });
    assertSimple(extended, band, span);
    return extended;
  });
  const drawn = extendedStrokes.flat().map(station => station.p);
  const plane = seamPlane(drawn, extendedStrokes.flat().map(station => station.ray));
  // A seam that comes back to where it started has gone round the model: cutting
  // along its own plane is the same cut as following the seam, and it leaves two
  // halves with matching faces. A closed seam drawn on a single side is seen face
  // on from the views, and is not a ring around the model.
  let drawnLength = 0, rayFacing = 0, rayCount = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) drawnLength += dist(stroke[i - 1].p, stroke[i].p);
    for (const station of stroke) {
      if (!station.ray || !plane) continue;
      rayFacing += Math.abs(dot(plane, station.ray));
      rayCount++;
    }
  }
  const looped = strokes.length > 0 && dist(strokes[0][0].p, strokes.at(-1).at(-1).p) < span * .08 && drawnLength > span * 1.5;
  // The plane must really cross the model, not lie flat on one of its sides.
  let above = 0, below = 0;
  if (plane) {
    let centre = [0, 0, 0];
    for (const point of drawn) centre = add(centre, point);
    const offset = dot(plane, mul(centre, 1 / drawn.length));
    for (let corner = 0; corner < 8; corner++) {
      const point = [0, 1, 2].map(a => (corner >> a) & 1 ? bounds.max[a] : bounds.min[a]);
      const side = dot(plane, point) - offset;
      if (side > span * .02) above++; else if (side < -span * .02) below++;
    }
  }
  if (globalThis.CUT_DEBUG) console.error('  drawn length', drawnLength.toFixed(1), 'looped', looped, 'rayFacing', rayCount ? (rayFacing / rayCount).toFixed(2) : 'n/a', 'plane', plane && plane.map(v => +v.toFixed(2)), 'above', above, 'below', below);
  if (looped && above > 1 && below > 1 && rayCount > 0 && rayFacing / rayCount < .9) {
    let center = [0, 0, 0];
    for (const point of drawn) center = add(center, point);
    center = mul(center, 1 / drawn.length);
    return { plane: [plane, dot(plane, center)] };
  }
  const raw = [];
  for (let i = 0; i < extendedStrokes.length; i++) {
    if (i) airRoute(raw, raw.at(-1), extendedStrokes[i][0], context);
    for (const station of extendedStrokes[i]) raw.push({ ...station });
  }
  airRoute(raw, raw.at(-1), extendedStrokes[0][0], context);
  let total = 0;
  for (let i = 0; i < raw.length; i++) total += dist(raw[i].p, raw[(i + 1) % raw.length].p);
  const list = resample(raw, Math.max(span * .02, band * 6, total / 700));
  if (list.length < 8) throw Error('Il percorso è troppo corto: disegna un tratto più lungo sulla superficie.');
  const tangents = buildTangents(list);
  const frames = buildFrames(list, tangents);
  setExtents(list, frames.spines, bounds, span, band, farDistance);
  const n = list.length;
  // Each pair of stations becomes one untwisted prism: both ends share the same
  // cross-section direction (the average of the two frames) and the same
  // thickness direction, so the prism is a plain box that can never sew itself
  // shut at a turn. Overlapping neighbours are merged by the union below, and
  // because every cross section is centred on its station the union stays a
  // continuous curtain along the whole seam, as deep as the seam needs.
  // The plate thickness direction is carried by the per-station frame widths:
  // they stay perpendicular to both the depth spine and the path, so the kerf
  // follows the seam smoothly instead of fanning out at the turns.
  let union = null;
  const prisms = [];
  try {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (globalThis.ONLY_DRAWN && (list[i].air || list[j].air)) continue;
      const { positions, triangles } = prismMesh(list, frames, band, i, j, band * 2);
      if (Math.abs(meshVolume(positions, triangles)) < 1e-9 * span * span * span) continue;
      const prism = solidFromMesh(lib, positions, triangles);
      if (prism) prisms.push(prism);
    }
    if (!prisms.length) throw Error('empty');
    union = prisms.length === 1 ? prisms[0] : lib.Manifold.union(prisms);
  } catch (e) {
    drop(prisms);
    if (union) drop([union]);
    throw Error('Con questo percorso non è possibile costruire un taglio valido. Ridisegna il tratto con una curva più ampia e regolare.');
  } finally {
    if (prisms.length && prisms[0] !== union) drop(prisms);
  }
  if (!union || union.isEmpty() || union.volume() <= 0 || union.status() !== 'NoError') {
    if (union) union.delete();
    throw Error('Con questo percorso non è possibile costruire un taglio valido. Ridisegna il tratto con una curva più ampia e regolare.');
  }
  return { region: union };
}

// One cutter on one solid: the blade takes a hair thin shaving (the kerf) which
// is given back to the piece it belongs to, so the parts keep exactly the size
// of the model and their cut faces touch each other.
function cutSolidOnce(lib, solid, cutter, crumbLimit, band) {
  if (cutter.plane) {
    const sides = solid.splitByPlane(cutter.plane[0], cutter.plane[1]);
    if (sides.some(side => side.volume() < crumbLimit)) {
      drop(sides);
      return [solid];
    }
    return sides;
  }
  const [shaving, remaining] = solid.split(cutter.region);
  const pieces = remaining.decompose().filter(piece => {
    if (piece.volume() >= crumbLimit) return true;
    piece.delete();
    return false;
  });
  if (pieces.length < 2) {
    drop([shaving, ...pieces]);
    return [solid];
  }
  const shavings = shaving.decompose();
  shaving.delete();
  for (const piece of shavings) {
    if (piece.volume() < 1e-9) { piece.delete(); continue; }
    const box = piece.boundingBox();
    let best = null, bestDistance = Infinity;
    for (const candidate of pieces) {
      const distance = boxDistance(box, candidate.boundingBox());
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    if (!best || bestDistance > band * 8) { piece.delete(); continue; }
    const merged = lib.Manifold.union(best, piece);
    piece.delete();
    if (merged.status() !== 'NoError' || merged.volume() <= 0) { merged.delete(); continue; }
    pieces[pieces.indexOf(best)] = merged;
    best.delete();
  }
  remaining.delete();
  return pieces;
}

export function splitSurfaceCuts(lib, original, cuts, raycast = null) {
  if (!Array.isArray(cuts) || cuts.length > 8) throw Error('Sono supportati fino a 8 tagli per progetto.');
  const enabled = cuts.filter(c => c.enabled !== false);
  const bounds = original.boundingBox();
  const band = kerfFor(bounds);
  const crumbLimit = Math.max(.02, original.volume() * 1e-7);
  const farDistance = raycast ? (p, direction, limit) => raycastFarImpl(raycast, p, direction, limit) : null;
  if (!enabled.length) return [original];
  let solids = [original];
  try {
    for (const cut of enabled) {
      const cutter = buildCutRegion(lib, bounds, cut, band, farDistance);
      const next = [];
      try {
        for (const solid of solids) next.push(...cutSolidOnce(lib, solid, cutter, crumbLimit, band));
      } catch (error) {
        drop(next.filter(s => s !== original));
        throw error;
      } finally {
        drop([cutter.region].filter(Boolean));
      }
      const changed = next.length > solids.length;
      if (next.length > 32) { drop(next.filter(s => s !== original)); throw Error('Sono state generate più di 32 parti. Riduci il numero di tagli.'); }
      drop(solids.filter(s => s !== original && !next.includes(s)));
      solids = next;
      if (!changed) {
        drop(solids.filter(s => s !== original));
        throw Error(`Il taglio «${cut.name || 'senza nome'}» non divide il modello. Ruota l’oggetto e continua il tratto sull’altra parte, oppure disegna una curva più ampia che attraversi tutta la superficie.`);
      }
    }
    if (solids.some(s => s.status() !== 'NoError')) throw Error('Il taglio non ha prodotto solidi validi. Disegna di nuovo il percorso con un tratto più regolare.');
    return solids;
  } catch (error) {
    drop(solids.filter(s => s !== original));
    throw error;
  }
}

export function splitSurfaceCut(lib, original, cut, raycast = null) {
  return splitSurfaceCuts(lib, original, [cut], raycast);
}

// Diagnostics used by the geometry tests.
export function debugPipeline(lib, bounds, cut, band, farDistance = null) {
  const span = spanOf(bounds), center = boundsCenter(bounds);
  const strokes = normalizeStrokes(cut, bounds, span);
  const far = Math.hypot(...bounds.max.map((v, i) => v - bounds.min[i])) * 2.2 + span;
  const context = { center, far, span, band };
  const step = span * .04;
  const extendedStrokes = strokes.map(stroke => {
    const head = unit(sub(stroke[0].p, stroke[1].p)), tail = unit(sub(stroke.at(-1).p, stroke.at(-2).p));
    const extended = [];
    for (let k = 3; k >= 1; k--) if (head) extended.push({ ...stroke[0], p: add(stroke[0].p, mul(head, step * k)) });
    extended.push(...stroke);
    for (let k = 1; k <= 3; k++) if (tail) extended.push({ ...stroke.at(-1), p: add(stroke.at(-1).p, mul(tail, step * k)) });
    return extended;
  });
  const drawn = extendedStrokes.flat().map(station => station.p);
  const plane = seamPlane(drawn, extendedStrokes.flat().map(station => station.ray));
  // A seam that comes back to where it started has gone round the model: cutting
  // along its own plane is the same cut as following the seam, and it leaves two
  // halves with matching faces. A closed seam drawn on a single side is seen face
  // on from the views, and is not a ring around the model.
  let drawnLength = 0, rayFacing = 0, rayCount = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) drawnLength += dist(stroke[i - 1].p, stroke[i].p);
    for (const station of stroke) {
      if (!station.ray || !plane) continue;
      rayFacing += Math.abs(dot(plane, station.ray));
      rayCount++;
    }
  }
  const looped = strokes.length > 0 && dist(strokes[0][0].p, strokes.at(-1).at(-1).p) < span * .08 && drawnLength > span * 1.5;
  // The plane must really cross the model, not lie flat on one of its sides.
  let above = 0, below = 0;
  if (plane) {
    let centre = [0, 0, 0];
    for (const point of drawn) centre = add(centre, point);
    const offset = dot(plane, mul(centre, 1 / drawn.length));
    for (let corner = 0; corner < 8; corner++) {
      const point = [0, 1, 2].map(a => (corner >> a) & 1 ? bounds.max[a] : bounds.min[a]);
      const side = dot(plane, point) - offset;
      if (side > span * .02) above++; else if (side < -span * .02) below++;
    }
  }
  if (globalThis.CUT_DEBUG) console.error('  drawn length', drawnLength.toFixed(1), 'looped', looped, 'rayFacing', rayCount ? (rayFacing / rayCount).toFixed(2) : 'n/a', 'plane', plane && plane.map(v => +v.toFixed(2)), 'above', above, 'below', below);
  if (looped && above > 1 && below > 1 && rayCount > 0 && rayFacing / rayCount < .9) {
    let center = [0, 0, 0];
    for (const point of drawn) center = add(center, point);
    center = mul(center, 1 / drawn.length);
    return { plane: [plane, dot(plane, center)] };
  }
  const raw = [];
  for (let i = 0; i < extendedStrokes.length; i++) {
    if (i) airRoute(raw, raw.at(-1), extendedStrokes[i][0], context);
    for (const station of extendedStrokes[i]) raw.push({ ...station });
  }
  airRoute(raw, raw.at(-1), extendedStrokes[0][0], context);
  let total = 0;
  for (let i = 0; i < raw.length; i++) total += dist(raw[i].p, raw[(i + 1) % raw.length].p);
  const list = resample(raw, Math.max(span * .02, band * 6, total / 700));
  const tangents = buildTangents(list);
  const frames = buildFrames(list, tangents);
  setExtents(list, frames.spines, bounds, span, band, farDistance);
  return { list, frames };
}
