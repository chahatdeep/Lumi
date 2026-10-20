// "Pop" 3D maker: depth map → printable solid, plus a general mesh-repair pipeline
// (weld, degenerate removal, small-part removal, hole filling, flat-bottom cut with capping).
import earcut from './vendor/earcut.js';
import { edt2d } from './mesh.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- grid helpers
export function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  for (let i = 0; i < dh; i++) {
    const y = ((i + 0.5) * sh) / dh - 0.5;
    const y0 = clamp(Math.floor(y), 0, sh - 1), y1 = Math.min(y0 + 1, sh - 1), fy = clamp(y - y0, 0, 1);
    for (let j = 0; j < dw; j++) {
      const x = ((j + 0.5) * sw) / dw - 0.5;
      const x0 = clamp(Math.floor(x), 0, sw - 1), x1 = Math.min(x0 + 1, sw - 1), fx = clamp(x - x0, 0, 1);
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[i * dw + j] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

function blurLine(src, dst, off, stride, n, r, pre) {
  pre[0] = 0;
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[off + i * stride];
  for (let i = 0; i < n; i++) {
    const a = i - r, b = i + r;
    let sum = pre[Math.min(n, b + 1)] - pre[Math.max(0, a)];
    if (a < 0) sum += -a * src[off];
    if (b > n - 1) sum += (b - n + 1) * src[off + (n - 1) * stride];
    dst[off + i * stride] = sum / (2 * r + 1);
  }
}
export function blur(a, w, h, sigma) {
  if (sigma < 0.4) return a;
  const r = Math.max(1, Math.round(sigma * 0.85));
  const tmp = new Float32Array(a.length), pre = new Float64Array(Math.max(w, h) + 1);
  const out = Float32Array.from(a);
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < h; i++) blurLine(out, tmp, i * w, 1, w, r, pre);
    for (let j = 0; j < w; j++) blurLine(tmp, out, j, w, h, r, pre);
  }
  return out;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const s = Float32Array.from(values).sort();
  return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
}

// Fill values outside the mask from the inside (push-pull pyramid), so blurring never drags edges down.
function pushPull(val, wgt, w, h) {
  if (w <= 2 || h <= 2) return;
  const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2);
  const cv = new Float32Array(cw * ch), cwt = new Float32Array(cw * ch);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const k = i * w + j, c = (i >> 1) * cw + (j >> 1);
    cv[c] += val[k] * wgt[k]; cwt[c] += wgt[k];
  }
  for (let c = 0; c < cv.length; c++) if (cwt[c] > 0) { cv[c] /= cwt[c]; cwt[c] = 1; }
  pushPull(cv, cwt, cw, ch);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const k = i * w + j;
    if (wgt[k] === 0) { val[k] = cv[(i >> 1) * cw + (j >> 1)]; wgt[k] = 1; }
  }
}
export function fillOutside(D, M, w, h) {
  const wgt = new Float32Array(D.length);
  for (let k = 0; k < D.length; k++) wgt[k] = M[k] ? 1 : 0;
  pushPull(D, wgt, w, h);
}

// connected components of pixels equal to `val` (4-connected)
function label(mask, w, h, val) {
  const lab = new Int32Array(w * h).fill(-1);
  const sizes = [], border = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== val || lab[s] >= 0) continue;
    const id = sizes.length;
    let top = 0, size = 0, touches = false;
    stack[top++] = s; lab[s] = id;
    while (top) {
      const k = stack[--top]; size++;
      const i = (k / w) | 0, j = k - i * w;
      if (i === 0 || j === 0 || i === h - 1 || j === w - 1) touches = true;
      if (j > 0 && mask[k - 1] === val && lab[k - 1] < 0) { lab[k - 1] = id; stack[top++] = k - 1; }
      if (j < w - 1 && mask[k + 1] === val && lab[k + 1] < 0) { lab[k + 1] = id; stack[top++] = k + 1; }
      if (i > 0 && mask[k - w] === val && lab[k - w] < 0) { lab[k - w] = id; stack[top++] = k - w; }
      if (i < h - 1 && mask[k + w] === val && lab[k + w] < 0) { lab[k + w] = id; stack[top++] = k + w; }
    }
    sizes.push(size); border.push(touches);
  }
  return { lab, sizes, border };
}

