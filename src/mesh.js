// Lithophane mesh generation. Produces a watertight, consistently-wound indexed mesh.
// Coordinates are millimetres, Z up, viewer looks from -Y toward +Y.

import { computeLayout } from './layout.js';

const DEG = Math.PI / 180;

// ---------- outline masks (u, v in [-1, 1], v up) ----------
const STAR = (() => {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 1 : 0.45;
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
})();

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function makeMask(s, W, H) {
  switch (s.outline) {
    case 'rounded': {
      const r = Math.min(s.cornerRadius, W / 2, H / 2);
      return (u, v) => {
        const x = Math.abs(u) * W / 2, y = Math.abs(v) * H / 2;
        if (x > W / 2 || y > H / 2) return false;
        const qx = x - (W / 2 - r), qy = y - (H / 2 - r);
        if (qx <= 0 || qy <= 0) return true;
        return qx * qx + qy * qy <= r * r;
      };
    }
    case 'ellipse': return (u, v) => u * u + v * v <= 1;
    case 'heart': return (u, v) => {
      const x = u * 1.14, y = -1 + (v + 1) * 1.12;
      const a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    };
    case 'hexagon': return (u, v) => Math.abs(v) <= 1 && Math.abs(u) + 0.5 * Math.abs(v) <= 1;
    case 'octagon': return (u, v) => Math.abs(u) <= 1 && Math.abs(v) <= 1 && Math.abs(u) + Math.abs(v) <= 1.414;
    case 'star': return (u, v) => inPoly(u * 0.951, v * 0.9045 + 0.0955, STAR);
    case 'arch': {
      const rx = W / 2, ry = Math.min(W / 2, H);
      return (u, v) => {
        const x = u * W / 2, y = (v + 1) * H / 2; // y from bottom
        if (Math.abs(x) > W / 2 || y < 0 || y > H) return false;
        const cy = H - ry;
        if (y <= cy) return true;
        const dx = x / rx, dy = (y - cy) / ry;
        return dx * dx + dy * dy <= 1;
      };
    }
    default: return null; // rectangle
  }
}

// ---------- 2D squared Euclidean distance transform (Felzenszwalb), anisotropic ----------
function edt1d(f, n, step, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    do {
      const r = v[k];
      s = (f[q] + q * q * step * step - (f[r] + r * r * step * step)) / (2 * step * step * (q - r));
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = (q - v[k]) * step;
    d[q] = dq * dq + f[v[k]];
  }
}

export function edt2d(grid, cols, rows, dx, dy) {
  const BIG = 1e20;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const out = new Float64Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = grid[i] ? 0 : BIG;
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < rows; i++) f[i] = out[i * cols + j];
    edt1d(f, rows, dy, d, v, z);
    for (let i = 0; i < rows; i++) out[i * cols + j] = d[i];
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) f[j] = out[i * cols + j];
    edt1d(f, cols, dx, d, v, z);
    for (let j = 0; j < cols; j++) out[i * cols + j] = Math.sqrt(d[j]);
  }
  return out;
}

// ---------- thickness mapping ----------
export function thicknessMapper(s) {
  const tmin = s.minThick, tmax = Math.max(s.maxThick, s.minThick + 0.01);
  if (s.mapping === 'light') {
    const k = s.attenuation;
    const Tmax = Math.exp(-k * tmin), Tmin = Math.exp(-k * tmax);
    return (b) => -Math.log(Tmin + b * (Tmax - Tmin)) / k;
  }
  return (b) => tmax - (tmax - tmin) * b;
}

// ---------- mesh accumulation ----------
class MeshBuilder {
  constructor() { this.parts = []; }
  add(pos, idx, thick) { this.parts.push({ pos, idx, thick }); }
  merge() {
    let nv = 0, ni = 0;
    for (const p of this.parts) { nv += p.pos.length / 3; ni += p.idx.length; }
    const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni), thick = new Float32Array(nv);
    let vo = 0, io = 0;
    for (const p of this.parts) {
      pos.set(p.pos, vo * 3);
      thick.set(p.thick, vo);
      for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
      vo += p.pos.length / 3; io += p.idx.length;
    }
    return { pos, idx, thick };
  }
}

