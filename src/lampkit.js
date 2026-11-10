// Lamp kit: an N-sided lamp (3-6 walls) of flat lithophane plates that lock together, plus a base for a
// round LED puck (default: Bambu Lab LED Lamp Kit 001, D59 x 8 mm).
//   walls  mitred edges joined by sliding dovetails (rail on the right edge, channel on the left edge)
//   base   LED pocket, cable slot at the back, finger notch at the front, and a groove the wall bottoms drop into
// Geometry is exact CSG (manifold-3d); every part comes out watertight. Units: mm, Z up.
// Wall k faces angle -90 + 360k/N (k = 0 is the front, k = 1 is to its right seen from outside).

export const LED_KITS = {
  bambu001: { label: 'Bambu Lab LED Lamp Kit 001', d: 59, h: 8 },
};
export const DEFAULT_FACE_W = { 3: 132, 4: 80, 5: 78, 6: 70 };

const TE = 6.0;           // frame / post thickness (inward)
const TB = 4.0;           // top border
const BB = 8.0;           // bottom band (4 visible + groove depth hidden)
const ROOT_W = 2.4, TIP_W = 3.4, DEPTH = 1.8;   // dovetail rail
const G_DEPTH = 4.0, FLOOR = 2.0, BASE_WALL = 4.0;
const OPAQUE = 50;

const rad = (d) => (d * Math.PI) / 180;
const polar = (r, deg) => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg))];

/** All derived dimensions for a lamp; throws with a readable message if the design cannot work. */
export function lampLayout(o) {
  const N = o.sides, half = 180 / N, tan = Math.tan(Math.PI / N), cos = Math.cos(Math.PI / N);
  const led = o.led || LED_KITS.bambu001;
  const pocketD = led.d + 0.8;
  const minA = pocketD / 2 + 2 + TE + o.grooveClr;               // LED pocket must fit inside the wall ring
  const minW = 2 * minA * tan;
  const W = Math.max(o.faceW, minW);
  const A = W / (2 * tan), R = A / cos;
  const clr = o.clr;
  // place the dovetail where the thinnest skin around its channel is largest
  const margins = (rj, sb) => {
    const d = polar(1, -90 - half), m = [-d[1], d[0]], c = [rj * d[0], rj * d[1]];
    let minY = Infinity, maxY = -Infinity, maxX = -Infinity;
    for (const u of [-(TIP_W / 2 + clr), TIP_W / 2 + clr, -(ROOT_W / 2 + clr), ROOT_W / 2 + clr]) for (const s of [0, DEPTH + clr]) {
      const x = c[0] + u * d[0] + s * m[0], y = c[1] + u * d[1] + s * m[1];
      minY = Math.min(minY, y); maxY = Math.max(maxY, y); maxX = Math.max(maxX, x);
    }
    return [minY + A, -A + TE - maxY, -(W - 2 * sb) / 2 - maxX];
  };
  let rj = R, best = -Infinity;
  for (let r = (A - TE) / cos; r <= R; r += 0.01) { const mm = Math.min(...margins(r, 0).slice(0, 2)); if (mm > best) { best = mm; rj = r; } }
  if (best < 0.6) throw new Error('The dovetail does not fit in the wall corners');
  let sb = 3; while (margins(rj, sb)[2] < 0.8) sb += 0.1;
  sb = Math.max(sb, 5.5);
  const IW = W - 2 * sb, IH = o.windowH, HW = IH + TB + BB;
  const pocketTop = FLOOR + led.h + 2;
  return { N, half, tan, cos, W, minW, A, R, rj, sb, IW, IH, HW, led, pocketD, pocketTop, baseH: pocketTop + G_DEPTH,
    clr, miter: o.miterClr, grooveClr: o.grooveClr, skins: best };
}

