// Lumi landing page: theme (shared with the embedded app), lamp switch over real-light renders, niceties.

// ---------------------------------------------------------------- theme: system → light → dark
const root = document.documentElement;
const mq = matchMedia('(prefers-color-scheme: dark)');
const frame = document.getElementById('appFrame');
let pref = root.dataset.themePref || 'system';

function applyTheme(sync = true) {
  root.dataset.themePref = pref;
  root.dataset.theme = pref === 'dark' || (pref === 'system' && mq.matches) ? 'dark' : 'light';
  document.getElementById('themeBtn').title = `Theme: ${pref}`;
  if (sync) frame?.contentWindow?.postMessage({ lumiTheme: pref }, location.origin);
}
document.getElementById('themeBtn').addEventListener('click', () => {
  pref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
  try { localStorage.setItem('lumi.theme', JSON.stringify(pref)); } catch {}
  applyTheme();
});
mq.addEventListener('change', () => applyTheme(false));
frame?.addEventListener('load', () => frame.contentWindow.postMessage({ lumiTheme: pref }, location.origin));
// the app's own theme button reports back here
addEventListener('message', (e) => {
  if (e.origin === location.origin && ['system', 'light', 'dark'].includes(e.data?.lumiTheme)) { pref = e.data.lumiTheme; applyTheme(false); }
});
applyTheme(false);

// ---------------------------------------------------------------- lamp
const slider = document.getElementById('lampSlider');
const sw = document.getElementById('lampSwitch');
const lit = document.getElementById('lithoOn');
let anim = 0;

function setLamp(v) {
  lit.style.opacity = v.toFixed(3);
  slider.value = Math.round(v * 100);
  sw.checked = v > 0.5;
}
function fadeTo(target, ms = 1400) {
  cancelAnimationFrame(anim);
  const from = slider.value / 100, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    setLamp(from + (target - from) * e);
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
slider.addEventListener('input', () => { cancelAnimationFrame(anim); setLamp(slider.value / 100); });
sw.addEventListener('change', () => fadeTo(sw.checked ? 1 : 0, 900));

if (matchMedia('(prefers-reduced-motion: reduce)').matches) setLamp(1);
else {
  setLamp(0);
  const start = () => setTimeout(() => fadeTo(1, 1800), 500);
  lit.complete ? start() : lit.addEventListener('load', start, { once: true });
}

// ---------------------------------------------------------------- reveal on scroll
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('.headline, .lede, .tile, .steps li, .specs div, .showcase, .tips div').forEach((n) => { n.classList.add('reveal'); io.observe(n); });

// ---------------------------------------------------------------- desktop showcase + lightbox
const tabs = [...document.querySelectorAll('.seg button')];
const shots = [...document.querySelectorAll('#showFrame img')];
const cap = document.getElementById('showCap');
let cur = 0, auto = null;
function show(i) {
  cur = (i + shots.length) % shots.length;
  shots.forEach((im, k) => im.classList.toggle('on', k === cur));
  tabs.forEach((t, k) => t.setAttribute('aria-selected', String(k === cur)));
  cap.textContent = shots[cur].dataset.cap;
}
const stopAuto = () => { clearInterval(auto); auto = null; };
tabs.forEach((t, k) => t.addEventListener('click', () => { stopAuto(); show(k); }));
document.querySelector('.seg').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { stopAuto(); show(cur + (e.key === 'ArrowRight' ? 1 : -1)); tabs[cur].focus(); }
});
// gently cycle until the visitor picks one
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  new IntersectionObserver(([e], o) => { if (e.isIntersecting) { auto = setInterval(() => show(cur + 1), 4500); o.disconnect(); } }, { threshold: 0.5 }).observe(document.getElementById('showFrame'));
}
const lb = document.getElementById('lightbox');
document.getElementById('showFrame').addEventListener('click', () => {
  stopAuto();
  lb.querySelector('img').src = shots[cur].src;
  lb.querySelector('img').alt = shots[cur].alt;
  lb.showModal();
});
lb.addEventListener('click', () => lb.close());

// ---------------------------------------------------------------- copy build commands
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  const text = b.parentElement.querySelector('code').innerText.split('\n').filter((l) => l && !l.startsWith('#')).join('\n');
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Select & copy'; }
  setTimeout(() => (b.textContent = 'Copy'), 1600);
}));