// Flip triangles if the closed part has negative signed volume (inside-out).
function orient(pos, idx) {
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  return Math.abs(vol) / 6;
}

const OPAQUE = 50; // pseudo thickness for solid accessory parts (renders dark when backlit)

function boxPart(cx, cy, z0, sx, sy, sz, angle = 0) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const pos = new Float32Array(24);
  const corners = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  corners.forEach(([x, y, z], i) => {
    const lx = x * sx / 2, ly = y * sy / 2;
    pos[i * 3] = cx + lx * ca - ly * sa;
    pos[i * 3 + 1] = cy + lx * sa + ly * ca;
    pos[i * 3 + 2] = z0 + z * sz;
  });
  const idx = new Uint32Array([0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 1, 2, 6, 1, 6, 5]);
  orient(pos, idx);
  return { pos, idx, thick: new Float32Array(8).fill(OPAQUE) };
}

// Solid of revolution from a closed (r, z) profile loop.
function lathePart(cx, cy, profile, segs = 72) {
  const np = profile.length;
  const pos = new Float32Array(segs * np * 3);
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let p = 0; p < np; p++) {
      const o = (k * np + p) * 3;
      pos[o] = cx + profile[p][0] * c; pos[o + 1] = cy + profile[p][0] * s; pos[o + 2] = profile[p][1];
    }
  }
  const idx = new Uint32Array(segs * np * 6);
  let t = 0;
  for (let k = 0; k < segs; k++) {
    const k1 = (k + 1) % segs;
    for (let p = 0; p < np; p++) {
      const q = (p + 1) % np;
      const a = k * np + p, b = k * np + q, c = k1 * np + q, d = k1 * np + p;
      idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = a; idx[t++] = c; idx[t++] = d;
    }
  }
  orient(pos, idx);
  return { pos, idx, thick: new Float32Array(segs * np).fill(OPAQUE) };
}

function ringPart(cx, cy, z0, rIn, rOut, h) {
  return lathePart(cx, cy, [[rIn, z0], [rOut, z0], [rOut, z0 + h], [rIn, z0 + h]]);
}

