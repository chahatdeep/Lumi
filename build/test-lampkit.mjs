// Headless check of the lamp kit geometry for 3-6 sides: every part closed, no two parts overlapping.
// Usage: node build/test-lampkit.mjs
import Module from '../node_modules/manifold-3d/manifold.js';
import { lampLayout, buildLamp, placeWall, placeTop, DEFAULT_FACE_W } from '../src/lampkit.js';

const M = await Module(); M.setup();
const { Manifold, Mesh } = M;
let ok = true;
for (const N of [3, 4, 5, 6]) {
  const L = lampLayout({ sides: N, faceW: DEFAULT_FACE_W[N], windowH: 94, clr: 0.18, miterClr: 0.1, grooveClr: 0.25 });
  const cols = Math.round(L.IW / 1.0) + 1, rows = Math.round(L.IH / 1.0) + 1;
  const thick = Array.from({ length: N }, (_, k) => Float32Array.from({ length: cols * rows }, (_, i) => 0.8 + 2.4 * (((i % cols) + k * 7) % 13) / 12));
  const t0 = performance.now();
  const tc = Math.round(L.top.W) + 1, tr = Math.round(L.top.H) + 1;
  const top = { T: Float32Array.from({ length: tc * tr }, (_, i) => 0.8 + 2.4 * ((i * 5) % 11) / 10), cols: tc, rows: tr };
  const r = buildLamp(M, L, thick, cols, rows, top);
  const ms = performance.now() - t0;
  const solid = (pos, idx) => new Manifold(new Mesh({ numProp: 3, vertProperties: pos, triVerts: idx }));
  const walls = r.walls.map((w, k) => solid(placeWall(w.pos, L, k), w.idx));
  const base = solid(r.base.pos, r.base.idx);
  const lid = solid(placeTop(r.top.pos, L), r.top.idx);
  let worst = 0;
  for (let k = 0; k < N; k++) {
    const a = walls[k].intersect(walls[(k + 1) % N]), b = walls[k].intersect(base);
    const c = walls[k].intersect(lid);
    worst = Math.max(worst, a.volume(), b.volume(), c.volume()); a.delete(); b.delete(); c.delete();
  }
  const good = worst < 1e-3 && r.report.genus.every((g) => g === 0) && r.report.topGenus === 0;
  ok &&= good;
  console.log(`N=${N}: walls ${L.W.toFixed(1)} x ${L.HW} mm (window ${L.IW.toFixed(1)} x ${L.IH}, side border ${L.sb.toFixed(1)}), ` +
    `lamp ${(N % 2 ? 2 * L.R : 2 * L.A).toFixed(0)} x ${L.height.toFixed(0)} mm | top photo ${L.top.W.toFixed(0)} x ${L.top.H.toFixed(0)} | genus ${r.report.genus.join(',')} lid ${r.report.topGenus} | overlap ${worst.toFixed(4)} mm3 | ` +
    `skins ${L.skins.toFixed(2)} mm | ${ms.toFixed(0)} ms ${good ? 'OK' : 'FAIL'}`);
  for (const m of [...walls, base, lid]) m.delete();
}
process.exit(ok ? 0 : 1);
