// Quadric-error edge-collapse mesh simplification (after Garland & Heckbert,
// structure follows Sp4cerat's Fast-Quadric-Mesh-Simplification), using typed arrays.
// Keeps the mesh closed; collapses flat areas (e.g. the flat back of a lithophane) aggressively
// while preserving relief detail within `tolerance` millimetres.

export function simplifyMesh(posIn, idxIn, { tolerance = 0.02, maxTriangles = Infinity, onProgress } = {}) {
  const nvIn = posIn.length / 3;
  let nt = idxIn.length / 3;
  const startTris = nt;
  const vp = Float64Array.from(posIn);
  const vq = new Float64Array(nvIn * 10);
  const vts = new Int32Array(nvIn), vtc = new Int32Array(nvIn);
  const vb = new Uint8Array(nvIn);
  const tv = Int32Array.from(idxIn);
  const terr = new Float64Array(nt * 4);
  const tn = new Float64Array(nt * 3);
  const tdel = new Uint8Array(nt), tdirty = new Uint8Array(nt);
  let refs = new Int32Array(nt * 3 + 1024), refsLen = 0;
  let del0 = new Uint8Array(256), del1 = new Uint8Array(256);
  let deleted = 0;
  const tolSq = tolerance * tolerance;
  const Q = new Float64Array(10);
  const tmpP = new Float64Array(3), scratch = new Float64Array(3);

  const pushRef = (r) => {
    if (refsLen >= refs.length) { const n = new Int32Array(refs.length * 2); n.set(refs); refs = n; }
    refs[refsLen++] = r;
  };

  const vErr = (x, y, z) =>
    Q[0] * x * x + 2 * Q[1] * x * y + 2 * Q[2] * x * z + 2 * Q[3] * x + Q[4] * y * y +
    2 * Q[5] * y * z + 2 * Q[6] * y + Q[7] * z * z + 2 * Q[8] * z + Q[9];
  const det = (a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
    Q[a11] * Q[a22] * Q[a33] + Q[a13] * Q[a21] * Q[a32] + Q[a12] * Q[a23] * Q[a31] -
    Q[a13] * Q[a22] * Q[a31] - Q[a11] * Q[a23] * Q[a32] - Q[a12] * Q[a21] * Q[a33];

  function calcError(a, b, out) {
    const oa = a * 10, ob = b * 10;
    for (let k = 0; k < 10; k++) Q[k] = vq[oa + k] + vq[ob + k];
    const ax = vp[a * 3], ay = vp[a * 3 + 1], az = vp[a * 3 + 2];
    const bx = vp[b * 3], by = vp[b * 3 + 1], bz = vp[b * 3 + 2];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    if (!(vb[a] & vb[b])) {
      const d = det(0, 1, 2, 1, 4, 5, 2, 5, 7);
      if (d !== 0 && Number.isFinite(d)) {
        const x = (-1 / d) * det(1, 2, 3, 4, 5, 6, 5, 7, 8);
        const y = (1 / d) * det(0, 2, 3, 1, 5, 6, 2, 7, 8);
        const z = (-1 / d) * det(0, 1, 3, 1, 4, 6, 2, 5, 8);
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2;
        // only accept the optimum when it stays near the edge (avoids spikes on near-flat areas)
        if ((x - mx) ** 2 + (y - my) ** 2 + (z - mz) ** 2 <= 0.25 * l2) {
          out[0] = x; out[1] = y; out[2] = z;
          return Math.max(0, vErr(x, y, z));
        }
      }
    }
    const e1 = vErr(ax, ay, az), e2 = vErr(bx, by, bz), e3 = vErr(mx, my, mz);
    const e = Math.min(e1, e2, e3);
    if (e === e1) { out[0] = ax; out[1] = ay; out[2] = az; }
    else if (e === e2) { out[0] = bx; out[1] = by; out[2] = bz; }
    else { out[0] = mx; out[1] = my; out[2] = mz; }
    return Math.max(0, e);
  }

  function flipped(p, i0, i1, del) {
    const s0 = vts[i0], c0 = vtc[i0];
    for (let k = 0; k < c0; k++) {
      const r = refs[s0 + k], tid = (r / 3) | 0, s = r - tid * 3;
      if (tdel[tid]) continue;
      const id1 = tv[tid * 3 + ((s + 1) % 3)], id2 = tv[tid * 3 + ((s + 2) % 3)];
      if (id1 === i1 || id2 === i1) { del[k] = 1; continue; }
      let d1x = vp[id1 * 3] - p[0], d1y = vp[id1 * 3 + 1] - p[1], d1z = vp[id1 * 3 + 2] - p[2];
      let d2x = vp[id2 * 3] - p[0], d2y = vp[id2 * 3 + 1] - p[1], d2z = vp[id2 * 3 + 2] - p[2];
      const l1 = Math.hypot(d1x, d1y, d1z), l2 = Math.hypot(d2x, d2y, d2z);
      if (l1 < 1e-12 || l2 < 1e-12) return true;
      d1x /= l1; d1y /= l1; d1z /= l1; d2x /= l2; d2y /= l2; d2z /= l2;
      if (Math.abs(d1x * d2x + d1y * d2y + d1z * d2z) > 0.999) return true;
      let nx = d1y * d2z - d1z * d2y, ny = d1z * d2x - d1x * d2z, nz = d1x * d2y - d1y * d2x;
      const ln = Math.hypot(nx, ny, nz);
      if (ln < 1e-12) return true;
      nx /= ln; ny /= ln; nz /= ln;
      del[k] = 0;
      if (nx * tn[tid * 3] + ny * tn[tid * 3 + 1] + nz * tn[tid * 3 + 2] < 0.2) return true;
    }
    return false;
  }

  function updateTriangles(i0, v, del) {
    const s0 = vts[v], c0 = vtc[v];
    for (let k = 0; k < c0; k++) {
      const r = refs[s0 + k], tid = (r / 3) | 0, s = r - tid * 3;
      if (tdel[tid]) continue;
      if (del[k]) { tdel[tid] = 1; deleted++; continue; }
      tv[tid * 3 + s] = i0;
      tdirty[tid] = 1;
      const a = tv[tid * 3], b = tv[tid * 3 + 1], c = tv[tid * 3 + 2];
      const e0 = calcError(a, b, scratch), e1 = calcError(b, c, scratch), e2 = calcError(c, a, scratch);
      terr[tid * 4] = e0; terr[tid * 4 + 1] = e1; terr[tid * 4 + 2] = e2; terr[tid * 4 + 3] = Math.min(e0, e1, e2);
      pushRef(r);
    }
  }

  function updateMesh(iteration) {
    if (iteration > 0) {
      let dst = 0;
      for (let i = 0; i < nt; i++) {
        if (tdel[i]) continue;
        if (dst !== i) {
          tv[dst * 3] = tv[i * 3]; tv[dst * 3 + 1] = tv[i * 3 + 1]; tv[dst * 3 + 2] = tv[i * 3 + 2];
          terr[dst * 4] = terr[i * 4]; terr[dst * 4 + 1] = terr[i * 4 + 1]; terr[dst * 4 + 2] = terr[i * 4 + 2]; terr[dst * 4 + 3] = terr[i * 4 + 3];
          tn[dst * 3] = tn[i * 3]; tn[dst * 3 + 1] = tn[i * 3 + 1]; tn[dst * 3 + 2] = tn[i * 3 + 2];
        }
        dst++;
      }
      nt = dst;
      tdel.fill(0, 0, nt);
      deleted = 0;
    }
    vtc.fill(0);
    for (let i = 0; i < nt * 3; i++) vtc[tv[i]]++;
    let st = 0;
    for (let v = 0; v < nvIn; v++) { vts[v] = st; st += vtc[v]; vtc[v] = 0; }
    if (refs.length < nt * 3) refs = new Int32Array(nt * 3 * 2);
    for (let i = 0; i < nt; i++) {
      for (let j = 0; j < 3; j++) {
        const v = tv[i * 3 + j];
        refs[vts[v] + vtc[v]] = i * 3 + j;
        vtc[v]++;
      }
    }
    refsLen = nt * 3;

    if (iteration === 0) {
      // border detection: a neighbour that appears in only one adjacent triangle lies on a border edge
      const ids = [], cnt = [];
      for (let v = 0; v < nvIn; v++) {
        ids.length = 0; cnt.length = 0;
        for (let k = 0; k < vtc[v]; k++) {
          const tid = (refs[vts[v] + k] / 3) | 0;
          for (let j = 0; j < 3; j++) {
            const id = tv[tid * 3 + j];
            let ofs = ids.indexOf(id);
            if (ofs < 0) { ids.push(id); cnt.push(1); } else cnt[ofs]++;
          }
        }
        for (let m = 0; m < ids.length; m++) if (cnt[m] === 1) vb[ids[m]] = 1;
      }
      for (let i = 0; i < nt; i++) {
        const a = tv[i * 3] * 3, b = tv[i * 3 + 1] * 3, c = tv[i * 3 + 2] * 3;
        const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
        const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const ln = Math.hypot(nx, ny, nz);
        if (ln > 0) { nx /= ln; ny /= ln; nz /= ln; } else { nx = ny = nz = 0; }
        tn[i * 3] = nx; tn[i * 3 + 1] = ny; tn[i * 3 + 2] = nz;
        const dd = -(nx * vp[a] + ny * vp[a + 1] + nz * vp[a + 2]);
        const pl = [nx * nx, nx * ny, nx * nz, nx * dd, ny * ny, ny * nz, ny * dd, nz * nz, nz * dd, dd * dd];
        for (let j = 0; j < 3; j++) {
          const o = tv[i * 3 + j] * 10;
          for (let k = 0; k < 10; k++) vq[o + k] += pl[k];
        }
      }
      for (let i = 0; i < nt; i++) {
        const a = tv[i * 3], b = tv[i * 3 + 1], c = tv[i * 3 + 2];
        const e0 = calcError(a, b, scratch), e1 = calcError(b, c, scratch), e2 = calcError(c, a, scratch);
        terr[i * 4] = e0; terr[i * 4 + 1] = e1; terr[i * 4 + 2] = e2; terr[i * 4 + 3] = Math.min(e0, e1, e2);
      }
    }
  }

  const done = (thr) => thr > tolSq && nt - deleted <= maxTriangles;

  for (let it = 0; it < 150; it++) {
    const thr = 1e-9 * Math.pow(it + 3, 7);
    if (it > 0 && done(thr)) break;
    if (it % 5 === 0) updateMesh(it);
    tdirty.fill(0, 0, nt);
    for (let i = 0; i < nt; i++) {
      if (terr[i * 4 + 3] > thr || tdel[i] || tdirty[i]) continue;
      for (let j = 0; j < 3; j++) {
        if (terr[i * 4 + j] >= thr) continue;
        const i0 = tv[i * 3 + j], i1 = tv[i * 3 + ((j + 1) % 3)];
        if (vb[i0] !== vb[i1]) continue;
        calcError(i0, i1, tmpP);
        if (del0.length < vtc[i0]) del0 = new Uint8Array(vtc[i0] * 2);
        if (del1.length < vtc[i1]) del1 = new Uint8Array(vtc[i1] * 2);
        if (flipped(tmpP, i0, i1, del0)) continue;
        if (flipped(tmpP, i1, i0, del1)) continue;
        vp[i0 * 3] = tmpP[0]; vp[i0 * 3 + 1] = tmpP[1]; vp[i0 * 3 + 2] = tmpP[2];
        for (let k = 0; k < 10; k++) vq[i0 * 10 + k] += vq[i1 * 10 + k];
        const tstart = refsLen;
        updateTriangles(i0, i0, del0);
        updateTriangles(i0, i1, del1);
        const tcount = refsLen - tstart;
        if (tcount <= vtc[i0]) {
          if (tcount) refs.copyWithin(vts[i0], tstart, tstart + tcount);
          refsLen = tstart;
        } else {
          vts[i0] = tstart;
        }
        vtc[i0] = tcount;
        break;
      }
      if ((i & 0xffff) === 0 && done(thr)) break;
    }
    if (onProgress) onProgress(Math.min(0.99, it / 40), nt - deleted, startTris);
  }

  // compact
  const keep = new Int32Array(nvIn).fill(-1);
  let nvOut = 0, ntOut = 0;
  for (let i = 0; i < nt; i++) {
    if (tdel[i]) continue;
    const a = tv[i * 3], b = tv[i * 3 + 1], c = tv[i * 3 + 2];
    if (a === b || b === c || a === c) continue;
    ntOut++;
    for (const v of [a, b, c]) if (keep[v] < 0) keep[v] = nvOut++;
  }
  const pos = new Float32Array(nvOut * 3);
  for (let v = 0; v < nvIn; v++) {
    const k = keep[v];
    if (k >= 0) { pos[k * 3] = vp[v * 3]; pos[k * 3 + 1] = vp[v * 3 + 1]; pos[k * 3 + 2] = vp[v * 3 + 2]; }
  }
  const idx = new Uint32Array(ntOut * 3);
  let o = 0;
  for (let i = 0; i < nt; i++) {
    if (tdel[i]) continue;
    const a = tv[i * 3], b = tv[i * 3 + 1], c = tv[i * 3 + 2];
    if (a === b || b === c || a === c) continue;
    idx[o++] = keep[a]; idx[o++] = keep[b]; idx[o++] = keep[c];
  }
  return { pos, idx };
}