// ---------- main builder ----------
export function buildModel(s, gray, mode = 'preview') {
  const L = computeLayout(s, mode);
  const { cols, rows, padL, padT, imgCols, imgRows, dx, dy, W, H, wrap, fw } = L;
  const n = cols * rows;
  const T = new Float32Array(n);
  const inc = new Uint8Array(n);
  const map = thicknessMapper(s);
  const tmin = s.minThick, tmax = Math.max(s.maxThick, tmin + 0.01);
  const frameOn = s.frame !== 'none';
  const D = Math.max(s.frameDepth, tmin);
  // bevel slope: user angle, but steep enough to reach full depth leaving a flat top band
  const fwMax = Math.max(fw.l, fw.r, fw.t, fw.b, 0.01);
  const tanA = Math.max(Math.tan(Math.min(89.9, Math.max(5, s.frameAngle)) * DEG), (D - tmin) / (0.7 * fwMax));
  const eps = 1e-6;

  const sx = (j) => (j - padL) * dx;
  const zz = (i) => H - (i - padT) * dy;

  const mask = !wrap ? makeMask(s, W, H) : null;
  const inMask = (x, z) => {
    if (x < -eps || x > W + eps || z < -eps || z > H + eps) return false;
    if (!mask) return true;
    return mask((x / W) * 2 - 1, (z / H) * 2 - 1);
  };

  // pass 1: image region
  const maskGrid = new Uint8Array(n);
  for (let i = 0; i < rows; i++) {
    const z = zz(i);
    for (let j = 0; j < cols; j++) if (inMask(sx(j), z)) maskGrid[i * cols + j] = 1;
  }

  const dist = frameOn && mask ? edt2d(maskGrid, cols, rows, dx, dy) : null;

  // hanger tab placement
  let hzc = 0;
  if (L.hanger) {
    let topZ = H;
    if (mask) {
      for (let v = 1; v >= -1; v -= 0.002) if (mask(0, v)) { topZ = ((v + 1) / 2) * H; break; }
    }
    hzc = topZ + (frameOn ? fw.t : 0) + L.hr + 0.5;
  }
  const tabT = frameOn ? Math.max(D, tmax) : tmax;

  const frameProfile = (d, f) => {
    let h;
    if (s.frame === 'rounded') h = tmin + (D - tmin) * Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2));
    else if (s.frame === 'flat') h = D;
    else h = Math.min(D, tmin + d * tanA);
    return Math.max(h, tmin);
  };

  for (let i = 0; i < rows; i++) {
    const z = zz(i);
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      const x = sx(j);
      if (L.hanger) {
        const hd = Math.hypot(x - W / 2, z - hzc);
        if (hd < L.hr) continue; // hole
      }
      if (maskGrid[k]) {
        const ii = i - padT, jj = j - padL;
        T[k] = map(gray[ii * imgCols + jj]);
        inc[k] = 1;
        continue;
      }
      if (frameOn) {
        if (dist) {
          const d = dist[k];
          if (d <= fw.t + eps) { T[k] = frameProfile(d, d / fw.t); inc[k] = 1; continue; }
        } else {
          const dl = Math.max(0, -x), dr = Math.max(0, x - W), dt = Math.max(0, z - H), db = Math.max(0, -z);
          if (dl <= fw.l + eps && dr <= fw.r + eps && dt <= fw.t + eps && db <= fw.b + eps) {
            const d = Math.max(dl, dr, dt, db);
            const f = Math.max(fw.l ? dl / fw.l : 0, fw.r ? dr / fw.r : 0, fw.t ? dt / fw.t : 0, fw.b ? db / fw.b : 0);
            T[k] = frameProfile(d, f);
            inc[k] = 1;
            continue;
          }
        }
      }
      if (L.hanger && Math.hypot(x - W / 2, z - hzc) <= L.hR) { T[k] = tabT; inc[k] = 1; }
    }
  }

  // ---------- surface: base point and normal per vertex ----------
  const sign = s.inside ? -1 : 1;
  const colX = new Float64Array(cols), colY = new Float64Array(cols), colNX = new Float64Array(cols), colNY = new Float64Array(cols);
  let sphere = null, axis = false, R = 0;
  if (s.shape === 'plane') {
    for (let j = 0; j < cols; j++) { colX[j] = sx(j) - W / 2; colY[j] = 0; colNX[j] = 0; colNY[j] = 1; }
  } else if (s.shape === 'curve') {
    R = W / Math.max(1e-3, s.curveAngle * DEG);
    for (let j = 0; j < cols; j++) {
      const th = (sx(j) - W / 2) / R;
      colX[j] = R * Math.sin(th); colY[j] = -R + R * Math.cos(th);
      colNX[j] = Math.sin(th); colNY[j] = Math.cos(th);
    }
  } else if (s.shape === 'cylinder') {
    R = s.width / 2; axis = true;
    for (let j = 0; j < cols; j++) {
      const th = (sx(j) - W / 2) / R;
      colX[j] = R * Math.sin(th); colY[j] = -R * Math.cos(th);
      colNX[j] = Math.sin(th); colNY[j] = -Math.cos(th);
    }
  } else if (s.shape === 'polygon') {
    const m = s.polySides; R = s.width / 2; axis = true;
    const side = W / m;
    const vx = [], vy = [];
    for (let k = 0; k <= m; k++) { const a = -Math.PI / m + (2 * Math.PI * k) / m; vx.push(R * Math.sin(a)); vy.push(-R * Math.cos(a)); }
    const miter = 1 / Math.cos(Math.PI / m);
    for (let j = 0; j < cols; j++) {
      let sp = sx(j) - W / 2 + side / 2;
      sp = ((sp % W) + W) % W;
      let f = Math.floor(sp / side + 1e-9);
      let frac = sp / side - f;
      if (frac > 1 - 1e-7) { f += 1; frac = 0; }
      f %= m;
      if (frac < 1e-7) {
        const a = -Math.PI / m + (2 * Math.PI * f) / m;
        colX[j] = vx[f]; colY[j] = vy[f];
        colNX[j] = Math.sin(a) * miter; colNY[j] = -Math.cos(a) * miter;
      } else {
        colX[j] = vx[f] + (vx[f + 1] - vx[f]) * frac; colY[j] = vy[f] + (vy[f + 1] - vy[f]) * frac;
        const a = (2 * Math.PI * f) / m;
        colNX[j] = Math.sin(a); colNY[j] = -Math.cos(a);
      }
    }
  } else if (s.shape === 'sphere') {
    R = s.width / 2; axis = true;
    const phiB = s.sphereBottom * DEG;
    sphere = { phi: new Float64Array(rows) };
    for (let i = 0; i < rows; i++) {
      let phi = phiB + zz(i) / R;
      phi = Math.max(-88 * DEG, Math.min(88 * DEG, phi));
      sphere.phi[i] = phi;
    }
    for (let j = 0; j < cols; j++) {
      const th = (sx(j) - W / 2) / R;
      colNX[j] = Math.sin(th); colNY[j] = -Math.cos(th);
    }
  }

  // ---------- quads ----------
  const qcols = wrap ? cols : cols - 1;
  const qrows = rows - 1;
  const Q = new Uint8Array(qrows * qcols);
  for (let i = 0; i < qrows; i++) {
    for (let j = 0; j < qcols; j++) {
      const j1 = (j + 1) % cols;
      if (inc[i * cols + j] && inc[i * cols + j1] && inc[(i + 1) * cols + j1] && inc[(i + 1) * cols + j]) Q[i * qcols + j] = 1;
    }
  }
  const qAt = (i, j) => {
    if (i < 0 || i >= qrows) return 0;
    if (wrap) j = ((j % qcols) + qcols) % qcols;
    else if (j < 0 || j >= qcols) return 0;
    return Q[i * qcols + j];
  };

  // used vertices
  const vid = new Int32Array(n).fill(-1);
  let nv = 0, ntri = 0;
  for (let i = 0; i < qrows; i++) {
    for (let j = 0; j < qcols; j++) {
      if (!Q[i * qcols + j]) continue;
      const j1 = (j + 1) % cols;
      for (const k of [i * cols + j, i * cols + j1, (i + 1) * cols + j1, (i + 1) * cols + j]) if (vid[k] < 0) vid[k] = nv++;
      ntri += 4;
      if (!qAt(i - 1, j)) ntri += 2;
      if (!qAt(i, j + 1)) ntri += 2;
      if (!qAt(i + 1, j)) ntri += 2;
      if (!qAt(i, j - 1)) ntri += 2;
    }
  }

  const pos = new Float32Array(nv * 6);
  const thick = new Float32Array(nv * 2);
  for (let i = 0; i < rows; i++) {
    const z = zz(i);
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j, v = vid[k];
      if (v < 0) continue;
      const t = T[k];
      let bx, by, bz, nx, ny, nz;
      if (sphere) {
        const phi = sphere.phi[i], cp = Math.cos(phi), sp = Math.sin(phi);
        nx = colNX[j] * cp; ny = colNY[j] * cp; nz = sp;
        bx = R * nx; by = R * ny; bz = R * nz;
      } else {
        bx = colX[j]; by = colY[j]; bz = z; nx = colNX[j]; ny = colNY[j]; nz = 0;
      }
      const o = v * 3, ob = (v + nv) * 3;
      pos[o] = bx + sign * nx * t; pos[o + 1] = by + sign * ny * t; pos[o + 2] = bz + sign * nz * t;
      pos[ob] = bx; pos[ob + 1] = by; pos[ob + 2] = bz;
      thick[v] = t; thick[v + nv] = t;
    }
  }

  const idx = new Uint32Array(ntri * 3);
  let p = 0;
  const wall = (a, b) => { // edge a->b on the top face; wall goes b_t, a_t, a_b, b_b
    idx[p++] = b; idx[p++] = a; idx[p++] = a + nv;
    idx[p++] = b; idx[p++] = a + nv; idx[p++] = b + nv;
  };
  for (let i = 0; i < qrows; i++) {
    for (let j = 0; j < qcols; j++) {
      if (!Q[i * qcols + j]) continue;
      const j1 = (j + 1) % cols;
      const a = vid[i * cols + j], b = vid[i * cols + j1], c = vid[(i + 1) * cols + j1], d = vid[(i + 1) * cols + j];
      // alternate diagonal for a more even triangulation
      if ((i + j) & 1) {
        idx[p++] = a; idx[p++] = b; idx[p++] = c; idx[p++] = a; idx[p++] = c; idx[p++] = d;
        idx[p++] = a + nv; idx[p++] = c + nv; idx[p++] = b + nv; idx[p++] = a + nv; idx[p++] = d + nv; idx[p++] = c + nv;
      } else {
        idx[p++] = a; idx[p++] = b; idx[p++] = d; idx[p++] = b; idx[p++] = c; idx[p++] = d;
        idx[p++] = a + nv; idx[p++] = d + nv; idx[p++] = b + nv; idx[p++] = b + nv; idx[p++] = d + nv; idx[p++] = c + nv;
      }
      if (!qAt(i - 1, j)) wall(a, b);
      if (!qAt(i, j + 1)) wall(b, c);
      if (!qAt(i + 1, j)) wall(c, d);
      if (!qAt(i, j - 1)) wall(d, a);
    }
  }
  orient(pos, idx);

  const mb = new MeshBuilder();
  mb.add(pos, idx, thick);

  // ---------- accessories ----------
  // geometric extents before normalisation
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < minX) minX = pos[i]; if (pos[i] > maxX) maxX = pos[i];
    if (pos[i + 1] < minY) minY = pos[i + 1]; if (pos[i + 1] > maxY) maxY = pos[i + 1];
    if (pos[i + 2] < minZ) minZ = pos[i + 2]; if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
  }
  const tTop = frameOn ? Math.max(D, tmax) : tmax; // thickest part of the shell
  const ov = Math.min(0.3, tmin / 2); // overlap so parts fuse with the shell

  if (s.lamp && axis) {
    const z0 = minZ + s.lampOffsetZ;
    const rIn = s.fitterDiameter / 2, rOut = rIn + s.fitterThick;
    if (s.fitter === 'bulb') mb.add(...Object.values(ringPart(0, 0, z0, rIn, rOut, s.fitterHeight)));
    if (s.connectors === 'connectors') {
      const zc = z0 + s.connHeight / 2;
      for (let k = 0; k < s.connAmount; k++) {
        const a = (s.connAngle + (360 * k) / s.connAmount) * DEG;
        // shell base radius along this direction at the spoke's mid height
        let rb = R;
        if (s.shape === 'polygon') {
          const m = s.polySides, ap = R * Math.cos(Math.PI / m);
          const seg = (2 * Math.PI) / m;
          const rel = ((a % seg) + seg) % seg; // angle from nearest face centre
          const off = rel > seg / 2 ? rel - seg : rel;
          rb = ap / Math.cos(off);
        } else if (s.shape === 'sphere') {
          rb = Math.sqrt(Math.max(0, R * R - zc * zc));
        }
        const r1 = rb + (sign > 0 ? ov : -ov);
        const r0 = s.fitter === 'bulb' ? rOut - 0.5 : 0;
        const len = r1 - r0;
        if (len > 0.5) {
          const rm = (r0 + r1) / 2;
          // direction convention matches the shell: (sin a, -cos a)
          mb.add(...Object.values(boxPart(rm * Math.sin(a), -rm * Math.cos(a), z0, s.connWidth, len, s.connHeight, a)));
        }
      }
    }
  } else if (s.lamp && !axis) {
    // flat / curved lamp: a base plate with a bulb fitter at distance X behind
    const plateT = 2.4;
    const rIn = s.fitterDiameter / 2, rOut = rIn + s.fitterThick;
    const backY = sign > 0 ? tTop : 0;
    const y0 = Math.min(minY, -1);
    const y1 = backY + s.lampDistX + rOut + 4;
    mb.add(...Object.values(boxPart((minX + maxX) / 2, (y0 + y1) / 2, minZ - plateT + 0.2, maxX - minX, y1 - y0, plateT)));
    if (s.fitter === 'bulb') mb.add(...Object.values(ringPart(0, backY + s.lampDistX, minZ + 0.1, rIn, rOut, s.fitterHeight)));
  }

  if (s.nightlight && !axis) {
    const t = s.nlThick;
    const backY = sign > 0 ? tTop : 0;
    const yStart = sign > 0 ? ov : -ov;
    const yPocket = backY + s.nlDistance;
    const yEnd = yPocket + s.nlDepth + t;
    const w = s.nlWidth + 2 * t;
    const zb = minZ;
    mb.add(...Object.values(boxPart(0, (yStart + yEnd) / 2, zb, w, yEnd - yStart, t))); // shelf
    mb.add(...Object.values(boxPart(-(s.nlWidth + t) / 2, yPocket + (s.nlDepth + t) / 2 - t / 2, zb, t, s.nlDepth + t, s.nlHeight))); // left
    mb.add(...Object.values(boxPart((s.nlWidth + t) / 2, yPocket + (s.nlDepth + t) / 2 - t / 2, zb, t, s.nlDepth + t, s.nlHeight))); // right
    mb.add(...Object.values(boxPart(0, yEnd - t / 2, zb, w, t, s.nlHeight))); // back
    mb.add(...Object.values(boxPart(0, yPocket - t / 2, zb, w, t, Math.min(4, s.nlHeight)))); // front lip
  }

  if (s.stand && !axis) {
    const yMid = (minY + maxY) / 2;
    mb.add(...Object.values(boxPart((minX + maxX) / 2, yMid, minZ - s.standHeight + 0.2, maxX - minX + 2 * s.standMargin, s.standDepth, s.standHeight)));
  }

  const out = mb.merge();

  // normalise: centre XY on the shell, sit on Z = 0
  let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
  const P = out.pos;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < gx0) gx0 = P[i]; if (P[i] > gx1) gx1 = P[i];
    if (P[i + 1] < gy0) gy0 = P[i + 1]; if (P[i + 1] > gy1) gy1 = P[i + 1];
    if (P[i + 2] < gz0) gz0 = P[i + 2]; if (P[i + 2] > gz1) gz1 = P[i + 2];
  }
  const cx = axis ? 0 : (gx0 + gx1) / 2, cy = axis ? 0 : (gy0 + gy1) / 2;
  for (let i = 0; i < P.length; i += 3) { P[i] -= cx; P[i + 1] -= cy; P[i + 2] -= gz0; }

  return {
    ...out,
    layout: L,
    stats: {
      triangles: out.idx.length / 3,
      vertices: P.length / 3,
      size: [gx1 - gx0, gy1 - gy0, gz1 - gz0],
      volume: meshVolume(out.pos, out.idx),
    },
  };
}

export function meshVolume(pos, idx) {
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return Math.abs(vol) / 6;
}