/** Builds the lamp. thick[k]: Float32Array rows x cols of wall k's lithophane thickness (top row first). */
export function buildLamp(M, L, thick, cols, rows) {
  const { Manifold, CrossSection, Mesh } = M;
  let trash = [];                                   // wasm objects to free; emptied after every part
  const keep = (x) => { trash.push(x); return x; };
  const free = () => { for (const x of trash) { try { x.delete(); } catch {} } trash = []; };
  const box = (x0, x1, y0, y1, z0, z1) => keep(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
  const prism = (pts, z0, z1) => { const cs = keep(new CrossSection([pts], 'EvenOdd')); return keep(cs.extrude(z1 - z0).translate([0, 0, z0])); };
  const ngon = (apothem) => Array.from({ length: L.N }, (_, k) => polar(apothem / L.cos, -90 + L.half + (360 / L.N) * k));

  function rail(phi, grow, z0, z1) {
    const d = polar(1, phi), m = [-d[1], d[0]], c = [L.rj * d[0], L.rj * d[1]];
    const pts = [[-ROOT_W / 2 - grow, -0.4], [ROOT_W / 2 + grow, -0.4], [ROOT_W / 2 + grow, 0], [TIP_W / 2 + grow, DEPTH + grow],
      [-TIP_W / 2 - grow, DEPTH + grow], [-ROOT_W / 2 - grow, 0]];
    return prism(pts.map(([u, s]) => [c[0] + u * d[0] + s * m[0], c[1] + u * d[1] + s * m[1]]), z0, z1);
  }

  function heightfield(T) {
    // watertight slab under the photo window: flat outer face at y = -A, inner relief at y = -A + t
    const ov = 0.6, nx = cols + 2, nz = rows + 2;
    const x0 = -L.IW / 2 - ov, x1 = L.IW / 2 + ov, z0 = BB - ov, z1 = BB + L.IH + ov;
    const n = nx * nz, pos = new Float32Array(n * 6);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const tj = Math.min(rows - 1, Math.max(0, j - 1)), ti = Math.min(cols - 1, Math.max(0, i - 1));
      const t = T[tj * cols + ti], v = j * nx + i;
      const x = x0 + ((x1 - x0) * i) / (nx - 1), z = z1 - ((z1 - z0) * j) / (nz - 1);
      pos.set([x, -L.A + t, z], v * 3); pos.set([x, -L.A, z], (v + n) * 3);
    }
    const tris = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      tris.push(a, b, c, a, c, d, a + n, c + n, b + n, a + n, d + n, c + n);
    }
    const ring = [];
    for (let i = 0; i < nx; i++) ring.push(i);
    for (let j = 1; j < nz; j++) ring.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) ring.push((nz - 1) * nx + i);
    for (let j = nz - 2; j > 0; j--) ring.push(j * nx);
    for (let k = 0; k < ring.length; k++) { const r0 = ring[k], r1 = ring[(k + 1) % ring.length]; tris.push(r0, r1 + n, r1, r0, r0 + n, r1 + n); }
    let idx = Uint32Array.from(tris);
    let m = keep(new Manifold(new Mesh({ numProp: 3, vertProperties: pos, triVerts: idx })));
    if (m.volume() < 0) {
      for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
      m = keep(new Manifold(new Mesh({ numProp: 3, vertProperties: pos, triVerts: idx })));
    }
    return m;
  }

  function wall(T) {
    const y0 = -L.A;
    const frame = box(-L.W, L.W, y0, y0 + TE, 0, L.HW).subtract(box(-L.IW / 2, L.IW / 2, y0 - 1, y0 + TE + 1, BB, BB + L.IH));
    keep(frame);
    let body = keep(frame.add(heightfield(T)));
    const dl = polar(1, -90 - L.half), dr = polar(1, -90 + L.half);
    const ml = [-dl[1], dl[0]], mr = [dr[1], -dr[0]];                     // inward normals of the miter edges
    const apex = [0, -L.miter / Math.sin(rad(L.half))];
    const wedge = prism([apex, [400 * dl[0] + L.miter * ml[0], 400 * dl[1] + L.miter * ml[1]],
      [400 * dr[0] + L.miter * mr[0], 400 * dr[1] + L.miter * mr[1]]], -1, L.HW + 1);
    body = keep(body.intersect(wedge));
    body = keep(body.add(rail(-90 + L.half, 0, 0, L.HW)));                  // rail on the right edge
    body = keep(body.subtract(rail(-90 - L.half, L.clr, -1, L.HW + 1)));    // channel on the left edge
    return body;
  }

  function base() {
    const outerA = L.A + L.grooveClr + BASE_WALL;
    const outline = keep(keep(keep(new CrossSection([ngon(outerA)], 'EvenOdd')).offset(-6, 'Round', 2, 48)).offset(6, 'Round', 2, 48));
    let b = keep(outline.extrude(L.baseH));
    const groove = keep(prism(ngon(L.A + L.grooveClr), L.pocketTop, L.baseH + 1).subtract(prism(ngon(L.A - TE - L.grooveClr), L.pocketTop - 1, L.baseH + 2)));
    const pocket = keep(Manifold.cylinder(L.baseH, L.pocketD / 2, L.pocketD / 2, 160).translate([0, 0, FLOOR]));
    const back = -90 + 180 + (L.N % 2 ? L.half : 0);                         // a back face centre
    const slot = keep(box(-7, 7, 0, L.A + 30, FLOOR, FLOOR + L.led.h + 0.5).rotate([0, 0, back - 90]));
    const notch = keep(Manifold.cylinder(L.baseH, 7.5, 7.5, 48).translate([0, -(L.pocketD / 2 - 1.5), FLOOR + 3]));
    for (const cut of [groove, pocket, slot, notch]) b = keep(b.subtract(cut));
    return b;
  }

  const out = { walls: [], base: null, report: { volumes: [], genus: [] } };
  try {
    for (let k = 0; k < L.N; k++) {
      const w = wall(thick[k]);
      out.report.volumes.push(w.volume()); out.report.genus.push(w.genus());
      out.walls.push(meshOf(w));
      free();                                         // full-resolution walls are large: free as we go
    }
    const b = base();
    out.report.baseVolume = b.volume();
    out.base = meshOf(b);
  } finally {
    free();
  }
  return out;

  function meshOf(m) {
    const g = m.getMesh();
    const np = g.numProp, vp = g.vertProperties, n = vp.length / np;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2]; }
    return { pos, idx: Uint32Array.from(g.triVerts) };
  }
}

