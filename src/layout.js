// Shared geometry layout: decides grid resolution and padding for a given set of settings.
// Imported by both the UI thread and the mesh worker.

export const PREVIEW_QUALITY = [
  { label: 'Lousy', f: 6, cap: 25000 },
  { label: 'Low', f: 3, cap: 70000 },
  { label: 'Medium', f: 2, cap: 150000 },
  { label: 'High', f: 1.4, cap: 300000 },
  { label: 'Native', f: 1, cap: 700000 },
];

export const WRAP_SHAPES = new Set(['cylinder', 'polygon', 'sphere']);
export const FLAT_SHAPES = new Set(['plane', 'curve']);

const DEG = Math.PI / 180;

// Surface width (mm along the surface) for the shape.
export function surfaceWidth(s) {
  switch (s.shape) {
    case 'cylinder': return Math.PI * s.width;
    case 'polygon': return s.polySides * s.width * Math.sin(Math.PI / s.polySides);
    case 'sphere': return Math.PI * s.width;
    default: return s.width;
  }
}

export function surfaceHeight(s) {
  if (s.shape === 'sphere') return (s.width / 2) * (s.sphereTop - s.sphereBottom) * DEG;
  return s.height;
}

// Height that keeps the image undistorted for the current width.
export function aspectHeight(s, aspect) {
  return surfaceWidth(s) * aspect;
}

export function frameWidths(s) {
  const wrap = WRAP_SHAPES.has(s.shape);
  if (s.frame === 'none') return { l: 0, r: 0, t: 0, b: 0 };
  if (s.frameAdvanced) {
    return {
      l: wrap ? 0 : s.frameLeft,
      r: wrap ? 0 : s.frameRight,
      t: s.frameTop,
      b: s.frameBottom,
    };
  }
  const w = s.frameWidth;
  return { l: wrap ? 0 : w, r: wrap ? 0 : w, t: w, b: w };
}

export function computeLayout(s, mode = 'preview') {
  const wrap = WRAP_SHAPES.has(s.shape);
  const W = surfaceWidth(s);
  const H = surfaceHeight(s);
  let d = s.mmpp * (mode === 'preview' ? PREVIEW_QUALITY[s.previewQuality].f : 1);

  // keep the interactive preview snappy, and exports within memory limits
  const cap = mode === 'preview' ? PREVIEW_QUALITY[s.previewQuality].cap : 4500000;
  const cells = (W / d) * (H / d);
  let capped = false;
  if (cells > cap) { d *= Math.sqrt(cells / cap); capped = mode !== 'preview'; }

  const fw = frameWidths(s);
  let imgCols;
  if (wrap) {
    if (s.shape === 'polygon') {
      const side = W / s.polySides;
      const k = Math.max(2, 2 * Math.round(side / d / 2));
      imgCols = s.polySides * k;
    } else {
      imgCols = Math.max(12, Math.round(W / d));
    }
  } else {
    imgCols = Math.max(2, Math.round(W / d) + 1);
  }
  const imgRows = Math.max(2, Math.round(H / d) + 1);
  const dx = wrap ? W / imgCols : W / (imgCols - 1);
  const dy = H / (imgRows - 1);

  const hanger = !!(s.hanger && !wrap);
  const hr = s.hangerDiameter / 2;
  const hR = hr + s.hangerRing;
  let extraTop = fw.t;
  if (hanger) extraTop = Math.max(extraTop, fw.t + hr + 0.5 + hR);

  const padL = wrap ? 0 : Math.ceil(fw.l / dx - 1e-6);
  const padR = wrap ? 0 : Math.ceil(fw.r / dx - 1e-6);
  const padT = Math.ceil(extraTop / dy - 1e-6);
  const padB = Math.ceil(fw.b / dy - 1e-6);
  const cols = imgCols + padL + padR;
  const rows = imgRows + padT + padB;

  return { wrap, W, H, d, dx, dy, imgCols, imgRows, padL, padR, padT, padB, cols, rows, fw, hanger, hr, hR, capped };
}

// Rough triangle count of the raw (unoptimized) mesh: two surfaces + walls.
export function estimateTriangles(L) {
  const quads = (L.rows - 1) * (L.wrap ? L.cols : L.cols - 1);
  const walls = 2 * (L.wrap ? 2 * L.cols : 2 * (L.cols + L.rows));
  return quads * 4 + walls;
}
