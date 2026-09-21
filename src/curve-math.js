// Shared by the preview and the geometry worker: they must use the same curve.
export const CURVE_SEGMENTS = 256;
export const FRAMES = {
  front: { u: 0, v: 2, w: 1, sign: -1, label: 'Frontale', axes: 'X / Z', depth: 'Y' },
  side:  { u: 1, v: 2, w: 0, sign: 1, label: 'Laterale', axes: 'Y / Z', depth: 'X' },
  top:   { u: 0, v: 1, w: 2, sign: 1, label: 'Dall’alto', axes: 'X / Y', depth: 'Z' },
};
export const PRESETS = {
  wave: [[-.12, .38], [.3, 1.12], [.7, -.12], [1.12, .62]],
  arch: [[-.12, .34], [.3, 1.05], [.7, 1.05], [1.12, .34]],
  valley: [[-.12, .68], [.3, -.05], [.7, -.05], [1.12, .68]],
};
export function newCurve(preset = 'wave', frame = 'front') {
  return { frame, points: PRESETS[preset].map(p => [...p]) };
}
export function bezier(points, t) {
  const s = 1 - t;
  return [0, 1].map(a => s*s*s*points[0][a] + 3*s*s*t*points[1][a] + 3*s*t*t*points[2][a] + t*t*t*points[3][a]);
}
export function validateCurve(curve) {
  if (!curve || !Object.hasOwn(FRAMES, curve.frame) || !Array.isArray(curve.points) || curve.points.length !== 4) {
    throw new Error('Profilo di taglio non valido. Reimposta la curva e riprova.');
  }
  const p = curve.points;
  if (p.some(v => !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite) || v[1] < -.4 || v[1] > 1.4) ||
      p[0][0] !== -.12 || p[3][0] !== 1.12 || p.some((v,i) => i > 0 && v[0] - p[i-1][0] < .015)) {
    throw new Error('La curva deve attraversare il modello da un bordo all’altro, senza tornare indietro.');
  }
}
export function curveSamples(bounds, curve, count = CURVE_SEGMENTS) {
  validateCurve(curve);
  const {u,v} = FRAMES[curve.frame];
  const du = bounds.max[u] - bounds.min[u], dv = bounds.max[v] - bounds.min[v];
  return Array.from({length: count + 1}, (_,i) => {
    const p = bezier(curve.points, i/count);
    return [bounds.min[u] + p[0]*du, bounds.min[v] + p[1]*dv];
  });
}
export function localToWorld(bounds, frame, p, depth) {
  const {u,v,w} = FRAMES[frame];
  const world = [0,0,0];
  world[u] = p[0]; world[v] = p[1];
  world[w] = depth ?? (bounds.min[w] + bounds.max[w])/2;
  return world;
}
export function splitCurved(lib, original, curve) {
  const bounds = original.boundingBox();
  const {u,v,w,sign} = FRAMES[curve.frame] || {};
  const samples = curveSamples(bounds, curve);
  const pad = Math.max(...bounds.max.map((n,i) => n-bounds.min[i]), 1) * .3;
  const floor = bounds.min[v] - pad*3;
  const polygon = [[samples[0][0],floor], [samples.at(-1)[0],floor], ...samples.toReversed()];
  let extrusion, cutter, parts;
  try {
    extrusion = lib.Manifold.extrude([polygon], bounds.max[w] - bounds.min[w] + 2*pad);
    // Right-handed local U,V,W basis, column-major affine transformation.
    const matrix = Array(16).fill(0);
    matrix[u] = 1; matrix[4+v] = 1; matrix[8+w] = sign; matrix[15] = 1;
    matrix[12+w] = sign > 0 ? bounds.min[w]-pad : bounds.max[w]+pad;
    cutter = extrusion.transform(matrix);
    if (cutter.status() !== 'NoError') throw new Error('Impossibile costruire la superficie curva.');
    // Intersection is below the curve, difference is above the curve.
    parts = original.split(cutter);
    if (parts.some(p => p.isEmpty() || p.status() !== 'NoError' || p.volume() <= 0)) {
      throw new Error('La curva non divide il modello in due parti. Spostala verso il centro e riprova.');
    }
    return parts;
  } catch(error) {
    parts?.forEach(p => p.delete());
    throw error;
  } finally {
    extrusion?.delete(); cutter?.delete();
  }
}
