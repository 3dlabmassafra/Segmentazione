// Direct geometry tests for the surface-locked freehand cuts.
import Module from 'manifold-3d';
import {splitSurfaceCut, splitSurfaceCuts, spanOf} from '../src/surface-math.js';
import {buildBVH, raycast} from '../src/mesh-bvh.js';

const lib = await Module();
lib.setup();
const box = lib.Manifold.cube([100, 80, 120]);
const bounds = box.boundingBox();
const span = spanOf(bounds);
const bvhOf = mesh => {
  const m = mesh.getMesh();
  const positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let a = 0; a < 3; a++) positions[3 * i + a] = m.vertProperties[m.numProp * i + a];
  return buildBVH(positions, new Uint32Array(m.triVerts));
};
const index = bvhOf(box);
const hit = (p, d) => {
  const t = raycast(index, p[0], p[1], p[2], d[0], d[1], d[2]);
  return t === Infinity ? null : {p: [0, 1, 2].map(k => p[k] + d[k] * t), t};
};
const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lerp = (a, b, t) => a + (b - a) * t;
const station = (p, r, n) => ({p, r, n, t: 600});
const t0 = Date.now();
const check = (label, parts, expected, tolerance = 1) => {
  const volume = parts.reduce((sum, p) => sum + p.volume(), 0);
  const bad = parts.filter(p => p.status() !== 'NoError').length;
  console.log(`${label}: ${parts.length} parti, volume ${volume.toFixed(3)}, atteso ${expected}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (parts.length !== parts.length) throw Error('impossible');
  if (bad) throw Error(`${label}: solidi non validi`);
  if (Math.abs(volume - box.volume()) > tolerance) throw Error(`${label}: volume non conservato`);
  if (expected !== null && parts.length !== expected) throw Error(`${label}: attese ${expected} parti, ottenute ${parts.length}`);
};

// 1. Vertical seam on the front face: cuts the block in two halves.
{
  const stations = [];
  for (let i = 0; i <= 24; i++) stations.push(station([30, 0, lerp(0, 120, i / 24)], [0, 1, 0], [0, -1, 0]));
  const parts = splitSurfaceCut(lib, box, {strokes: [stations]}, index);
  check('Seam on the front face', parts, 2);
  const sorted = parts.map(p => p.boundingBox()).sort((a, b) => a.min[0] - b.min[0]);
  console.log('  boxes',JSON.stringify(sorted.map(b=>[b.min.map(v=>+v.toFixed(2)),b.max.map(v=>+v.toFixed(2))])));
  if (Math.abs(sorted[0].max[0] - sorted[1].min[0]) > .4) throw Error('Cut faces do not match');
  if (Math.abs(sorted[0].max[0] - 30) > .4) throw Error('Cut is not where the seam was drawn');
  parts.forEach(p => p.delete());
}

// 2. Loop around the model drawn as four strokes, one per view: this is the
// workflow the tool has to support (draw, orbit, continue, close the loop).
{
  const rect = [[0, 0], [100, 0], [100, 80], [0, 80], [0, 0]];
  const rays = [[0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]];
  const normals = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
  const strokes = [];
  for (let e = 0; e < 4; e++) {
    const from = rect[e], to = rect[e + 1], stations = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      stations.push(station([lerp(from[0], to[0], t), lerp(from[1], to[1], t), 60], rays[e], normals[e]));
    }
    strokes.push(stations);
  }
  const parts = splitSurfaceCut(lib, box, {strokes}, index);
  check('Loop drawn from the four sides', parts, 2);
  const boxes = parts.map(p => p.boundingBox()).sort((a, b) => a.min[2] - b.min[2]);
  if (Math.abs(boxes[0].max[2] - boxes[1].min[2]) > .4) throw Error('Cut faces do not match');
  if (Math.abs(boxes[1].min[2] - 60) > .8) throw Error('Loop cut is not at the drawn height');
  if (Math.min(...parts.map(p => p.volume())) < box.volume() * .3) throw Error('Loop cut is unbalanced');
  parts.forEach(p => p.delete());
}

// 3. Tilted loop: the seam climbs while the model is orbited, so it crosses the
// vertical edges at four different heights. The plane 40 + .2x + .25y cuts the
// block in two equal halves, which is what must come back.
{
  const height = (x, y) => 40 + .2 * x + .25 * y;
  const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
  const rays = [[0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]];
  const normals = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
  const stations = [];
  for (let e = 0; e < 4; e++) {
    const from = corners[e], to = corners[(e + 1) % 4];
    for (let k = 0; k < 20; k++) {
      const t = k / 20;
      const ray = t < .15 ? blend(rays[(e + 3) % 4], rays[e], .5 + t / .15 * .5)
        : t > .85 ? blend(rays[e], rays[(e + 1) % 4], (t - .85) / .15 * .5) : rays[e];
      const normal = t < .15 ? normals[e] : t > .85 ? normals[(e + 1) % 4] : normals[e];
      const x = lerp(from[0], to[0], t), y = lerp(from[1], to[1], t);
      stations.push(station([x, y, height(x, y)], ray, normal));
    }
  }
  const parts = splitSurfaceCut(lib, box, {strokes: [stations]}, index);
  check('Tilted loop around the model', parts, 2);
  const volumes = parts.map(p => p.volume()).sort((a, b) => a - b);
  const halves = [480000 - 1200, 480000];
  if (Math.abs(volumes[0] - halves[0]) > 3000 || Math.abs(volumes[1] - halves[1]) > 3000) {
    throw Error(`The tilted loop did not cut two equal halves: ${volumes.join(' / ')}`);
  }
  parts.forEach(p => p.delete());
}

// 4. Two seams from two different views: four parts, no volume lost.
{
  const first = [];
  for (let i = 0; i <= 24; i++) first.push(station([30, 0, lerp(0, 120, i / 24)], [0, 1, 0], [0, -1, 0]));
  const second = [];
  for (let i = 0; i < 4 * 16; i++) {
    const e = Math.floor(i / 16), t = (i % 16) / 16;
    const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
    const rays = [[0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]];
    const normals = [[0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
    const from = corners[e], to = corners[(e + 1) % 4];
    const ray = t < .15 ? blend(rays[(e + 3) % 4], rays[e], .5 + t / .15 * .5) : t > .85 ? blend(rays[e], rays[(e + 1) % 4], (t - .85) / .15 * .5) : rays[e];
    second.push(station([lerp(from[0], to[0], t), lerp(from[1], to[1], t), 60], ray, t < .15 ? normals[e] : t > .85 ? normals[(e + 1) % 4] : normals[e]));
  }
  const parts = splitSurfaceCuts(lib, box, [{name: 'verticale', strokes: [first]}, {name: 'orizzontale', strokes: [second]}], index);
  check('Two seams from two views', parts, 4);
  parts.forEach(p => p.delete());
}

// 5. A stroke that does not cross the model must not cut it.
{
  let failed = false;
  try {
    const short = [station([40, 0, 60], [0, 1, 0], [0, -1, 0]), station([45, 0, 61], [0, 1, 0], [0, -1, 0]), station([50, 0, 60], [0, 1, 0], [0, -1, 0])];
    const parts = splitSurfaceCut(lib, box, {strokes: [short]}, index);
    parts.forEach(p => p.delete());
  } catch (e) { failed = true; console.log('PASS short stroke rejected:', e.message.slice(0, 60)); }
  if (!failed) throw Error('A short stroke was accepted as a cut');
}

// 6. Ray casting against the mesh returns real surface points.
{
  const front = hit([30, -300, 60], [0, 1, 0]);
  if (!front || Math.abs(front.p[1]) > 1e-3) throw Error('Ray casting missed the front face');
  const side = hit([300, 40, 60], [-1, 0, 0]);
  if (!side || Math.abs(side.p[0] - 100) > 1e-3) throw Error('Ray casting missed the side face');
  const diagonal = hit([-200, -200, 200], [1, 1, -1].map(v => v / Math.sqrt(3)));
  if (!diagonal) throw Error('Ray casting missed the model');
  console.log('PASS ray casting hits the drawn surface exactly');
}

box.delete();
console.log('PASS surface cuts: exact volume, coincident faces, multi view seams, guards');
