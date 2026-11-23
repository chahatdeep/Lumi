// Lamp kit worker: exact CSG with manifold-3d (WebAssembly) off the UI thread.
import Module from './vendor/manifold.js';
import { lampLayout, buildLamp, wallThickness, printPose, topThickness, topPrintPose, fitLayout } from './lampkit.js';
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

// put a part on the bed (z = 0)
function onBed(pos) {
  let z0 = Infinity;
  for (let i = 2; i < pos.length; i += 3) z0 = Math.min(z0, pos[i]);
  const p = Float32Array.from(pos);
  for (let i = 2; i < p.length; i += 3) p[i] -= z0;
  return p;
}

function fitReadme(L, name) {
  return [
    `${name}: fit test for a ${L.N}-sided Lumi lamp (${L.joint === 'push' ? 'push-fit' : 'dovetail'} joints)`,
    '',
    'Print these short parts before the full lamp. They have exactly the same joints as the real parts,',
    'so if they fit, the lamp will. Use the same printer, filament and settings you will use for the walls.',
    '',
    `Parts: wall-1 ... wall-${L.N}.stl (${L.HW} mm slices of the walls), base-ring.stl (the base slot) and top-ring.stl (the groove under the top).`,
    '',
    'Check',
    L.joint === 'push'
      ? '  1. Push each wall slice into the base ring. It should need a firm push and then stay put.'
      : `  1. Slide the wall slices together in order (1 -> 2 -> ... -> ${L.N}). They should slide by hand with no wobble.`,
    L.joint === 'push' ? null : '     Close the ring with the last slice: it has to engage both neighbours at once.',
    '  2. Drop the ring of walls into the base ring. It should drop in by hand and not rock.',
    '  3. Press the top ring on. It should go down all the way and hold the wall tops together.',
    '',
    'Adjust (Lumi > Lamp > Fit), then export the full lamp',
    L.joint === 'push'
      ? '  Walls loose in the slots: raise Push-fit grip. Too hard to push: lower it.'
      : '  Dovetails tight or binding: raise Dovetail gap by 0.05 mm. Wobbly: lower it.',
    '  Ring or top will not go on: raise Slot gap by 0.05 mm. Loose: lower it.',
    '  Corners pinch before the ring closes: raise Corner gap.',
    '',
    `These settings: dovetail gap ${L.clr} mm, corner gap ${L.miter} mm, slot gap ${L.grooveClr} mm${L.joint === 'push' ? `, grip ${L.grip} mm` : ''}.`,
  ].filter((l) => l !== null).join('\n');
}

