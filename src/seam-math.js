// Seam samples taken directly on the model.
//
// While the user drags, every sample records where the pointer touched the mesh
// (p), the view ray it came from (r), the distance from the camera (t) and the
// surface normal (n). The worker turns these samples into the cutter, so a seam
// can be started on one side, continued after orbiting, and closed around the
// model. Everything here stays in model coordinates.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function unit(a) {
  if (!a) return null;
  const l = Math.hypot(a[0], a[1], a[2]);
  return !l || !Number.isFinite(l) ? null : [a[0] / l, a[1] / l, a[2] / l];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function modelSpan(bounds) {
  return Math.max(...[0, 1, 2].map(a => bounds.max[a] - bounds.min[a]), .01);
}
// Smallest distance between two samples of the same stroke.
export function sampleStep(bounds) {
  return Math.max(modelSpan(bounds) * .004, .02);
}
export function validSample(sample) {
  return !!sample
    && Array.isArray(sample.p) && sample.p.length === 3 && sample.p.every(Number.isFinite)
    && Array.isArray(sample.r) && sample.r.length === 3 && sample.r.every(Number.isFinite)
    && Math.abs(Math.hypot(...sample.r) - 1) < 1e-3
    && Number.isFinite(sample.t) && sample.t > 0;
}
// Adds a sample to the stroke the user is drawing, skipping the ones that land
// on top of the previous one.
export function appendSample(strokes, sample, step) {
  const stroke = strokes.at(-1);
  if (!stroke || !validSample(sample)) return false;
  const previous = stroke.at(-1);
  if (previous && distance(sample.p, previous.p) < step) return false;
  stroke.push(sample);
  return true;
}
export function strokeLength(stroke) {
  let total = 0;
  for (let i = 1; i < stroke.length; i++) total += distance(stroke[i - 1].p, stroke[i].p);
  return total;
}
export function seamLength(strokes) {
  return strokes.reduce((total, stroke) => total + strokeLength(stroke), 0);
}
export function seamPoints(strokes) {
  return strokes.reduce((total, stroke) => total + stroke.length, 0);
}
export function seamStart(strokes) {
  return strokes[0]?.[0] || null;
}
export function seamEnd(strokes) {
  return strokes.at(-1)?.at(-1) || null;
}
// A seam is closed when the last sample comes back to the first one after a path
// long enough to have gone round the model.
export function seamClosure(strokes, bounds) {
  const span = modelSpan(bounds);
  const start = seamStart(strokes), end = seamEnd(strokes);
  if (!start || !end) return { closed: false, gap: Infinity };
  const gap = distance(start.p, end.p);
  return { closed: gap < span * .08 && seamLength(strokes) > span * 1.5, gap };
}
export function seamBounds(strokes) {
  const points = strokes.flat().map(sample => sample.p);
  if (!points.length) return null;
  return {
    min: [0, 1, 2].map(a => Math.min(...points.map(p => p[a]))),
    max: [0, 1, 2].map(a => Math.max(...points.map(p => p[a])))
  };
}
// Straight stroke: keeps the two ends the user drew and walks between them,
// carrying the view rays along.
export function straightStroke(from, to, count = 12) {
  if (!validSample(from) || !validSample(to)) return [from, to].filter(Boolean);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push({
      p: mix(from.p, to.p, t),
      r: unit(mix(from.r, to.r, t)) || from.r,
      n: from.n && to.n ? unit(mix(from.n, to.n, t)) : (from.n || null),
      t: from.t + (to.t - from.t) * t
    });
  }
  return out;
}
export function strokeSummary(strokes) {
  return { strokes: strokes.length, points: seamPoints(strokes) };
}
// Plain clone into the structure the worker expects.
export function seamPayload(strokes) {
  return strokes.map(stroke => stroke.map(sample => ({
    p: [...sample.p],
    r: [...sample.r],
    t: sample.t,
    n: sample.n ? [...sample.n] : null
  })));
}

// Light smoothing of the drawn points: the view rays stay attached to their own
// sample, so the cutter keeps following the view even after smoothing.
export function smoothStroke(stroke, passes = 0) {
  if (!stroke || stroke.length < 3 || passes < 1) return stroke;
  let out = stroke;
  for (let pass = 0; pass < Math.min(2, passes); pass++) {
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const previous = out[i - 1].p, current = out[i].p, following = out[i + 1].p;
      next.push({
        ...out[i],
        p: [0, 1, 2].map(a => (previous[a] + 2 * current[a] + following[a]) / 4)
      });
    }
    next.push(out.at(-1));
    out = next;
  }
  return out;
}