export function cleanMask(mask, w, h, islandPct, holePct) {
  const fg = label(mask, w, h, 1);
  const maxFg = Math.max(0, ...fg.sizes);
  let islands = 0;
  const keep = fg.sizes.map((s) => s >= (islandPct / 100) * maxFg);
  islands = keep.filter((k) => !k).length;
  for (let k = 0; k < mask.length; k++) if (fg.lab[k] >= 0 && !keep[fg.lab[k]]) mask[k] = 0;
  let area = 0;
  for (let k = 0; k < mask.length; k++) area += mask[k];
  const bg = label(mask, w, h, 0);
  let holes = 0;
  const fill = bg.sizes.map((s, i) => !bg.border[i] && s < (holePct / 100) * area);
  holes = fill.filter(Boolean).length;
  for (let k = 0; k < mask.length; k++) if (bg.lab[k] >= 0 && fill[bg.lab[k]]) mask[k] = 1;
  return { islands, holes };
}

// ---------------------------------------------------------------- watertight solid from top/bottom grids
export function gridSolid(cols, rows, inc, top, bot) {
  const qc = cols - 1, qr = rows - 1;
  const Q = new Uint8Array(qr * qc);
  for (let i = 0; i < qr; i++) for (let j = 0; j < qc; j++) {
    const a = i * cols + j;
    if (inc[a] && inc[a + 1] && inc[a + cols] && inc[a + cols + 1]) Q[i * qc + j] = 1;
  }
  const qAt = (i, j) => (i < 0 || j < 0 || i >= qr || j >= qc ? 0 : Q[i * qc + j]);
  const vid = new Int32Array(cols * rows).fill(-1);
  let nv = 0, nt = 0;
  for (let i = 0; i < qr; i++) for (let j = 0; j < qc; j++) {
    if (!Q[i * qc + j]) continue;
    for (const k of [i * cols + j, i * cols + j + 1, (i + 1) * cols + j + 1, (i + 1) * cols + j]) if (vid[k] < 0) vid[k] = nv++;
    nt += 4 + 2 * (!qAt(i - 1, j) + !qAt(i, j + 1) + !qAt(i + 1, j) + !qAt(i, j - 1));
  }
  const pos = new Float32Array(nv * 6);
  for (let k = 0; k < cols * rows; k++) {
    const v = vid[k];
    if (v < 0) continue;
    pos.set(top.subarray(k * 3, k * 3 + 3), v * 3);
    pos.set(bot.subarray(k * 3, k * 3 + 3), (v + nv) * 3);
  }
  const idx = new Uint32Array(nt * 3);
  let p = 0;
  const wall = (a, b) => { idx[p++] = b; idx[p++] = a; idx[p++] = a + nv; idx[p++] = b; idx[p++] = a + nv; idx[p++] = b + nv; };
  for (let i = 0; i < qr; i++) for (let j = 0; j < qc; j++) {
    if (!Q[i * qc + j]) continue;
    const a = vid[i * cols + j], b = vid[i * cols + j + 1], c = vid[(i + 1) * cols + j + 1], d = vid[(i + 1) * cols + j];
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
  return { pos, idx };
}

// ---------------------------------------------------------------- depth → solid
export function buildDepthSolid(inp, s) {
  const { depth, dw, dh, alpha, aw, ah, aspect } = inp;
  const W = s.popWidth, H = W * aspect;
  let d = s.popRes;
  const cells = (W / d) * (H / d);
  if (cells > 1.5e6) d *= Math.sqrt(cells / 1.5e6);
  const cols = Math.max(8, Math.round(W / d) + 1), rows = Math.max(8, Math.round(H / d) + 1);
  const dx = W / (cols - 1), dy = H / (rows - 1);
  const n = cols * rows;

  let D = resample(depth, dw, dh, cols, rows);
  // global normalisation (robust)
  const sample = [];
  for (let k = 0; k < n; k += 7) sample.push(D[k]);
  const g0 = percentile(sample, 0.01), g1 = percentile(sample, 0.99);
  for (let k = 0; k < n; k++) D[k] = clamp((D[k] - g0) / Math.max(1e-9, g1 - g0), 0, 1);

  const keep = s.popBg === 'keep';
  let M = new Uint8Array(n).fill(1);
  let maskInfo = { islands: 0, holes: 0 };
  if (!keep) {
    let F;
    if (s.popBg === 'ai' && alpha) {
      const A = new Float32Array(aw * ah);
      for (let k = 0; k < A.length; k++) A[k] = alpha[k] / 255;
      F = resample(A, aw, ah, cols, rows);
    } else {
      F = new Float32Array(n);
      const c = s.popCutoff / 100;
      for (let k = 0; k < n; k++) F[k] = D[k] > c ? 1 : 0;
    }
    if (s.popOutline > 0) F = blur(F, cols, rows, s.popOutline / dx);
    for (let k = 0; k < n; k++) M[k] = F[k] > 0.5 ? 1 : 0;
    maskInfo = cleanMask(M, cols, rows, s.popIslands, s.popHoles);
    fillOutside(D, M, cols, rows);
  }
  if (s.popSmooth > 0) D = blur(D, cols, rows, s.popSmooth / dx);

  // re-normalise depth inside the object
  const inside = [];
  for (let k = 0; k < n; k += 3) if (M[k]) inside.push(D[k]);
  const p0 = percentile(inside, 0.02), p1 = percentile(inside, 0.98);
  const N = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let v = clamp((D[k] - p0) / Math.max(1e-6, p1 - p0), 0, 1);
    if (s.popInvert) v = 1 - v;
    N[k] = Math.pow(v, s.popCurve);
  }

  let dist = null;
  if (!keep && s.popRound > 0) {
    const bgGrid = new Uint8Array(n);
    for (let k = 0; k < n; k++) bgGrid[k] = M[k] ? 0 : 1;
    // pad: pixels on the grid border count as edges too
    for (let j = 0; j < cols; j++) { bgGrid[j] = 1; bgGrid[(rows - 1) * cols + j] = 1; }
    for (let i = 0; i < rows; i++) { bgGrid[i * cols] = 1; bgGrid[i * cols + cols - 1] = 1; }
    dist = edt2d(bgGrid, cols, rows, dx, dy);
  }

  const minT = 0.6;
  const top = new Float32Array(n * 3), bot = new Float32Array(n * 3);
  const standing = s.popOrient === 'standing';
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      const r = dist ? Math.sqrt(1 - (1 - Math.min(1, dist[k] / s.popRound)) ** 2) : 1;
      const h = s.popDepth * N[k] * r;
      let t = s.popBase * (dist ? Math.max(r, 0.35) : 1) + h;
      const b = -(s.popBack / 100) * h;
      if (t - b < minT) t = b + minT;
      const x = j * dx - W / 2, y = H / 2 - i * dy;
      if (standing) {
        top[k * 3] = x; top[k * 3 + 1] = -t; top[k * 3 + 2] = y;
        bot[k * 3] = x; bot[k * 3 + 1] = -b; bot[k * 3 + 2] = y;
      } else {
        top[k * 3] = x; top[k * 3 + 1] = y; top[k * 3 + 2] = t;
        bot[k * 3] = x; bot[k * 3 + 1] = y; bot[k * 3 + 2] = b;
      }
    }
  }
  const solid = gridSolid(cols, rows, M, top, bot);
  return { ...solid, mask: M, cols, rows, maskInfo };
}

