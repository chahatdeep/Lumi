// Landing page: a backlit-lithophane simulation of Lumi's demo picture, plus small UI niceties.
import { demoImage } from './app/imageproc.js';

// ---------------------------------------------------------------- hero lithophane
// Thickness follows Lumi's default linear mapping (dark = thick). With the lamp off we shade
// the bare white relief from the front; with it on, light transmits as exp(-k * thickness).
const cv = document.getElementById('lithoCanvas');
const slider = document.getElementById('lampSlider');
const frame = document.querySelector('.litho-frame');
const W = cv.width, H = cv.height;
const g = cv.getContext('2d');

const src = document.createElement('canvas');
src.width = W; src.height = H;
const sg = src.getContext('2d');
sg.drawImage(demoImage(), 0, 0, W, H);
const px = sg.getImageData(0, 0, W, H).data;

const tMin = 0.8, tMax = 3.2, k = 1.35;
const t = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const L = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  t[i] = tMin + (1 - L) * (tMax - tMin);
}
// light blur so the relief reads like printed layers rather than pixels
const tb = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let s = 0, n = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const xx = x + i, yy = y + j;
    if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += t[yy * W + xx]; n++; }
  }
  tb[y * W + x] = s / n;
}

const off = new Float32Array(W * H * 3), on = new Float32Array(W * H * 3);
const lx = -0.45, ly = -0.55, lz = 0.7, ll = Math.hypot(lx, ly, lz);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const dx = (tb[y * W + Math.min(W - 1, x + 1)] - tb[y * W + Math.max(0, x - 1)]) * 3.2;
  const dy = (tb[Math.min(H - 1, y + 1) * W + x] - tb[Math.max(0, y - 1) * W + x]) * 3.2;
  const nl = Math.hypot(dx, dy, 1);
  const lam = Math.max(0, (-dx * lx - dy * ly + lz) / (nl * ll));
  const occl = 1 - (tb[i] - tMin) / (tMax - tMin) * 0.12; // thicker = slightly darker crevices
  const v = (0.38 + 0.62 * lam) * occl;
  off[i * 3] = 232 * v; off[i * 3 + 1] = 228 * v; off[i * 3 + 2] = 222 * v;
  const T = Math.exp(-k * (tb[i] - tMin));
  const glow = Math.pow(T, 0.9);
  on[i * 3] = 255 * Math.min(1, glow * 1.08 + 0.03);
  on[i * 3 + 1] = 226 * glow + 10 * T * T;
  on[i * 3 + 2] = 168 * glow * glow + 6;
}

const img = g.createImageData(W, H);
function render(lamp) {
  const a = lamp, b = 1 - lamp, d = img.data;
  for (let i = 0, j = 0; i < W * H; i++, j += 3) {
    d[i * 4] = on[j] * a + off[j] * b * (1 - 0.6 * a);
    d[i * 4 + 1] = on[j + 1] * a + off[j + 1] * b * (1 - 0.6 * a);
    d[i * 4 + 2] = on[j + 2] * a + off[j + 2] * b * (1 - 0.6 * a);
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  frame.style.setProperty('--halo', (0.06 + 0.55 * lamp).toFixed(3));
}

let userTouched = false;
slider.addEventListener('input', () => { userTouched = true; render(slider.value / 100); });

// switch the lamp on the first time the hero is seen
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) render(1);
else {
  slider.value = 0; render(0);
  setTimeout(() => {
    const t0 = performance.now();
    const step = (now) => {
      if (userTouched) return;
      const p = Math.min(1, (now - t0) / 1800);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      slider.value = Math.round(e * 100); render(e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 700);
}

// ---------------------------------------------------------------- reveal on scroll
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.section-head, .feat, .steps li, .stats, .shot, .build, .tip-grid div, .license').forEach((n) => { n.classList.add('reveal'); io.observe(n); });

// ---------------------------------------------------------------- screenshot lightbox
const lb = document.getElementById('lightbox');
document.querySelectorAll('.shot').forEach((b) => b.addEventListener('click', () => {
  lb.querySelector('img').src = b.dataset.src;
  lb.querySelector('img').alt = b.querySelector('img').alt;
  lb.showModal();
}));
lb.addEventListener('click', () => lb.close());

// ---------------------------------------------------------------- copy build commands
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  const text = b.parentElement.querySelector('code').innerText.split('\n').filter((l) => l && !l.startsWith('#')).join('\n');
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Select & copy'; }
  setTimeout(() => (b.textContent = 'Copy'), 1600);
}));
