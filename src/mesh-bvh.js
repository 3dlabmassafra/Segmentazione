// Small binary BVH used to project pointer samples onto the mesh surface and to
// measure how deep a cut has to travel inside the model.
// It only runs inside the geometry worker, so it can afford the memory.

const LEAF = 6;

export function buildBVH(positions, indices) {
  const triCount = indices.length / 3;
  const lo = new Float32Array(triCount * 3), hi = new Float32Array(triCount * 3);
  const centroids = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = indices[3 * t] * 3, b = indices[3 * t + 1] * 3, c = indices[3 * t + 2] * 3;
    for (let k = 0; k < 3; k++) {
      const va = positions[a + k], vb = positions[b + k], vc = positions[c + k];
      const low = Math.min(va, vb, vc), high = Math.max(va, vb, vc);
      lo[3 * t + k] = low; hi[3 * t + k] = high;
      centroids[3 * t + k] = (va + vb + vc) / 3;
    }
  }
  const order = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;
  // Every leaf holds at least LEAF/2 triangles with the median split below, so
  // this bound is never reached: it is only a safety net for the arrays.
  const maxNodes = Math.max(2, 4 * Math.ceil(triCount / LEAF) + 4);
  const nodeLo = new Float64Array(maxNodes * 3), nodeHi = new Float64Array(maxNodes * 3);
  const left = new Int32Array(maxNodes).fill(-1), right = new Int32Array(maxNodes).fill(-1);
  const start = new Int32Array(maxNodes), count = new Int32Array(maxNodes);
  let nodes = 0;
  const newNode = () => { const i = nodes++; left[i] = -1; right[i] = -1; count[i] = 0; start[i] = 0; return i; };

  // Partial quick select: puts the `target`-th smallest centroid value on its
  // place, so both halves of the node are balanced by triangle count.
  const select = (axis, from, to, target) => {
    const value = t => centroids[3 * t + axis];
    let a = from, b = to - 1;
    while (a < b) {
      const pivot = value(order[(a + b) >> 1]);
      let i = a, j = b;
      while (i <= j) {
        while (value(order[i]) < pivot) i++;
        while (value(order[j]) > pivot) j--;
        if (i <= j) { const swap = order[i]; order[i] = order[j]; order[j] = swap; i++; j--; }
      }
      if (target <= j) b = j; else if (target >= i) a = i; else break;
    }
  };

  const stack = [[newNode(), 0, triCount]];
  while (stack.length) {
    const [node, from, to] = stack.pop();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = from; i < to; i++) {
      const t = order[i];
      if (lo[3 * t] < x0) x0 = lo[3 * t]; if (hi[3 * t] > x1) x1 = hi[3 * t];
      if (lo[3 * t + 1] < y0) y0 = lo[3 * t + 1]; if (hi[3 * t + 1] > y1) y1 = hi[3 * t + 1];
      if (lo[3 * t + 2] < z0) z0 = lo[3 * t + 2]; if (hi[3 * t + 2] > z1) z1 = hi[3 * t + 2];
    }
    nodeLo[3 * node] = x0; nodeLo[3 * node + 1] = y0; nodeLo[3 * node + 2] = z0;
    nodeHi[3 * node] = x1; nodeHi[3 * node + 1] = y1; nodeHi[3 * node + 2] = z1;
    const size = to - from;
    if (size <= LEAF || nodes + 2 > maxNodes) { start[node] = from; count[node] = size; continue; }
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const middle = from + (size >> 1);
    select(axis, from, to, middle);
    const a = newNode(), b = newNode();
    left[node] = a; right[node] = b;
    stack.push([a, from, middle], [b, middle, to]);
  }
  return { positions, indices, order, lo, hi, nodeLo, nodeHi, left, right, start, count, nodes };
}