// ---------------------------------------------------------------- mesh repair toolkit
function bbox(pos) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
    if (pos[i + a] < b[a]) b[a] = pos[i + a];
    if (pos[i + a] > b[a + 3]) b[a + 3] = pos[i + a];
  }
  return b;
}

export function weld(pos, idx) {
  const b = bbox(pos);
  const diag = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1;
  const q = diag * 1e-6;
  const map = new Map();
  const remap = new Int32Array(pos.length / 3);
  const out = [];
  for (let v = 0; v < pos.length / 3; v++) {
    const key = `${Math.round(pos[v * 3] / q)},${Math.round(pos[v * 3 + 1] / q)},${Math.round(pos[v * 3 + 2] / q)}`;
    let id = map.get(key);
    if (id === undefined) { id = out.length / 3; map.set(key, id); out.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
    remap[v] = id;
  }
  const nidx = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) nidx[i] = remap[idx[i]];
  return { pos: Float32Array.from(out), idx: nidx };
}

export function removeDegenerate(pos, idx) {
  const out = [];
  const seen = new Set();
  let removed = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) { removed++; continue; }
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-24) { removed++; continue; }
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) { removed++; continue; }
    seen.add(s);
    out.push(a, b, c);
  }
  return { idx: Uint32Array.from(out), removed };
}

