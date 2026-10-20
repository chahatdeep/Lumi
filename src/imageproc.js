// Image editing pipeline: orientation -> crop -> text -> grayscale adjustments.

const MAX_DIM = 3200;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

// Rotated / flipped copy of the source, on a white background.
export function orient(src, s) {
  const sw = src.width, sh = src.height;
  const k = Math.min(1, MAX_DIM / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const rot = ((s.rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const c = canvas(swap ? h : w, swap ? w : h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

function blurLine(src, dst, off, stride, n, r, pre) {
  // prefix sums with clamped edges
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

function boxBlur(arr, w, h, r, tmp) {
  if (r < 1) return;
  const pre = new Float64Array(Math.max(w, h) + 1);
  for (let i = 0; i < h; i++) blurLine(arr, tmp, i * w, 1, w, r, pre);
  for (let j = 0; j < w; j++) blurLine(tmp, arr, j, w, h, r, pre);
}

function gaussian(arr, w, h, sigma) {
  if (sigma < 0.4) return;
  const tmp = new Float32Array(arr.length);
  const r = Math.max(1, Math.round(sigma * 0.85));
  for (let k = 0; k < 3; k++) boxBlur(arr, w, h, r, tmp);
}

export function process(oriented, s) {
  const W = oriented.width, H = oriented.height;
  const cr = s.cropRect || { x: 0, y: 0, w: 1, h: 1 };
  const cx = Math.round(cr.x * W), cy = Math.round(cr.y * H);
  const cw = Math.max(2, Math.round(cr.w * W)), ch = Math.max(2, Math.round(cr.h * H));
  const c = canvas(cw, ch);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(oriented, cx, cy, cw, ch, 0, 0, cw, ch);

  if (s.textOn && s.text.trim()) {
    const px = (s.textSize / 100) * ch;
    ctx.font = `${s.textBold ? 700 : 500} ${px}px ${s.textFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = s.text.split('\n');
    const lh = px * 1.15;
    const total = lh * lines.length;
    let y0 = s.textPos === 'top' ? px * 0.6 + lh / 2 : s.textPos === 'center' ? ch / 2 - total / 2 + lh / 2 : ch - px * 0.6 - total + lh / 2;
    ctx.lineJoin = 'round';
    for (const line of lines) {
      if (s.textOutline) {
        ctx.lineWidth = px * 0.14;
        ctx.strokeStyle = s.textColor === 'white' ? '#000' : '#fff';
        ctx.strokeText(line, cw / 2, y0);
      }
      ctx.fillStyle = s.textColor === 'white' ? '#fff' : '#000';
      ctx.fillText(line, cw / 2, y0);
      y0 += lh;
    }
  }

  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  const n = cw * ch;
  const L = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = d[p + 3] / 255;
    const lum = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    L[i] = lum * a + (1 - a);
  }

  if (s.autoLevels) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[Math.min(255, (L[i] * 255) | 0)]++;
    const lo = n * 0.005, hi = n * 0.995;
    let acc = 0, a = 0, b = 255;
    for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= lo) { a = k; break; } }
    acc = 0;
    for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= hi) { b = k; break; } }
    if (b > a) { const sc = 255 / (b - a); for (let i = 0; i < n; i++) L[i] = (L[i] * 255 - a) * sc / 255; }
  }

  const scale = Math.max(cw, ch) / 1000;
  if (s.smooth > 0) gaussian(L, cw, ch, s.smooth * scale);
  if (s.sharpen > 0) {
    const bl = Float32Array.from(L);
    gaussian(bl, cw, ch, 1.6 * Math.max(1, scale));
    const amt = s.sharpen / 50;
    for (let i = 0; i < n; i++) L[i] += amt * (L[i] - bl[i]);
  }

  const br = s.brightness / 200;
  const cf = Math.tan(((s.contrast / 100 + 1) * Math.PI) / 4);
  const ig = 1 / s.gamma;
  const shadows = s.shadows / 100, highlights = s.highlights / 100;
  for (let i = 0; i < n; i++) {
    let v = L[i] + br;
    v = (v - 0.5) * cf + 0.5;
    v = Math.min(1, Math.max(0, v));
    if (shadows) v += shadows * 0.5 * (1 - v) * (1 - v) * v * 4;
    if (highlights) v += highlights * 0.5 * v * v * (1 - v) * 4;
    v = Math.pow(Math.min(1, Math.max(0, v)), ig);
    if (s.invert) v = 1 - v;
    L[i] = v;
  }

  if (s.edgeFade > 0) {
    const fade = (s.edgeFade / 100) * Math.min(cw, ch) * 0.5;
    for (let i = 0; i < ch; i++) for (let j = 0; j < cw; j++) {
      const e = Math.min(i, j, ch - 1 - i, cw - 1 - j);
      if (e < fade) { const t = e / fade; const k = i * cw + j; L[k] = 1 - (1 - L[k]) * (t * t * (3 - 2 * t)); }
    }
  }

  const hist = new Uint32Array(64);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = Math.min(255, Math.max(0, Math.round(L[i] * 255)));
    d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
    hist[v >> 2]++;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, hist, width: cw, height: ch };
}

// Resample the processed image onto the vertex grid used by the mesh builder.
export function sampleGrid(grayCanvas, cols, rows) {
  const c = canvas(cols, rows);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(grayCanvas, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

// A friendly built-in demo picture so the app is never empty.
export function demoImage() {
  const c = canvas(1200, 900);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(600, 380, 40, 600, 450, 760);
  g.addColorStop(0, '#fffbe8'); g.addColorStop(0.45, '#f2b46d'); g.addColorStop(1, '#2a1630');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 900);
  // hills
  ctx.fillStyle = '#3b2340';
  ctx.beginPath(); ctx.moveTo(0, 700);
  for (let x = 0; x <= 1200; x += 20) ctx.lineTo(x, 690 - 70 * Math.sin(x / 170) - 30 * Math.sin(x / 53));
  ctx.lineTo(1200, 900); ctx.lineTo(0, 900); ctx.fill();
  ctx.fillStyle = '#1a0e1f';
  ctx.beginPath(); ctx.moveTo(0, 780);
  for (let x = 0; x <= 1200; x += 20) ctx.lineTo(x, 790 - 50 * Math.sin(x / 120 + 2));
  ctx.lineTo(1200, 900); ctx.lineTo(0, 900); ctx.fill();
  // stars
  ctx.fillStyle = '#fff';
  for (let k = 0; k < 70; k++) {
    const x = (k * 397) % 1200, y = (k * 211) % 420;
    if (Math.hypot(x - 600, y - 380) < 260) continue;
    ctx.beginPath(); ctx.arc(x, y, 1.5 + (k % 3), 0, 7); ctx.fill();
  }
  // a cute glowing moon face
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(600, 360, 150, 0, 7); ctx.fill();
  ctx.fillStyle = '#4a2b45';
  ctx.beginPath(); ctx.arc(548, 345, 14, 0, 7); ctx.arc(652, 345, 14, 0, 7); ctx.fill();
  ctx.strokeStyle = '#4a2b45'; ctx.lineWidth = 10; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(600, 380, 42, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = 'rgba(255,140,140,0.55)';
  ctx.beginPath(); ctx.ellipse(515, 395, 22, 13, 0, 0, 7); ctx.ellipse(685, 395, 22, 13, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 64px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Lumi', 600, 640);
  return c;
}