/** Per-vertex thickness for backlit preview shading (front-wall coordinates). */
export function wallThickness(pos, L, T, cols, rows) {
  const th = new Float32Array(pos.length / 3);
  for (let v = 0; v < th.length; v++) {
    const x = pos[v * 3], z = pos[v * 3 + 2];
    const u = (x + L.IW / 2) / L.IW, w = (BB + L.IH - z) / L.IH;
    if (u >= 0 && u <= 1 && w >= 0 && w <= 1 && pos[v * 3 + 1] < -L.A + TE - 0.01) {
      th[v] = T[Math.min(rows - 1, Math.round(w * (rows - 1))) * cols + Math.min(cols - 1, Math.round(u * (cols - 1)))];
    } else th[v] = TE;
  }
  return th;
}

/** Rotate a front-wall mesh to wall k's place and lift it onto the base. */
export function placeWall(pos, L, k, lift = 0, out = 0) {
  const a = rad((360 / L.N) * k), c = Math.cos(a), s = Math.sin(a);
  const nx = Math.cos(rad(-90 + (360 / L.N) * k)), ny = Math.sin(rad(-90 + (360 / L.N) * k));
  const p = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1];
    p[i] = x * c - y * s + nx * out; p[i + 1] = x * s + y * c + ny * out; p[i + 2] = pos[i + 2] + L.pocketTop + lift;
  }
  return p;
}

/** Lay a front wall flat for printing: smooth outer face on the bed, relief facing up. */
export function printPose(pos, L) {
  const p = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { p[i] = pos[i]; p[i + 1] = L.HW - pos[i + 2]; p[i + 2] = pos[i + 1] + L.A; }
  return p;
}