function components(nv, idx) {
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < idx.length; t += 3) { unite(idx[t], idx[t + 1]); unite(idx[t + 1], idx[t + 2]); }
  const triRoot = new Int32Array(idx.length / 3);
  const count = new Map();
  for (let t = 0; t < triRoot.length; t++) {
    const r = find(idx[t * 3]);
    triRoot[t] = r;
    count.set(r, (count.get(r) || 0) + 1);
  }
  return { triRoot, count };
}

export function removeSmallParts(nv, idx, pct) {
  const { triRoot, count } = components(nv, idx);
  const max = Math.max(0, ...count.values());
  const minTris = (pct / 100) * max;
  const out = [];
  let removedParts = 0;
  for (const [, c] of count) if (c < minTris) removedParts++;
  for (let t = 0; t < triRoot.length; t++) if (count.get(triRoot[t]) >= minTris) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  return { idx: Uint32Array.from(out), removedParts, parts: count.size - removedParts };
}

export function edgeReport(nv, idx) {
  const m = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k], b = idx[t + ((k + 1) % 3)];
    const key = a < b ? a * nv + b : b * nv + a;
    m.set(key, (m.get(key) || 0) + 1);
  }
  let boundary = 0, nonManifold = 0;
  for (const c of m.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  return { boundary, nonManifold };
}

export function fillHoles(pos, idx, maxEdges) {
  const nv = pos.length / 3;
  const dir = new Set();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) dir.add(idx[t + k] * nv + idx[t + ((k + 1) % 3)]);
  const next = new Map(), bad = new Set();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k], b = idx[t + ((k + 1) % 3)];
    if (!dir.has(b * nv + a)) { if (next.has(a)) bad.add(a); next.set(a, b); }
  }
  const P = Array.from(pos), out = Array.from(idx);
  const visited = new Set();
  let filled = 0, skipped = 0;
  for (const start of next.keys()) {
    if (visited.has(start) || bad.has(start)) continue;
    const loop = [];
    let v = start, ok = true;
    while (true) {
      if (visited.has(v) || bad.has(v)) { ok = v === start && loop.length > 2; break; }
      visited.add(v); loop.push(v);
      const nx = next.get(v);
      if (nx === undefined) { ok = false; break; }
      v = nx;
      if (loop.length > maxEdges + 1) { ok = false; break; }
    }
    if (!ok || loop.length < 3 || loop.length > maxEdges) { skipped++; continue; }
    let cx = 0, cy = 0, cz = 0;
    for (const u of loop) { cx += P[u * 3]; cy += P[u * 3 + 1]; cz += P[u * 3 + 2]; }
    const c = P.length / 3;
    P.push(cx / loop.length, cy / loop.length, cz / loop.length);
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; out.push(b, a, c); }
    filled++;
  }
  return { pos: Float32Array.from(P), idx: Uint32Array.from(out), filled, skipped };
}