// Nearest hit along a unit direction. Returns the distance or Infinity.
export function raycast(bvh, ox, oy, oz, dx, dy, dz, maxDistance = Infinity, out = null) {
  const { positions, indices, order, nodeLo, nodeHi, left, right, start, count } = bvh;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let best = maxDistance, found = false;
  const stack = new Int32Array(256);
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top];
    const b0 = nodeLo[3 * node], b1 = nodeLo[3 * node + 1], b2 = nodeLo[3 * node + 2];
    const c0 = nodeHi[3 * node], c1 = nodeHi[3 * node + 1], c2 = nodeHi[3 * node + 2];
    let tmin = 0, tmax = best, miss = false;
    let t1 = (b0 - ox) * ix, t2 = (c0 - ox) * ix;
    if (!(t1 <= t2)) { const swap = t1; t1 = t2; t2 = swap; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) miss = true;
    if (!miss) {
      t1 = (b1 - oy) * iy; t2 = (c1 - oy) * iy;
      if (!(t1 <= t2)) { const swap = t1; t1 = t2; t2 = swap; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) miss = true;
    }
    if (!miss) {
      t1 = (b2 - oz) * iz; t2 = (c2 - oz) * iz;
      if (!(t1 <= t2)) { const swap = t1; t1 = t2; t2 = swap; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) miss = true;
    }
    if (miss) continue;
    if (left[node] < 0) {
      const to = start[node] + count[node];
      for (let k = start[node]; k < to; k++) {
        const t = order[k], a = indices[3 * t] * 3, b = indices[3 * t + 1] * 3, c = indices[3 * t + 2] * 3;
        const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
        const e1x = positions[b] - ax, e1y = positions[b + 1] - ay, e1z = positions[b + 2] - az;
        const e2x = positions[c] - ax, e2y = positions[c + 1] - ay, e2z = positions[c + 2] - az;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const determinant = e1x * px + e1y * py + e1z * pz;
        if (determinant > -1e-12 && determinant < 1e-12) continue;
        const inv = 1 / determinant;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (hit > 1e-6 && hit < best) { best = hit; found = true; if (out) out.tri = t; }
      }
    } else if (top + 2 <= stack.length) {
      stack[top++] = left[node];
      stack[top++] = right[node];
    }
  }
  return found ? best : Infinity;
}

// Last crossing along a direction: the exit point on the far side of the mesh.
export function raycastFar(bvh, origin, direction, maxDistance) {
  const step = Math.max(maxDistance * 1e-6, 1e-4);
  let travelled = 0, last = null;
  for (let i = 0; i < 64; i++) {
    const t = raycast(
      bvh,
      origin[0] + direction[0] * (travelled + step),
      origin[1] + direction[1] * (travelled + step),
      origin[2] + direction[2] * (travelled + step),
      direction[0], direction[1], direction[2],
      maxDistance - travelled - step
    );
    if (!Number.isFinite(t)) break;
    travelled += step + t;
    last = travelled;
  }
  return last;
}

// Picking: the nearest hit plus the surface normal at that point. Used by the
// editor to place seam samples exactly on the mesh.
export function raycastMesh(bvh, origin, direction) {
  // Accepts plain arrays and vector objects alike.
  const origin0 = origin.x !== undefined ? [origin.x, origin.y, origin.z] : origin;
  const direction0 = direction.x !== undefined ? [direction.x, direction.y, direction.z] : direction;
  origin = origin0; direction = direction0;
  const out = { tri: -1 };
  const distance = raycast(bvh, origin[0], origin[1], origin[2], direction[0], direction[1], direction[2], Infinity, out);
  if (!Number.isFinite(distance) || out.tri < 0) return null;
  const { positions, indices } = bvh;
  const a = indices[3 * out.tri] * 3, b = indices[3 * out.tri + 1] * 3, c = indices[3 * out.tri + 2] * 3;
  const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
  const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
  const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const length = Math.hypot(...normal) || 1;
  return { distance, normal: normal.map(v => v / length) };
}
