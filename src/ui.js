// Icons (stroke style) and small DOM / control helpers.

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const icons = {
  image: P('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/>'),
  sliders: P('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  cube: P('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  download: P('<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5"/><path d="M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17"/>'),
  upload: P('<path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: P('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  monitor: P('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  fit: P('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
  front: P('<rect x="5" y="5" width="14" height="14" rx="1.5"/>'),
  iso: P('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>', 'stroke-width="1.6"'),
  top: P('<path d="M4 15 12 19 20 15M4 9l8-4 8 4-8 4z"/>'),
  wire: P('<path d="M4 4h16v16H4zM4 4l16 16M12 4v16M4 12h16"/>', 'stroke-width="1.4"'),
  grid: P('<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/>', 'stroke-width="1.5"'),
  spin: P('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
  camera: P('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  compare: P('<path d="M12 3v18"/><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5h9v14h-9z" fill="currentColor" opacity=".25"/>'),
  chev: P('<path d="m6 9 6 6 6-6"/>'),
  reset: P('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  shape: P('<path d="M3 17c4-8 14-8 18 0"/><path d="M3 17h18"/>'),
  frame: P('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/>'),
  quality: P('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  lamp: P('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/>'),
  eye: P('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  text: P('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  crop: P('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
  rotl: P('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  rotr: P('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
  fliph: P('<path d="M12 3v18"/><path d="M8 7 3 12l5 5zM16 7l5 5-5 5z"/>'),
  flipv: P('<path d="M3 12h18"/><path d="M7 8l5-5 5 5zM7 16l5 5 5-5z"/>'),
  wand: P('<path d="m15 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1zM4 20 15 9M18 12l.7-1.3L20 10l-1.3-.7L18 8l-.7 1.3L16 10l1.3.7z"/>'),
  save: P('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  sparkle: P('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>'),
  layers: P('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  pop: P('<path d="M12 21c-4.5 0-7-2.6-7-6.3 0-3.2 2.2-5.4 4.4-6.6"/><path d="M12 21c4.5 0 7-2.6 7-6.3 0-3.2-2.2-5.4-4.4-6.6"/><path d="M9.4 8.1 12 3l2.6 5.1"/><path d="M8.5 15.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5"/><circle cx="9.5" cy="12" r=".6" fill="currentColor"/><circle cx="14.5" cy="12" r=".6" fill="currentColor"/>'),
  stand: P('<path d="M7 3h10v12H7zM4 21h16M9 15l-2 6M15 15l2 6"/>'),
  // shapes
  'sh-plane': P('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="m4 15 4-4 4 4 3-3 5 5" stroke-width="1.4"/>'),
  'sh-curve': P('<path d="M3 6c6 3 12 3 18 0v12c-6 3-12 3-18 0z"/>'),
  'sh-cylinder': P('<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>'),
  'sh-polygon': P('<path d="M7 3h10l4 3v12l-4 3H7l-4-3V6z"/><path d="M7 3v18M17 3v18"/>'),
  'sh-sphere': P('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><path d="M12 3c-3 3-3 15 0 18"/>'),
  // outlines
  'ol-rect': P('<rect x="4" y="6" width="16" height="12"/>'),
  'ol-rounded': P('<rect x="4" y="6" width="16" height="12" rx="4"/>'),
  'ol-ellipse': P('<ellipse cx="12" cy="12" rx="8.5" ry="7"/>'),
  'ol-heart': P('<path d="M12 20s-8-5.2-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 14.8 12 20 12 20z"/>'),
  'ol-hexagon': P('<path d="M3 12 7.5 4h9L21 12l-4.5 8h-9z"/>'),
  'ol-octagon': P('<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z"/>'),
  'ol-star': P('<path d="m12 3 2.6 5.8 6.4.6-4.8 4.3 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.4l6.4-.6z"/>'),
  'ol-arch': P('<path d="M5 21V10a7 7 0 0 1 14 0v11z"/>'),
};

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(k));
  return e;
}

export const ico = (name) => el('span', { html: icons[name] || '', style: 'display:contents' });

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => { n.outerHTML = icons[n.dataset.icon] || ''; });
}

const fmt = (v, step) => {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return Number(v).toFixed(dec);
};

// Builds a panel from a declarative schema. ctx = { get, set, state }
export class Form {
  constructor(ctx) { this.ctx = ctx; this.bindings = []; this.visibles = []; }

  sync() {
    for (const b of this.bindings) b();
    for (const [node, fn] of this.visibles) node.classList.toggle('hidden', !fn(this.ctx.state));
  }

  vis(node, show) { if (show) this.visibles.push([node, show]); return node; }

  card({ title, icon, open = true, reset, show }, ...body) {
    const card = el('section', { class: 'card' + (open ? '' : ' collapsed') });
    const head = el('div', { class: 'card-head' },
      el('div', { class: 'ico', html: icons[icon] }),
      el('h4', {}, title),
      reset ? el('button', { class: 'icon-btn mini', title: 'Reset section', html: icons.reset, onclick: (e) => { e.stopPropagation(); this.ctx.reset(reset); } }) : null,
      el('span', { class: 'chev', html: icons.chev }),
    );
    head.addEventListener('click', () => card.classList.toggle('collapsed'));
    card.append(head, el('div', { class: 'card-body' }, ...body));
    return this.vis(card, show);
  }

  slider(key, label, min, max, step, unit = '', o = {}) {
    const { get, set } = this.ctx;
    const range = el('input', { type: 'range', min, max, step });
    const num = el('input', { type: 'number', step });
    const paint = (v) => { range.style.setProperty('--p', `${((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100}%`); };
    range.addEventListener('input', () => { const v = +range.value; num.value = fmt(v, step); paint(v); set(key, v); });
    num.addEventListener('change', () => {
      let v = parseFloat(num.value);
      if (!Number.isFinite(v)) v = get(key);
      v = Math.min(o.hardMax ?? max * 10, Math.max(o.hardMin ?? min, v));
      range.value = v; num.value = fmt(v, step); paint(v); set(key, v);
    });
    range.addEventListener('dblclick', () => { if (o.def != null) { range.value = o.def; range.dispatchEvent(new Event('input')); } });
    this.bindings.push(() => {
      const v = get(key);
      if (document.activeElement !== num) num.value = fmt(v, step);
      range.value = v; paint(v);
      const dis = o.disabled ? o.disabled(this.ctx.state) : false;
      range.disabled = dis; num.disabled = dis;
    });
    const row = el('div', { class: 'row', title: o.tip || '' }, el('label', {}, label), range, el('div', { class: 'num' }, num, el('span', {}, unit)));
    return this.vis(row, o.show);
  }

  dual(kMin, kMax, label, min, max, step, unit = '', o = {}) {
    const { get, set } = this.ctx;
    const a = el('input', { type: 'range', min, max, step }), b = el('input', { type: 'range', min, max, step });
    const fill = el('div', { class: 'fillbar' });
    const out = el('input', { type: 'text', readonly: true });
    const paint = () => {
      const lo = Math.min(+a.value, +b.value), hi = Math.max(+a.value, +b.value);
      fill.style.left = `${((lo - min) / (max - min)) * 100}%`;
      fill.style.right = `${100 - ((hi - min) / (max - min)) * 100}%`;
      out.value = `${lo}–${hi}`;
    };
    a.addEventListener('input', () => { if (+a.value > +b.value) a.value = b.value; paint(); set(kMin, +a.value); });
    b.addEventListener('input', () => { if (+b.value < +a.value) b.value = a.value; paint(); set(kMax, +b.value); });
    this.bindings.push(() => { a.value = get(kMin); b.value = get(kMax); paint(); });
    return this.vis(el('div', { class: 'row', title: o.tip || '' }, el('label', {}, label),
      el('div', { class: 'dual' }, el('div', { class: 'rail' }), fill, a, b), el('div', { class: 'num' }, out, el('span', {}, unit))), o.show);
  }

  toggle(key, label, o = {}) {
    const { get, set } = this.ctx;
    const inp = el('input', { type: 'checkbox' });
    inp.addEventListener('change', () => set(key, inp.checked));
    this.bindings.push(() => { inp.checked = !!get(key); });
    return this.vis(el('div', { class: 'row full', title: o.tip || '' }, el('label', {}, label), el('label', { class: 'switch' }, inp, el('span'))), o.show);
  }

  select(key, label, options, o = {}) {
    const { get, set } = this.ctx;
    const sel = el('select', {}, ...options.map(([v, t]) => el('option', { value: v }, t)));
    sel.addEventListener('change', () => set(key, o.number ? +sel.value : sel.value));
    this.bindings.push(() => { sel.value = get(key); });
    return this.vis(el('div', { class: 'row full', title: o.tip || '' }, el('label', {}, label), sel), o.show);
  }

  seg(key, label, options, o = {}) {
    const { get, set } = this.ctx;
    const btns = options.map(([v, t]) => el('button', { onclick: () => set(key, v) }, t));
    this.bindings.push(() => btns.forEach((b, i) => b.classList.toggle('active', get(key) === options[i][0])));
    const segEl = el('div', { class: 'seg' }, ...btns);
    return this.vis(label ? el('div', { class: 'row full' }, el('label', {}, label), segEl) : el('div', { class: 'row stack' }, segEl), o.show);
  }

  tiles(key, options, o = {}) {
    const { get, set } = this.ctx;
    const ts = options.map(([v, t, icon]) => el('button', { class: 'tile', title: t, onclick: () => set(key, v) }, el('span', { html: icons[icon], style: 'display:contents' }), t));
    this.bindings.push(() => ts.forEach((b, i) => b.classList.toggle('active', get(key) === options[i][0])));
    return this.vis(el('div', { class: 'tiles' + (o.small ? ' small' : '') }, ...ts), o.show);
  }

  color(key, label, o = {}) {
    const { get, set } = this.ctx;
    const inp = el('input', { type: 'color' });
    inp.addEventListener('input', () => set(key, inp.value));
    this.bindings.push(() => { inp.value = get(key); });
    return this.vis(el('div', { class: 'row full' }, el('label', {}, label), inp), o.show);
  }

  text(key, label, o = {}) {
    const { get, set } = this.ctx;
    const inp = o.multiline ? el('textarea', { placeholder: o.placeholder || '' }) : el('input', { class: 'text', placeholder: o.placeholder || '' });
    inp.addEventListener('input', () => set(key, inp.value));
    this.bindings.push(() => { if (document.activeElement !== inp) inp.value = get(key); });
    return this.vis(el('div', { class: label ? 'row full' : 'row stack' }, label ? el('label', {}, label) : null, inp), o.show);
  }

  group(label, o = {}) { return this.vis(el('div', { class: 'group-label' }, label), o.show); }
  sub(o, ...kids) { return this.vis(el('div', { class: 'sub' }, ...kids), o.show); }
  dyn(render, o = {}) { const n = el('div'); this.bindings.push(() => render(n)); return this.vis(n, o.show); }
}