// Cut everything below z = zc and cap the opening (flat, printable bottom).
export function cutBelow(pos, idx, zc) {
  const nv0 = pos.length / 3;
  for (let tries = 0; tries < 8; tries++) {
    let hit = false;
    for (let v = 0; v < nv0; v++) if (Math.abs(pos[v * 3 + 2] - zc) < 1e-6) { hit = true; break; }
    if (!hit) break;
    zc += 1.7e-5;
  }
  const P = Array.from(pos);
  const emap = new Map();
  const inter = (a, b) => {
    const key = a < b ? a * nv0 + b : b * nv0 + a;
    let id = emap.get(key);
    if (id !== undefined) return id;
    const za = pos[a * 3 + 2], zb = pos[b * 3 + 2], t = (zc - za) / (zb - za);
    id = P.length / 3;
    P.push(pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t, pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t, zc);
    emap.set(key, id);
    return id;
  };
  const out = [], adj = new Map();
  const link = (p, q) => {
    if (!adj.has(p)) adj.set(p, []); if (!adj.has(q)) adj.set(q, []);
    adj.get(p).push(q); adj.get(q).push(p);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const ab = v.map((x) => pos[x * 3 + 2] > zc);
    const k = ab[0] + ab[1] + ab[2];
    if (k === 3) { out.push(...v); continue; }
    if (k === 0) continue;
    if (k === 1) {
      const r = ab.indexOf(true);
      const u = v[r], vv = v[(r + 1) % 3], w = v[(r + 2) % 3];
      const p = inter(u, vv), q = inter(w, u);
      out.push(u, p, q); link(p, q);
    } else {
      const r = ab.indexOf(false);
      const w = v[r], u = v[(r + 1) % 3], vv = v[(r + 2) % 3];
      const p = inter(vv, w), q = inter(w, u);
      out.push(u, vv, p, u, p, q); link(p, q);
    }
  }
  // chain cut segments into loops
  const loops = [];
  const seen = new Set();
  let failed = 0;
  for (const [s, ns] of adj) {
    if (seen.has(s)) continue;
    if (ns.length !== 2) { seen.add(s); failed++; continue; }
    const loop = [s];
    seen.add(s);
    let prev = s, cur = ns[0], ok = true;
    while (cur !== s) {
      const nb = adj.get(cur);
      if (!nb || nb.length !== 2 || seen.has(cur)) { ok = false; break; }
      seen.add(cur); loop.push(cur);
      const nx = nb[0] === prev ? nb[1] : nb[0];
      prev = cur; cur = nx;
    }
    if (ok && loop.length >= 3) loops.push(loop); else failed++;
  }
  // classify loops (outer vs holes) and triangulate caps
  const L = loops.map((lp) => {
    let a = 0;
    for (let i = 0; i < lp.length; i++) {
      const p = lp[i], q = lp[(i + 1) % lp.length];
      a += P[p * 3] * P[q * 3 + 1] - P[q * 3] * P[p * 3 + 1];
    }
    return { lp, area: Math.abs(a / 2) };
  }).sort((x, y) => y.area - x.area);
  const inside = (pt, lp) => {
    let c = false;
    for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) {
      const xi = P[lp[i] * 3], yi = P[lp[i] * 3 + 1], xj = P[lp[j] * 3], yj = P[lp[j] * 3 + 1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let i = 0; i < L.length; i++) {
    const pt = [P[L[i].lp[0] * 3], P[L[i].lp[0] * 3 + 1]];
    L[i].parents = [];
    for (let j = 0; j < i; j++) if (inside(pt, L[j].lp)) L[i].parents.push(j);
    L[i].depth = L[i].parents.length;
  }
  for (let i = 0; i < L.length; i++) {
    if (L[i].depth % 2) continue;
    const holes = L.filter((h) => h.depth === L[i].depth + 1 && h.parents.includes(i));
    const ids = [...L[i].lp], coords = [], holeIdx = [];
    for (const h of holes) { holeIdx.push(ids.length); ids.push(...h.lp); }
    for (const id of ids) coords.push(P[id * 3], P[id * 3 + 1]);
    const tris = earcut(coords, holeIdx.length ? holeIdx : null);
    for (let t = 0; t < tris.length; t += 3) {
      let a = ids[tris[t]], b = ids[tris[t + 1]], c = ids[tris[t + 2]];
      const cz = (P[b * 3] - P[a * 3]) * (P[c * 3 + 1] - P[a * 3 + 1]) - (P[b * 3 + 1] - P[a * 3 + 1]) * (P[c * 3] - P[a * 3]);
      if (cz > 0) { const x = b; b = c; c = x; } // cap faces down
      out.push(a, b, c);
    }
  }
  return { pos: Float32Array.from(P), idx: Uint32Array.from(out), loops: loops.length, failed };
}

function compact(pos, idx) {
  const map = new Int32Array(pos.length / 3).fill(-1);
  let n = 0;
  for (let i = 0; i < idx.length; i++) if (map[idx[i]] < 0) map[idx[i]] = n++;
  const P = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) P.set(pos.subarray(v * 3, v * 3 + 3), map[v] * 3);
  const I = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) I[i] = map[idx[i]];
  return { pos: P, idx: I };
}

function orientParts(pos, idx) {
  const { triRoot } = components(pos.length / 3, idx);
  const vol = new Map();
  for (let t = 0; t < triRoot.length; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const v = pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    vol.set(triRoot[t], (vol.get(triRoot[t]) || 0) + v);
  }
  let total = 0;
  for (let t = 0; t < triRoot.length; t++) {
    if (vol.get(triRoot[t]) < 0) { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; }
  }
  for (const v of vol.values()) total += Math.abs(v);
  return total / 6;
}

