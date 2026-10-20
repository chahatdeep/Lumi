import { buildModel } from './mesh.js';
import { simplifyMesh } from './simplify.js';
import { FORMATS } from './exporters.js';
import { meshVolume } from './mesh.js';
import { buildDepthSolid, cleanMesh, parseMesh } from './pop.js';

let popRaw = null, popClean = null;

function sendPop(id, extra = {}) {
  const pos = popClean.pos.slice(), idx = popClean.idx.slice();
  self.postMessage({ type: 'pop-mesh', id, pos, idx, report: popClean.report, ...extra }, [pos.buffer, idx.buffer]);
}

const OPTIMIZE = {
  off: null,
  light: { tolerance: 0.005 },
  balanced: { tolerance: 0.02 },
  strong: { tolerance: 0.05 },
};

// Rotate an upright panel so its flat face lies on the bed (Z = 0).
function layFlat(pos, inside) {
  const sg = inside ? -1 : 1; // flat side faces -Y normally, +Y when the relief is on the front
  let zMin = Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1], z = pos[i + 2];
    pos[i + 1] = -sg * z; pos[i + 2] = sg * y;
  }
  for (let i = 0; i < pos.length; i += 3) {
    zMin = Math.min(zMin, pos[i + 2]);
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= zMin; }
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'build') {
      const t0 = performance.now();
      const m = buildModel(msg.settings, msg.gray, 'preview');
      m.stats.ms = performance.now() - t0;
      self.postMessage({ type: 'mesh', id: msg.id, pos: m.pos, idx: m.idx, thick: m.thick, stats: m.stats }, [m.pos.buffer, m.idx.buffer, m.thick.buffer]);
    } else if (msg.type === 'pop-depth') {
      const t0 = performance.now();
      const solid = buildDepthSolid(msg.input, msg.settings);
      popRaw = { pos: solid.pos, idx: solid.idx, upAxis: 'z', units: 'mm' };
      popClean = cleanMesh(popRaw, { ...msg.settings, popRescale: false, popFill: 0 });
      popClean.report.ms = performance.now() - t0;
      sendPop(msg.id, { maskInfo: solid.maskInfo, mask: solid.mask, mcols: solid.cols, mrows: solid.rows });
    } else if (msg.type === 'pop-load') {
      popRaw = parseMesh(msg.bytes, msg.format);
      if (!popRaw.idx.length) throw new Error('The file contains no triangles');
      popClean = cleanMesh(popRaw, msg.settings);
      sendPop(msg.id);
    } else if (msg.type === 'pop-clean') {
      if (!popRaw) return;
      const t0 = performance.now();
      popClean = cleanMesh(popRaw, msg.settings);
      popClean.report.ms = performance.now() - t0;
      sendPop(msg.id);
    } else if (msg.type === 'pop-export') {
      const s = msg.settings;
      const progress = (stage, p, extra) => self.postMessage({ type: 'progress', stage, p, extra });
      let pos = popClean.pos, idx = popClean.idx;
      const rawTris = idx.length / 3;
      if (rawTris > s.popMaxTris || s.optimize !== 'off') {
        progress('Optimizing mesh', 0.1, { tris: rawTris });
        const tol = { off: 0.001, light: 0.005, balanced: 0.02, strong: 0.05 }[s.optimize];
        const r = simplifyMesh(pos, idx, { tolerance: tol, maxTriangles: s.popMaxTris, onProgress: (p, cur) => progress('Optimizing mesh', 0.1 + p * 0.75, { tris: cur }) });
        pos = r.pos; idx = r.idx;
      }
      progress('Writing ' + FORMATS[s.format].label, 0.9);
      const data = FORMATS[s.format].fn(pos, idx, msg.name || 'Lumi', msg.thumb || null);
      self.postMessage({ type: 'file', data, stats: { rawTriangles: rawTris, triangles: idx.length / 3, vertices: pos.length / 3, bytes: data.length, volume: meshVolume(pos, idx), size: popClean.report.size } }, [data.buffer]);
    } else if (msg.type === 'export') {
      const s = msg.settings;
      const progress = (stage, p, extra) => self.postMessage({ type: 'progress', stage, p, extra });
      progress('Building full-resolution mesh', 0.05);
      const m = buildModel(s, msg.gray, 'export');
      let pos = m.pos, idx = m.idx;
      if (s.printOrient === 'flat' && s.shape === 'plane' && !s.stand && !s.nightlight && !s.lamp) layFlat(pos, s.inside);
      const rawTris = idx.length / 3;
      const opt = OPTIMIZE[s.optimize];
      const cap = s.capTriangles ? s.maxTriangles : Infinity;
      if (opt || rawTris > cap) {
        progress('Optimizing mesh', 0.1, { tris: rawTris });
        const r = simplifyMesh(pos, idx, {
          tolerance: opt ? opt.tolerance : 0.001,
          maxTriangles: cap,
          onProgress: (p, cur) => progress('Optimizing mesh', 0.1 + p * 0.75, { tris: cur }),
        });
        pos = r.pos; idx = r.idx;
      }
      progress('Writing ' + FORMATS[s.format].label, 0.9);
      const data = FORMATS[s.format].fn(pos, idx, msg.name || 'Lumi', msg.thumb || null);
      self.postMessage({
        type: 'file', data,
        stats: { rawTriangles: rawTris, triangles: idx.length / 3, vertices: pos.length / 3, bytes: data.length, volume: meshVolume(pos, idx), size: m.stats.size },
      }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err && err.stack || err) });
  }
};
