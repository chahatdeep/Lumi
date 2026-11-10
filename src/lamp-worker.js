// Lamp kit worker: exact CSG with manifold-3d (WebAssembly) off the UI thread.
import Module from './vendor/manifold.js';
import { lampLayout, buildLamp, wallThickness, printPose } from './lampkit.js';
import { simplifyMesh } from './simplify.js';
import { toSTLBinary } from './exporters.js';
import { zipSync, strToU8 } from './vendor/fflate.js';

let M = null;
async function kernel() {
  if (!M) { M = await Module({ locateFile: (f) => new URL('./vendor/' + f, import.meta.url).href }); M.setup(); }
  return M;
}

function isClosed(idx) {
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3], k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return true;
}

// Edge collapse can leave a triangle and its mirror twin (a zero-volume sliver); drop such pairs.
function dropTwins(idx) {
  const key = (t) => { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; const s = [a, b, c].sort((x, y) => x - y); return s.join(','); };
  const count = new Map();
  for (let t = 0; t < idx.length; t += 3) { const k = key(t); count.set(k, (count.get(k) || 0) + 1); }
  if ([...count.values()].every((n) => n === 1)) return idx;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) if (count.get(key(t)) === 1) out.push(idx[t], idx[t + 1], idx[t + 2]);
  return Uint32Array.from(out);
}

function readme(L, name) {
  return [
    `${name}: ${L.N}-sided Lumi lithophane lamp`,
    '',
    `Parts: wall-1 ... wall-${L.N}.stl (wall 1 = front, the rest go round to its right) and base.stl.`,
    `Lamp: ${(L.N % 2 ? 2 * L.R : 2 * L.A).toFixed(0)} mm across, ${(L.pocketTop + L.HW).toFixed(0)} mm tall. Walls ${L.W.toFixed(1)} x ${L.HW.toFixed(1)} mm.`,
    `LED: ${L.led.label || 'round LED puck'} (D${L.led.d} x ${L.led.h} mm).`,
    '',
    'Print',
    '  Walls: white PLA, flat with the smooth outer face down, 100% infill, 0.12 mm layers, no supports.',
    '  Base:  any colour, 15% infill, no supports.',
    '',
    'Assemble',
    '  1. Press the LED puck into the base pocket, USB-C port toward the cable slot at the back.',
    `  2. Slide the walls together in order (1 -> 2 -> ... -> ${L.N}): each wall's channel slides down over the previous wall's rail.`,
    `  3. Slide wall ${L.N} down so it engages wall ${L.N - 1} and wall 1 at once, closing the ring.`,
    '  4. Lower the ring into the groove in the base. Lift it off to reach the LED (finger notch at the front).',
    '',
    `Fit: dovetail clearance ${L.clr} mm, mitre gap ${L.miter} mm, groove clearance ${L.grooveClr} mm (adjustable in Lumi > Lamp > Fit).`,
    'Made with Lumi: https://chahatdeep.github.io/Lumi/',
  ].join('\n');
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    const Mk = await kernel();
    const L = lampLayout(msg.params);
    if (msg.type === 'build') {
      const t0 = performance.now();
      const r = buildLamp(Mk, L, msg.thick, msg.cols, msg.rows);
      const walls = r.walls.map((w, k) => ({ ...w, thick: wallThickness(w.pos, L, msg.thick[k], msg.cols, msg.rows) }));
      const transfer = [];
      for (const w of walls) transfer.push(w.pos.buffer, w.idx.buffer, w.thick.buffer);
      transfer.push(r.base.pos.buffer, r.base.idx.buffer);
      self.postMessage({ type: 'lamp', id: msg.id, layout: L, walls, base: r.base, report: { ...r.report, ms: performance.now() - t0 } }, transfer);
    } else if (msg.type === 'export') {
      const progress = (stage, p) => self.postMessage({ type: 'progress', stage, p });
      progress('Building the plates', 0.05);
      const r = buildLamp(Mk, L, msg.thick, msg.cols, msg.rows);
      const files = {}, stats = { walls: [], closed: true };
      r.walls.forEach((w, k) => {
        progress(`Optimizing wall ${k + 1} of ${L.N}`, 0.15 + (0.75 * k) / L.N);
        const s = simplifyMesh(printPose(w.pos, L), w.idx, { tolerance: 0.02, maxTriangles: msg.maxTriangles });
        const idx = dropTwins(s.idx);
        stats.walls.push(idx.length / 3);
        stats.closed = stats.closed && isClosed(idx);
        files[`wall-${k + 1}.stl`] = toSTLBinary(s.pos, idx, `${msg.name} wall ${k + 1}`);
      });
      files['base.stl'] = toSTLBinary(r.base.pos, r.base.idx, `${msg.name} base`);
      files['README.txt'] = strToU8(readme(L, msg.name));
      progress('Packing', 0.95);
      const data = zipSync(files, { level: 6 });
      self.postMessage({ type: 'file', data, stats: { ...stats, triangles: stats.walls.reduce((a, b) => a + b, 0) + r.base.idx.length / 3, bytes: data.length } }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};