// Full clean-up pipeline. raw = { pos, idx, upAxis: 'y'|'z', units: 'model'|'mm' }
export function cleanMesh(raw, s) {
  const rep = { inputTriangles: raw.idx.length / 3 };
  let { pos, idx } = weld(raw.pos, raw.idx);
  const dg = removeDegenerate(pos, idx);
  idx = dg.idx; rep.degenerate = dg.removed;
  const sp = removeSmallParts(pos.length / 3, idx, s.popMinPart);
  idx = sp.idx; rep.partsRemoved = sp.removedParts; rep.parts = sp.parts;
  if (s.popFill > 0) {
    const f = fillHoles(pos, idx, s.popFill);
    pos = f.pos; idx = f.idx; rep.holesFilled = f.filled;
  }
  ({ pos, idx } = compact(pos, idx));

  // Y-up (glTF) → Z-up (printing)
  if (raw.upAxis === 'y') for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1]; pos[i + 1] = -pos[i + 2]; pos[i + 2] = y; }
  let b = bbox(pos);
  if (raw.units !== 'mm' || s.popRescale) {
    const k = s.popHeight / Math.max(1e-9, b[5] - b[2]);
    for (let i = 0; i < pos.length; i++) pos[i] *= k;
    b = bbox(pos);
  }
  if (s.popCut > 0) {
    const r = cutBelow(pos, idx, b[2] + (s.popCut / 100) * (b[5] - b[2]));
    ({ pos, idx } = weld(r.pos, r.idx));
    rep.cutLoops = r.loops; rep.cutFailed = r.failed;
    ({ idx } = removeDegenerate(pos, idx));
    ({ pos, idx } = compact(pos, idx));
    b = bbox(pos);
  }
  const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, z0 = b[2];
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= z0; }
  rep.volume = orientParts(pos, idx);
  Object.assign(rep, edgeReport(pos.length / 3, idx));
  rep.watertight = rep.boundary === 0 && rep.nonManifold === 0;
  rep.triangles = idx.length / 3;
  rep.size = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
  return { pos, idx, report: rep };
}

// ---------------------------------------------------------------- importers
export function parseMesh(bytes, format) {
  if (format === 'glb') return parseGLB(bytes);
  if (format === 'stl') return parseSTL(bytes);
  if (format === 'obj') return parseOBJ(bytes);
  throw new Error('Unsupported format: ' + format);
}

function parseSTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (bytes.byteLength === 84 + n * 50) {
    const pos = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
    return { pos, idx: Uint32Array.from({ length: n * 3 }, (_, i) => i), upAxis: 'z', units: 'mm' };
  }
  const text = new TextDecoder().decode(bytes);
  const v = [];
  for (const m of text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)) v.push(+m[1], +m[2], +m[3]);
  return { pos: Float32Array.from(v), idx: Uint32Array.from({ length: v.length / 3 }, (_, i) => i), upAxis: 'z', units: 'mm' };
}

function parseOBJ(bytes) {
  const text = new TextDecoder().decode(bytes);
  const v = [], f = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < p.length; k++) f.push(p[0], p[k], p[k + 1]);
    }
  }
  return { pos: Float32Array.from(v), idx: Uint32Array.from(f), upAxis: 'y', units: 'model' };
}

function mat4mul(a, b) {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function parseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  let off = 12, json = null, bin = null;
  while (off < bytes.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if ((json.extensionsUsed || []).some((e) => /draco|meshopt/i.test(e))) throw new Error('Compressed GLB (Draco/Meshopt) is not supported');
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const read = (ai) => {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
    const nc = SIZE[a.type];
    const C = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    const stride = bv.byteStride || nc * C.BYTES_PER_ELEMENT;
    const base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * nc);
    const view = new DataView(bin.buffer);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) out[i * nc + c] = view[get](base + i * stride + c * C.BYTES_PER_ELEMENT, true);
    return out;
  };
  const P = [], I = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const m = mat4mul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.mode != null && prim.mode !== 4) continue;
        const p = read(prim.attributes.POSITION);
        const base = P.length / 3;
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          P.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
        if (prim.indices != null) { const ix = read(prim.indices); for (let i = 0; i < ix.length; i++) I.push(ix[i] + base); }
        else for (let i = 0; i < p.length / 3; i++) I.push(base + i);
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene || 0];
  for (const ni of scene ? scene.nodes : json.nodes.map((_, i) => i)) visit(ni, ID);
  return { pos: Float32Array.from(P), idx: Uint32Array.from(I), upAxis: 'y', units: 'model' };
}
