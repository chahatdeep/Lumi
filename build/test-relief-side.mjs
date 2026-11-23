// Checks which way the lithophane relief faces for every Model-tab shape. The side facing the light (inside a
// round lamp; the back of a flat or curved panel, where the night light, lamp fitting and stand sit) must stay
// planar, so the relief faces out (toward the viewer). 'Relief inside' flips it.
// Method: build each shape all white (thinnest) and all black (thickest). Vertices that move are the relief;
// the direction they move is the direction the relief faces.
// Usage: node build/test-relief-side.mjs
import fs from 'fs';
import { buildModel } from '../src/mesh.js';
import { computeLayout } from '../src/layout.js';

const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const a = src.indexOf('const DEFAULTS = {');
const DEFAULTS = Function(`return (${src.slice(a + 17, src.indexOf('\n};', a) + 2)})`)();

let ok = true;
function check(name, over, inside) {
  const s = { ...DEFAULTS, previewQuality: 0, ...over, inside };
  const L = computeLayout(s, 'preview');
  const build = (b) => buildModel(s, new Float32Array(L.imgCols * L.imgRows).fill(b), 'preview').pos;
  const thin = build(1), thick = build(0);
  if (thin.length !== thick.length) throw new Error(name + ': topology changed');
  const axis = ['cylinder', 'polygon', 'sphere'].includes(s.shape);
  let out = 0, inw = 0;
  for (let i = 0; i < thin.length; i += 3) {
    const dx = thick[i] - thin[i], dy = thick[i + 1] - thin[i + 1], dz = thick[i + 2] - thin[i + 2];
    if (Math.hypot(dx, dy, dz) < 1e-6) continue;                 // planar side (or fittings): does not move
    // outward: away from the light. Panels: toward the viewer (-Y). Round shapes: away from the axis.
    const o = axis ? (s.shape === 'sphere' ? [thin[i], thin[i + 1], 0] : [thin[i], thin[i + 1], 0]) : [0, -1, 0];
    const d = dx * o[0] + dy * o[1] + dz * o[2];
    if (d > 0) out++; else if (d < 0) inw++;
  }
  const faces = out > inw ? 'out' : 'in';
  const good = faces === (inside ? 'in' : 'out');
  if (!good) ok = false;
  console.log(`${name.padEnd(22)} Relief inside ${inside ? 'on ' : 'off'}: relief faces ${faces.padEnd(3)} (${out} out, ${inw} in)  light side ${faces === 'out' ? 'planar  ' : 'textured'} ${good ? 'OK' : 'FAIL'}`);
}
for (const inside of [false, true]) {
  check('flat', { shape: 'plane' }, inside);
  check('flat + night light', { shape: 'plane', nightlight: true }, inside);
  check('flat + lamp fitting', { shape: 'plane', lamp: true }, inside);
  check('flat + stand', { shape: 'plane', stand: true }, inside);
  check('curved', { shape: 'curve' }, inside);
  check('curved + lamp fitting', { shape: 'curve', lamp: true }, inside);
  check('cylinder', { shape: 'cylinder', width: 80 }, inside);
  check('prism (6)', { shape: 'polygon', width: 90 }, inside);
  check('globe', { shape: 'sphere', width: 100 }, inside);
}
console.log(ok ? 'all OK' : 'FAILED');
if (!ok) process.exit(1);