function readme(L, name) {
  return [
    `${name}: ${L.N}-sided Lumi lithophane lamp`,
    '',
    `Parts: wall-1 ... wall-${L.N}.stl (wall 1 = front, the rest go round to its right), top.stl (photo lid) and base.stl (LED fixture).`,
    `Lamp: ${(L.N % 2 ? 2 * L.R : 2 * L.A).toFixed(0)} mm across, ${L.height.toFixed(0)} mm tall. Walls ${L.W.toFixed(1)} x ${L.HW.toFixed(1)} mm.`,
    `LED: ${L.led.label || 'round LED puck'} (D${L.led.d} x ${L.led.h} mm).`,
    '',
    'Print',
    '  Walls: white PLA, flat with the smooth inner face down (relief up), 100% infill, 0.12 mm layers, no supports.',
    '  Top:   white PLA, right side up as exported (relief up), same settings, no supports: the groove roof bridges.',
    '  Base:  any colour, 15% infill, no supports.',
    '',
    'Assemble',
    '  1. Plug the cable into the LED puck and press the puck into the pocket, USB-C port toward the slot at the back.',
    '     Drop the wire into the slit from the top so it leaves through the slot: the plug on its far end stays outside.',
    ...(L.joint === 'push' ? [
      `  2. Push each wall straight down into its slot in the base, flat face in, relief out (wall 1 at the front, by the finger notch;`,
      `     the rest go round to its right). Two small ribs in each slot grip the wall.`,
      '  3. Press the top down over the wall tops: they drop into the slot under it, which holds the corners together.',
      '  To reach the LED, pull the top off, then lift a wall out.',
    ] : [
      `  2. Slide the walls together in order (1 -> 2 -> ... -> ${L.N}): each wall's channel slides down over the previous wall's rail.`,
      `  3. Slide wall ${L.N} down so it engages wall ${L.N - 1} and wall 1 at once, closing the ring.`,
      '  4. Lower the ring into the groove in the base. Lift it off to reach the LED (finger notch at the front).',
      '  5. Press the top on: the wall tops drop into the groove under it, locking the ring at the top too.',
    ]),
    '',
    L.joint === 'push'
      ? `Fit: rib grip ${L.grip} mm, mitre gap ${L.miter} mm, slot clearance ${L.grooveClr} mm (adjustable in Lumi > Lamp > Fit).`
      : `Fit: dovetail clearance ${L.clr} mm, mitre gap ${L.miter} mm, groove clearance ${L.grooveClr} mm (adjustable in Lumi > Lamp > Fit).`,
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
      const r = buildLamp(Mk, L, msg.thick, msg.cols, msg.rows, msg.top);
      const walls = r.walls.map((w, k) => ({ ...w, thick: wallThickness(w.pos, L, msg.thick[k], msg.cols, msg.rows) }));
      const transfer = [];
      for (const w of walls) transfer.push(w.pos.buffer, w.idx.buffer, w.thick.buffer);
      transfer.push(r.base.pos.buffer, r.base.idx.buffer);
      const top = r.top && { ...r.top, thick: topThickness(r.top.pos, L, msg.top.T, msg.top.cols, msg.top.rows) };
      if (top) transfer.push(top.pos.buffer, top.idx.buffer, top.thick.buffer);
      self.postMessage({ type: 'lamp', id: msg.id, layout: L, walls, base: r.base, top, report: { ...r.report, ms: performance.now() - t0 } }, transfer);
    } else if (msg.type === 'fittest') {
      const F = fitLayout(L);
      self.postMessage({ type: 'progress', stage: 'Building the fit test', p: 0.2 });
      const r = buildLamp(Mk, F, null, 0, 0, { T: new Float32Array(1), cols: 1, rows: 1 });
      const files = {}, stats = { walls: [], closed: true };
      r.walls.forEach((w, k) => {
        stats.closed = stats.closed && isClosed(w.idx);
        files[`wall-${k + 1}.stl`] = toSTLBinary(onBed(printPose(w.pos, F)), w.idx, `${msg.name} fit wall ${k + 1}`);
      });
      stats.closed = stats.closed && isClosed(r.base.idx) && isClosed(r.top.idx);
      files['base-ring.stl'] = toSTLBinary(onBed(r.base.pos), r.base.idx, `${msg.name} fit base ring`);
      files['top-ring.stl'] = toSTLBinary(onBed(topPrintPose(r.top.pos, F)), r.top.idx, `${msg.name} fit top ring`);
      files['README.txt'] = strToU8(fitReadme(F, msg.name));
      const tri = r.walls.reduce((a, w) => a + w.idx.length / 3, 0) + r.base.idx.length / 3 + r.top.idx.length / 3;
      const data = zipSync(files, { level: 6 });
      self.postMessage({ type: 'file', data, stats: { ...stats, triangles: tri, bytes: data.length } }, [data.buffer]);
    } else if (msg.type === 'export') {
      const progress = (stage, p) => self.postMessage({ type: 'progress', stage, p });
      progress('Building the plates', 0.05);
      const r = buildLamp(Mk, L, msg.thick, msg.cols, msg.rows, msg.top);
      const files = {}, stats = { walls: [], closed: true };
      r.walls.forEach((w, k) => {
        progress(`Optimizing wall ${k + 1} of ${L.N}`, 0.15 + (0.75 * k) / L.N);
        const s = simplifyMesh(onBed(printPose(w.pos, L)), w.idx, { tolerance: 0.02, maxTriangles: msg.maxTriangles });
        const idx = dropTwins(s.idx);
        stats.walls.push(idx.length / 3);
        stats.closed = stats.closed && isClosed(idx);
        files[`wall-${k + 1}.stl`] = toSTLBinary(s.pos, idx, `${msg.name} wall ${k + 1}`);
      });
      if (r.top) {
        progress('Optimizing the top', 0.9);
        const s = simplifyMesh(onBed(topPrintPose(r.top.pos, L)), r.top.idx, { tolerance: 0.02, maxTriangles: msg.maxTriangles });
        const idx = dropTwins(s.idx);
        stats.top = idx.length / 3;
        stats.closed = stats.closed && isClosed(idx);
        files['top.stl'] = toSTLBinary(s.pos, idx, `${msg.name} top`);
      }
      files['base.stl'] = toSTLBinary(r.base.pos, r.base.idx, `${msg.name} base`);
      files['README.txt'] = strToU8(readme(L, msg.name));
      progress('Packing', 0.95);
      const data = zipSync(files, { level: 6 });
      self.postMessage({ type: 'file', data, stats: { ...stats, triangles: stats.walls.reduce((a, b) => a + b, 0) + (stats.top || 0) + r.base.idx.length / 3, bytes: data.length } }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};
