import { Viewer } from './viewer.js';
import { Form, el, icons, hydrateIcons } from './ui.js';
import { orient, process, sampleGrid, demoImage } from './imageproc.js';
import { computeLayout, estimateTriangles, surfaceWidth, WRAP_SHAPES, FLAT_SHAPES, PREVIEW_QUALITY } from './layout.js';

// ---------------------------------------------------------------- state
const DEFAULTS = {
  rotate: 0, flipH: false, flipV: false, cropRect: null, cropAspect: 'free',
  autoLevels: false, brightness: 0, contrast: 0, gamma: 1, shadows: 0, highlights: 0, smooth: 0, sharpen: 0, invert: false, edgeFade: 0,
  textOn: false, text: '', textFont: '"Segoe UI", sans-serif', textSize: 10, textPos: 'bottom', textColor: 'white', textBold: true, textOutline: false,
  shape: 'plane', width: 100, height: 75, lockAspect: true, minThick: 0.8, maxThick: 3.2, inside: false, outline: 'rect', cornerRadius: 8,
  curveAngle: 120, polySides: 6, sphereTop: 60, sphereBottom: -45, mapping: 'linear', attenuation: 1.0,
  frame: 'bevel', frameWidth: 3, frameDepth: 4, frameAngle: 45, frameAdvanced: false, frameTop: 3, frameBottom: 3, frameLeft: 3, frameRight: 3,
  mmpp: 0.15, previewQuality: 1,
  lamp: false, lampOffsetZ: 0, lampDistX: 50, fitter: 'bulb', fitterHeight: 20, fitterThick: 2, fitterDiameter: 28,
  connectors: 'connectors', connAmount: 4, connHeight: 10, connWidth: 5, connAngle: 0,
  nightlight: false, nlDistance: 7, nlWidth: 17, nlDepth: 17, nlThick: 1.7, nlHeight: 12,
  stand: false, standDepth: 20, standHeight: 4, standMargin: 0,
  hanger: false, hangerDiameter: 4, hangerRing: 2.5,
  lighting: 'back', lightColor: '#fff3df', intensityMin: 5, intensityMax: 95, materialColor: '#f1f1f1', autoUpdate: true,
  popMethod: 'depth', popEngine: 'local', popBg: 'ai', popCutoff: 25, popOutline: 0.6, popIslands: 3, popHoles: 3,
  popWidth: 100, popDepth: 12, popBase: 2, popBack: 0, popRound: 2, popCurve: 1, popSmooth: 0.4, popRes: 0.3, popInvert: false, popOrient: 'lying',
  popAI: 'hunyuan2', popLocalModel: 'turbo', popSteps: 30, popOctree: 256, popSeed: 1234,
  popMinPart: 2, popFill: 300, popCut: 0, popHeight: 80, popRescale: true, popMaxTris: 400000, popColor: '#e9dccb',
  fileName: '', printOrient: 'flat', format: 'stl', optimize: 'balanced', capTriangles: true, maxTriangles: 600000, material: 'pla',
};

const GROUPS = {
  transform: ['rotate', 'flipH', 'flipV', 'cropRect', 'cropAspect'],
  adjust: ['autoLevels', 'brightness', 'contrast', 'gamma', 'shadows', 'highlights', 'smooth', 'sharpen', 'invert', 'edgeFade'],
  text: ['textOn', 'text', 'textFont', 'textSize', 'textPos', 'textColor', 'textBold', 'textOutline'],
  shape: ['shape', 'width', 'height', 'lockAspect', 'minThick', 'maxThick', 'inside', 'outline', 'cornerRadius', 'curveAngle', 'polySides', 'sphereTop', 'sphereBottom', 'mapping', 'attenuation'],
  frame: ['frame', 'frameWidth', 'frameDepth', 'frameAngle', 'frameAdvanced', 'frameTop', 'frameBottom', 'frameLeft', 'frameRight'],
  quality: ['mmpp', 'previewQuality'],
  attrs: ['lamp', 'lampOffsetZ', 'lampDistX', 'fitter', 'fitterHeight', 'fitterThick', 'fitterDiameter', 'connectors', 'connAmount', 'connHeight', 'connWidth', 'connAngle',
    'nightlight', 'nlDistance', 'nlWidth', 'nlDepth', 'nlThick', 'nlHeight', 'stand', 'standDepth', 'standHeight', 'standMargin', 'hanger', 'hangerDiameter', 'hangerRing'],
  view: ['lighting', 'lightColor', 'intensityMin', 'intensityMax', 'materialColor', 'autoUpdate'],
  pop: ['popMethod', 'popEngine', 'popBg', 'popCutoff', 'popOutline', 'popIslands', 'popHoles', 'popWidth', 'popDepth', 'popBase', 'popBack', 'popRound',
    'popCurve', 'popSmooth', 'popRes', 'popInvert', 'popOrient', 'popAI', 'popLocalModel', 'popSteps', 'popOctree', 'popSeed'],
  popClean: ['popMinPart', 'popFill', 'popCut', 'popHeight', 'popRescale', 'popMaxTris', 'popColor'],
  export: ['fileName', 'printOrient', 'format', 'optimize', 'capTriangles', 'maxTriangles', 'material'],
};
const ORIENT_KEYS = new Set(['rotate', 'flipH', 'flipV']);
const IMAGE_KEYS = new Set([...GROUPS.transform, ...GROUPS.adjust, ...GROUPS.text]);
const VIEW_KEYS = new Set(GROUPS.view);
const EXPORT_KEYS = new Set([...GROUPS.export, 'cropAspect']);
const POP_KEYS = new Set([...GROUPS.pop, ...GROUPS.popClean]);
const POP_DEPTH_KEYS = new Set(['popBg', 'popCutoff', 'popOutline', 'popIslands', 'popHoles', 'popWidth', 'popDepth', 'popBase', 'popBack', 'popRound', 'popCurve', 'popSmooth', 'popRes', 'popInvert', 'popOrient']);
const POP_CLEAN_KEYS = new Set(['popMinPart', 'popFill', 'popCut', 'popHeight', 'popRescale']);

const MATERIALS = { pla: ['PLA', 1.24], petg: ['PETG', 1.27], abs: ['ABS', 1.04], asa: ['ASA', 1.07], tpu: ['TPU', 1.21] };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = { ...DEFAULTS, ...pick(store.get('lumi.settings', {}), Object.keys(DEFAULTS)) };
let theme = store.get('lumi.theme', 'system');
if (state.popAI === 'sf3d') state.popAI = 'hunyuan2';

function pick(o, keys) { const r = {}; for (const k of keys) if (o && k in o) r[k] = o[k]; return r; }

// ---------------------------------------------------------------- image state
let source = null;          // ImageBitmap | canvas
let sourceName = 'lithophane';
let oriented = null;        // canvas
let processed = null;       // { canvas, hist, width, height }
let cropMode = false;

// ---------------------------------------------------------------- dom
const $ = (s) => document.querySelector(s);
hydrateIcons();
const viewer = new Viewer($('#view3d'));
const stage = document.querySelector('.stage');
const canvas2d = $('#canvas2d');
let view = '3d';
let tab = 'image';

// ---------------------------------------------------------------- ctx + forms
const forms = [];
const ctx = {
  state,
  get: (k) => state[k],
  set: (k, v) => setValue(k, v),
  reset: (group) => {
    for (const k of GROUPS[group]) state[k] = structuredClone(DEFAULTS[k]);
    afterChange(new Set(GROUPS[group]));
  },
};

function setValue(k, v) {
  if (state[k] === v) return;
  state[k] = v;
  afterChange(new Set([k]));
}

function afterChange(keys) {
  if (keys.has('lockAspect') || keys.has('width') || keys.has('height') || keys.has('shape') || keys.has('polySides')) enforceAspect(keys.has('height') && !keys.has('width') ? 'height' : 'width');
  if (keys.has('shape')) firstMesh = true; // re-frame camera
  const orientChanged = [...keys].some((k) => ORIENT_KEYS.has(k));
  const imageChanged = [...keys].some((k) => IMAGE_KEYS.has(k));
  const meshChanged = [...keys].some((k) => !IMAGE_KEYS.has(k) && !VIEW_KEYS.has(k) && !EXPORT_KEYS.has(k) && !POP_KEYS.has(k));
  const popKeys = [...keys].filter((k) => POP_KEYS.has(k));
  if (popKeys.length && typeof onPopChange === 'function') onPopChange(popKeys);
  if (orientChanged) { oriented = null; }
  if (imageChanged) scheduleImage();
  else if (meshChanged) scheduleMesh();
  if ([...keys].some((k) => VIEW_KEYS.has(k)) || keys.has('minThick') || keys.has('maxThick') || keys.has('attenuation')) applyLighting();
  syncAll();
  store.set('lumi.settings', state);
}

function syncAll() { for (const f of forms) f.sync(); updateStatus(); }

function aspect() { return processed ? processed.height / processed.width : 0.75; }

function enforceAspect(changed) {
  if (!state.lockAspect || state.shape === 'sphere') return;
  const factor = surfaceWidth(state) / state.width;
  const a = aspect();
  if (changed === 'height') state.width = round1(state.height / (a * factor));
  else state.height = round1(state.width * factor * a);
}
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- panels
const panel = $('#panel');
const panes = {};

function buildImagePane() {
  const f = new Form(ctx); forms.push(f);
  const thumb = el('img', { class: 'thumb hidden' });
  const info = el('dl', { class: 'kv' });
  f.refreshSource = () => {
    if (!source) return;
    const c = document.createElement('canvas');
    const k = Math.min(1, 640 / Math.max(source.width, source.height));
    c.width = source.width * k; c.height = source.height * k;
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    thumb.src = c.toDataURL(); thumb.classList.remove('hidden');
    info.replaceChildren(
      el('dt', {}, 'File'), el('dd', {}, sourceName),
      el('dt', {}, 'Pixels'), el('dd', {}, `${source.width} × ${source.height}`),
      el('dt', {}, 'Aspect'), el('dd', {}, (source.width / source.height).toFixed(3)),
    );
  };
  const drop = el('div', { class: 'dropzone', onclick: () => $('#fileInput').click() },
    el('span', { html: icons.upload, style: 'display:contents' }), el('b', {}, 'Choose an image'),
    el('small', {}, 'or drag & drop · paste with Ctrl+V'));

  const templates = [
    ['Framed photo', 'sh-plane', { shape: 'plane', outline: 'rect', frame: 'bevel', stand: false, nightlight: false, lamp: false, hanger: false }],
    ['Desk stand', 'stand', { shape: 'plane', outline: 'rect', frame: 'bevel', stand: true, nightlight: false, lamp: false, hanger: false }],
    ['Night light', 'lamp', { shape: 'plane', outline: 'rounded', frame: 'bevel', nightlight: true, stand: false, lamp: false, hanger: false }],
    ['Heart keepsake', 'ol-heart', { shape: 'plane', outline: 'heart', frame: 'rounded', hanger: true, stand: false, nightlight: false, lamp: false }],
    ['Curved panel', 'sh-curve', { shape: 'curve', curveAngle: 120, frame: 'bevel', stand: false, nightlight: false, lamp: false, hanger: false }],
    ['Cylinder lamp', 'sh-cylinder', { shape: 'cylinder', width: 80, frame: 'bevel', lamp: true, inside: false }],
    ['Hexagon lamp', 'sh-polygon', { shape: 'polygon', polySides: 6, width: 90, frame: 'bevel', lamp: true, inside: false }],
    ['Moon globe', 'sh-sphere', { shape: 'sphere', width: 100, frame: 'flat', lamp: true, inside: false }],
  ];
  const tgrid = el('div', { class: 'tiles small', style: 'grid-template-columns:repeat(4,1fr)' },
    ...templates.map(([name, icon, patch]) => el('button', {
      class: 'tile', title: name,
      onclick: () => { Object.assign(state, patch); afterChange(new Set([...Object.keys(patch), 'width'])); setTab('model'); toast(`Template: ${name}`); },
    }, el('span', { html: icons[icon], style: 'display:contents' }), name)));

  const pane = el('div', {},
    f.card({ title: 'Source image', icon: 'image' },
      drop, thumb, info,
      el('div', { class: 'btns' },
        el('button', { class: 'btn', onclick: () => $('#fileInput').click() }, el('span', { html: icons.folder, style: 'display:contents' }), 'Open…'),
        el('button', { class: 'btn', onclick: pasteFromClipboard }, 'Paste'),
        el('button', { class: 'btn', onclick: () => loadSource(demoImage(), 'lumi-demo') }, el('span', { html: icons.sparkle, style: 'display:contents' }), 'Demo'))),
    f.card({ title: 'Quick templates', icon: 'sparkle' },
      el('div', { class: 'note' }, 'One click sets up the shape & accessories. Fine-tune everything in ', el('b', {}, 'Model'), '.'),
      tgrid),
    f.card({ title: 'Project', icon: 'save' },
      el('div', { class: 'btns' },
        el('button', { class: 'btn', onclick: saveProject }, el('span', { html: icons.save, style: 'display:contents' }), 'Save settings'),
        el('button', { class: 'btn', onclick: () => $('#presetInput').click() }, el('span', { html: icons.folder, style: 'display:contents' }), 'Load settings')),
      el('div', { class: 'btns' },
        el('button', { class: 'btn', onclick: () => { Object.assign(state, structuredClone(DEFAULTS)); afterChange(new Set(Object.keys(DEFAULTS))); toast('All settings reset'); } },
          el('span', { html: icons.reset, style: 'display:contents' }), 'Reset everything'))),
  );
  panes.image = { el: pane, form: f };
}

function buildEditPane() {
  const f = new Form(ctx); forms.push(f);
  const hist = el('canvas', { class: 'hist', width: 320, height: 64 });
  f.drawHist = () => {
    if (!processed) return;
    const g = hist.getContext('2d'), h = processed.hist;
    const max = Math.max(...h);
    g.clearRect(0, 0, 320, 64);
    const grad = g.createLinearGradient(0, 0, 320, 0);
    grad.addColorStop(0, '#222'); grad.addColorStop(1, '#fff');
    for (let i = 0; i < 64; i++) {
      const v = (h[i] / max) * 58;
      g.fillStyle = `rgba(255,122,61,${0.35 + 0.65 * (i / 63)})`;
      g.fillRect(i * 5, 64 - v, 4, v);
    }
  };
  const cropBtn = el('button', { class: 'btn', onclick: () => toggleCrop() }, el('span', { html: icons.crop, style: 'display:contents' }), 'Crop');
  f.bindings.push(() => { cropBtn.classList.toggle('primary', cropMode); cropBtn.lastChild.textContent = cropMode ? 'Done' : 'Crop'; });

  const pane = el('div', {},
    f.card({ title: 'Transform & crop', icon: 'crop', reset: 'transform' },
      el('div', { class: 'btns' },
        el('button', { class: 'btn', title: 'Rotate left', onclick: () => setValue('rotate', (state.rotate + 270) % 360) }, el('span', { html: icons.rotl, style: 'display:contents' })),
        el('button', { class: 'btn', title: 'Rotate right', onclick: () => setValue('rotate', (state.rotate + 90) % 360) }, el('span', { html: icons.rotr, style: 'display:contents' })),
        el('button', { class: 'btn', title: 'Flip horizontal', onclick: () => setValue('flipH', !state.flipH) }, el('span', { html: icons.fliph, style: 'display:contents' })),
        el('button', { class: 'btn', title: 'Flip vertical', onclick: () => setValue('flipV', !state.flipV) }, el('span', { html: icons.flipv, style: 'display:contents' }))),
      f.select('cropAspect', 'Crop ratio', [['free', 'Free'], ['original', 'Original'], ['1', '1 : 1'], ['1.3333', '4 : 3'], ['0.75', '3 : 4'], ['1.5', '3 : 2'], ['0.6667', '2 : 3'], ['1.7778', '16 : 9'], ['model', 'Match model size']]),
      el('div', { class: 'btns' }, cropBtn,
        el('button', { class: 'btn', onclick: () => { cropMode = false; setValue('cropRect', null); } }, 'Reset crop')),
      el('div', { class: 'note' }, 'In crop mode, drag on the image to draw a crop box, drag inside to move it, or drag a corner to resize.')),
    f.card({ title: 'Adjustments', icon: 'sliders', reset: 'adjust' },
      hist,
      f.toggle('autoLevels', 'Auto levels', { tip: 'Stretch tones to use the full thickness range' }),
      f.slider('brightness', 'Brightness', -100, 100, 1, '', { def: 0 }),
      f.slider('contrast', 'Contrast', -100, 100, 1, '', { def: 0 }),
      f.slider('gamma', 'Gamma', 0.3, 3, 0.05, '', { def: 1 }),
      f.slider('shadows', 'Shadows', -100, 100, 1, '', { def: 0, tip: 'Lift or deepen dark tones' }),
      f.slider('highlights', 'Highlights', -100, 100, 1, '', { def: 0 }),
      f.slider('smooth', 'Smooth', 0, 10, 0.1, 'px', { def: 0, tip: 'Reduce noise / JPEG artifacts (fewer triangles too!)' }),
      f.slider('sharpen', 'Sharpen', 0, 100, 1, '%', { def: 0 }),
      f.slider('edgeFade', 'Edge fade', 0, 100, 1, '%', { def: 0, tip: 'Soft vignette that fades the edges to thin/bright' }),
      f.toggle('invert', 'Invert (negative)')),
    f.card({ title: 'Text overlay', icon: 'text', reset: 'text' },
      f.toggle('textOn', 'Add text'),
      f.text('text', '', { multiline: true, placeholder: 'Your message…', show: (s) => s.textOn }),
      f.select('textFont', 'Font', [['"Segoe UI", sans-serif', 'Segoe UI'], ['Georgia, serif', 'Georgia'], ['"Segoe Script", cursive', 'Segoe Script'], ['"Comic Sans MS", cursive', 'Comic Sans'], ['Impact, sans-serif', 'Impact'], ['Consolas, monospace', 'Consolas']], { show: (s) => s.textOn }),
      f.slider('textSize', 'Size', 2, 40, 0.5, '%', { show: (s) => s.textOn }),
      f.seg('textPos', 'Position', [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']], { show: (s) => s.textOn }),
      f.seg('textColor', 'Color', [['white', 'Light'], ['black', 'Dark']], { show: (s) => s.textOn }),
      f.toggle('textBold', 'Bold', { show: (s) => s.textOn }),
      f.toggle('textOutline', 'Outline', { show: (s) => s.textOn })),
  );
  panes.edit = { el: pane, form: f };
}

function buildModelPane() {
  const f = new Form(ctx); forms.push(f);
  const flat = (s) => FLAT_SHAPES.has(s.shape);
  const axis = (s) => WRAP_SHAPES.has(s.shape);
  const qualityInfo = f.dyn((n) => {
    const L = computeLayout(state, 'export');
    const raw = estimateTriangles(L);
    const warn = raw > 1e6;
    n.replaceChildren(el('div', { class: 'note' },
      `Grid ${L.cols} × ${L.rows} · raw ≈ ${fmtCount(raw)} triangles`,
      el('br'),
      state.optimize !== 'off' || state.capTriangles
        ? el('span', {}, 'Exported mesh is optimized ', el('b', {}, state.capTriangles ? `to ≤ ${fmtCount(state.maxTriangles)}` : ''), warn ? ' — no slicer slowdowns.' : '.')
        : el('span', {}, warn ? '⚠ Optimization is off — slicers may warn about > 1M triangles.' : ''),
      L.capped ? el('div', {}, '⚠ Very large: resolution was reduced to fit memory.') : null));
  });

  const pane = el('div', {},
    f.card({ title: 'Shape', icon: 'shape', reset: 'shape' },
      f.tiles('shape', [['plane', 'Flat', 'sh-plane'], ['curve', 'Curved', 'sh-curve'], ['cylinder', 'Cylinder', 'sh-cylinder'], ['polygon', 'Prism', 'sh-polygon'], ['sphere', 'Globe', 'sh-sphere']]),
      f.slider('width', 'Width', 20, 300, 0.5, 'mm', { show: flat, hardMax: 1000 }),
      f.slider('width', 'Diameter', 20, 300, 0.5, 'mm', { show: axis, hardMax: 1000 }),
      f.slider('height', 'Height', 10, 300, 0.1, 'mm', { show: (s) => s.shape !== 'sphere', hardMax: 1000 }),
      f.toggle('lockAspect', 'Keep image ratio', { show: (s) => s.shape !== 'sphere' }),
      f.slider('curveAngle', 'Curve angle', 10, 300, 1, '°', { show: (s) => s.shape === 'curve' }),
      f.slider('polySides', 'Sides', 3, 12, 1, '', { show: (s) => s.shape === 'polygon' }),
      f.slider('sphereTop', 'Top opening', 10, 85, 1, '°', { show: (s) => s.shape === 'sphere', tip: 'Latitude where the image ends at the top' }),
      f.slider('sphereBottom', 'Bottom opening', -85, -5, 1, '°', { show: (s) => s.shape === 'sphere', tip: 'Latitude where the image ends at the bottom (bulb goes here)' }),
      f.group('Thickness'),
      f.slider('minThick', 'Min thick', 0.2, 3, 0.05, 'mm', { tip: 'Brightest areas' }),
      f.slider('maxThick', 'Max thick', 1, 8, 0.05, 'mm', { tip: 'Darkest areas' }),
      f.seg('mapping', 'Tone curve', [['linear', 'Linear'], ['light', 'Light-accurate']], { tip: 'Light-accurate compensates for exponential light absorption, for truer mid-tones' }),
      f.slider('attenuation', 'Filament opacity', 0.3, 3, 0.05, '/mm', { tip: 'How quickly light fades through your filament. White PLA ≈ 1.0' }),
      f.toggle('inside', 'Relief inside', { tip: 'Put the textured side inside (lamps) or facing you (flat)' }),
      f.group('Outline', { show: flat }),
      f.tiles('outline', [['rect', 'Rect', 'ol-rect'], ['rounded', 'Rounded', 'ol-rounded'], ['ellipse', 'Oval', 'ol-ellipse'], ['heart', 'Heart', 'ol-heart'],
        ['hexagon', 'Hexagon', 'ol-hexagon'], ['octagon', 'Octagon', 'ol-octagon'], ['star', 'Star', 'ol-star'], ['arch', 'Arch', 'ol-arch']], { small: true, show: flat }),
      f.slider('cornerRadius', 'Corner radius', 1, 50, 0.5, 'mm', { show: (s) => flat(s) && s.outline === 'rounded' })),

    f.card({ title: 'Frame', icon: 'frame', reset: 'frame' },
      f.seg('frame', '', [['none', 'None'], ['bevel', 'Beveled'], ['flat', 'Flat'], ['rounded', 'Rounded']]),
      f.slider('frameWidth', 'Width', 0.5, 20, 0.5, 'mm', { show: (s) => s.frame !== 'none' && !s.frameAdvanced }),
      f.slider('frameDepth', 'Depth', 1, 12, 0.1, 'mm', { show: (s) => s.frame !== 'none' }),
      f.slider('frameAngle', 'Bevel angle', 10, 90, 1, '°', { show: (s) => s.frame === 'bevel' }),
      f.toggle('frameAdvanced', 'Per-side widths', { show: (s) => s.frame !== 'none' }),
      f.sub({ show: (s) => s.frame !== 'none' && s.frameAdvanced },
        f.slider('frameTop', 'Top', 0, 30, 0.5, 'mm'),
        f.slider('frameBottom', 'Bottom', 0, 30, 0.5, 'mm'),
        f.slider('frameLeft', 'Left', 0, 30, 0.5, 'mm', { show: flat }),
        f.slider('frameRight', 'Right', 0, 30, 0.5, 'mm', { show: flat }))),

    f.card({ title: 'Quality', icon: 'quality', reset: 'quality' },
      f.slider('mmpp', 'mm per pixel', 0.05, 0.5, 0.01, 'mm', { tip: 'Export resolution. 0.1–0.2 matches a 0.4 mm nozzle.' }),
      f.group('Preview quality'),
      f.seg('previewQuality', '', PREVIEW_QUALITY.map((q, i) => [i, q.label])),
      qualityInfo),

    f.card({ title: 'Attributes', icon: 'lamp', reset: 'attrs' },
      f.toggle('lamp', 'Lamp fitting', { tip: 'Bulb holder ring with spokes (round shapes) or a base with holder (flat)' }),
      f.sub({ show: (s) => s.lamp },
        f.slider('lampOffsetZ', 'Offset (Z)', 0, 100, 0.5, 'mm', { show: axis }),
        f.slider('lampDistX', 'Distance (X)', 10, 150, 1, 'mm', { show: flat, tip: 'Distance of the bulb behind the lithophane' }),
        f.select('fitter', 'Fitter', [['bulb', 'Bulb fitter'], ['none', 'None']]),
        f.slider('fitterHeight', 'Height', 2, 60, 0.5, 'mm', { show: (s) => s.fitter === 'bulb' }),
        f.slider('fitterThick', 'Thickness', 0.8, 8, 0.1, 'mm', { show: (s) => s.fitter === 'bulb' }),
        f.slider('fitterDiameter', 'Diameter', 5, 80, 0.5, 'mm', { show: (s) => s.fitter === 'bulb', tip: 'Inner diameter. E14 ≈ 28–29 mm, E27 ≈ 40 mm, LED puck: measure it' }),
        f.select('connectors', 'Connector', [['connectors', 'Spokes'], ['none', 'None']], { show: axis }),
        f.slider('connAmount', 'Amount', 1, 12, 1, '', { show: (s) => axis(s) && s.connectors !== 'none' }),
        f.slider('connHeight', 'Height', 1, 40, 0.5, 'mm', { show: (s) => axis(s) && s.connectors !== 'none' }),
        f.slider('connWidth', 'Width', 1, 20, 0.5, 'mm', { show: (s) => axis(s) && s.connectors !== 'none' }),
        f.slider('connAngle', 'Angle', 0, 360, 1, '°', { show: (s) => axis(s) && s.connectors !== 'none' })),
      f.toggle('nightlight', 'Nightlight holder', { show: flat, tip: 'Pocket behind the lithophane for a plug-in or puck LED night light' }),
      f.sub({ show: (s) => flat(s) && s.nightlight },
        f.slider('nlDistance', 'Distance', 0, 40, 0.5, 'mm'),
        f.slider('nlWidth', 'Width', 5, 80, 0.5, 'mm'),
        f.slider('nlDepth', 'Depth', 5, 80, 0.5, 'mm'),
        f.slider('nlHeight', 'Height', 3, 40, 0.5, 'mm'),
        f.slider('nlThick', 'Thickness', 0.8, 5, 0.1, 'mm')),
      f.toggle('stand', 'Stand / base', { show: flat }),
      f.sub({ show: (s) => flat(s) && s.stand },
        f.slider('standDepth', 'Depth', 5, 80, 0.5, 'mm'),
        f.slider('standHeight', 'Height', 1, 20, 0.5, 'mm'),
        f.slider('standMargin', 'Side margin', 0, 20, 0.5, 'mm')),
      f.toggle('hanger', 'Hanging loop', { show: flat }),
      f.sub({ show: (s) => flat(s) && s.hanger },
        f.slider('hangerDiameter', 'Hole', 1.5, 12, 0.1, 'mm'),
        f.slider('hangerRing', 'Ring', 1, 8, 0.1, 'mm'))),

    f.card({ title: 'Preview lighting', icon: 'eye', reset: 'view' },
      f.seg('lighting', '', [['none', 'No light'], ['back', 'Back lighted'], ['normal', 'Normals']]),
      f.color('lightColor', 'Light color', { show: (s) => s.lighting === 'back' }),
      f.dual('intensityMin', 'intensityMax', 'Intensity', 0, 100, 1, '%', { show: (s) => s.lighting === 'back' }),
      f.color('materialColor', 'Material color', { show: (s) => s.lighting === 'none' }),
      f.toggle('autoUpdate', 'Auto update'),
      el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => buildPreview() }, el('span', { html: icons.spin, style: 'display:contents' }), 'Update now'))),
  );
  panes.model = { el: pane, form: f };
}

function buildExportPane() {
  const f = new Form(ctx); forms.push(f);
  const stats = f.dyn((n) => {
    const s = lastStats;
    const L = computeLayout(state, 'export');
    const raw = estimateTriangles(L);
    const target = state.capTriangles ? Math.min(raw, state.maxTriangles) : raw;
    const [mname, dens] = MATERIALS[state.material];
    const vol = s ? s.volume : 0;
    const grams = (vol / 1000) * dens;
    const meters = vol / (Math.PI * 0.875 * 0.875) / 1000;
    n.replaceChildren(el('dl', { class: 'kv' },
      el('dt', {}, 'Size'), el('dd', {}, s ? s.size.map((v) => v.toFixed(1)).join(' × ') + ' mm' : '—'),
      el('dt', {}, 'Raw triangles'), el('dd', {}, '≈ ' + fmtCount(raw)),
      el('dt', {}, 'Exported triangles'), el('dd', {}, (state.optimize !== 'off' || (state.capTriangles && raw > state.maxTriangles)) ? `≤ ${fmtCount(target)}` : fmtCount(raw)),
      el('dt', {}, `${mname} weight`), el('dd', {}, s ? `≈ ${grams.toFixed(1)} g` : '—'),
      el('dt', {}, 'Filament (1.75)'), el('dd', {}, s ? `≈ ${meters.toFixed(2)} m` : '—'),
    ),
    ...[lastExport ? el('div', { class: 'note good' }, `Last export: ${fmtCount(lastExport.triangles)} triangles (from ${fmtCount(lastExport.rawTriangles)}), ${fmtBytes(lastExport.bytes)}`) : null].filter(Boolean));
  });

  const pane = el('div', {},
    f.card({ title: 'Export model', icon: 'download' },
      f.text('fileName', 'File name', { placeholder: 'lithophane' }),
      f.tiles('format', [['stl', 'STL', 'cube'], ['3mf', '3MF', 'layers'], ['obj', 'OBJ', 'iso'], ['ply', 'PLY', 'grid'], ['stl-ascii', 'STL txt', 'text']]),
      f.seg('printOrient', 'On the bed', [['flat', 'Lying flat'], ['upright', 'Upright']], {
        show: (s) => s.shape === 'plane' && !s.stand && !s.nightlight && !s.lamp,
        tip: 'Lying flat is easiest; upright usually gives smoother tones. The preview always shows it upright.' }),
      f.select('optimize', 'Optimize mesh', [['balanced', 'Balanced (0.02 mm)'], ['light', 'Detailed (0.005 mm)'], ['strong', 'Small file (0.05 mm)'], ['off', 'Off (every pixel)']],
        { tip: 'Merges triangles in flat or smooth areas. Error stays below the stated tolerance — far finer than a 0.4 mm nozzle can print.' }),
      f.toggle('capTriangles', 'Limit triangles'),
      f.slider('maxTriangles', 'Max triangles', 50000, 2000000, 10000, '', { show: (s) => s.capTriangles }),
      f.select('material', 'Material', Object.entries(MATERIALS).map(([k, [n]]) => [k, n])),
      stats,
      el('button', { class: 'btn primary big', onclick: () => doExport() }, el('span', { html: icons.download, style: 'display:contents' }), 'Export model'),
      el('div', { class: 'note' }, 'Slicer-friendly: watertight, optimized meshes stay well under 1M triangles, so Bambu Studio, PrusaSlicer, OrcaSlicer and Cura load them instantly.')),
    f.card({ title: 'More exports', icon: 'layers' },
      el('div', { class: 'btns' },
        el('button', { class: 'btn', onclick: exportHeightmap }, el('span', { html: icons.image, style: 'display:contents' }), 'Heightmap PNG'),
        el('button', { class: 'btn', onclick: saveScreenshot }, el('span', { html: icons.camera, style: 'display:contents' }), 'Screenshot')),
      el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: saveProject }, el('span', { html: icons.save, style: 'display:contents' }), 'Save settings (.json)'))),
    f.card({ title: 'Print tips', icon: 'info', open: false },
      el('div', { class: 'note' },
        el('b', {}, 'Orientation: '), 'print flat lithophanes standing upright for the smoothest tones.', el('br'),
        el('b', {}, 'Infill: '), '100% — walls are the image.', el('br'),
        el('b', {}, 'Layer height: '), '0.08–0.12 mm.', el('br'),
        el('b', {}, 'Filament: '), 'white PLA; set "Filament opacity" to match.', el('br'),
        el('b', {}, 'Adhesion: '), 'use a brim (5 mm) on tall upright prints.', el('br'),
        el('b', {}, 'Speed: '), 'slow outer walls (≈ 40 mm/s) to avoid wobble.')),
  );
  panes.export = { el: pane, form: f };
}

// ================================================================ Pop 3D (image → 3D model)
let popWorker = null, popSeq = 0, popBusy = false, popPending = null, popWorkerBusy = false;
let popDepthMap = null;   // { data, width, height } near = high
let popAlpha = null;      // { data, width, height } 0..255 foreground
let popAspect = 1, popStale = false, popSource = null; // { kind: 'depth' } | { kind: 'mesh', bytes, format, rescale }
let popReport = null, popMask = null, popDepthCanvas = null, popView2d = 'photo', popFirst = true;
let popToken = store.get('lumi.hfToken', '');
let localStatus = null, localLog = '', localInstalling = false;
async function refreshLocal() {
  if (!window.lumi?.local3dStatus) return;
  localStatus = await window.lumi.local3dStatus();
  syncAll();
}

async function installLocal() {
  if (localInstalling) return;
  localInstalling = true; localLog = 'Starting…'; syncAll();
  const off = window.lumi.onHfStatus((st) => { localLog = st.log ? `${st.message}\n${st.log}` : st.message; if (popUI.localLog) popUI.localLog.textContent = localLog; });
  try {
    const r = await window.lumi.local3dInstall();
    if (r.error) { localLog = '⚠ ' + r.error; toast('Local 3D install failed'); }
    else { localStatus = r; localLog = ''; state.popAI = 'local'; toast('Local 3D installed — runs on your GPU now'); }
  } finally { off(); localInstalling = false; syncAll(); }
}

async function localCall(c) {
  const off = window.lumi.onHfStatus((st) => setPopBusy(st.message || 'Working on your GPU…'));
  try {
    setPopBusy('Starting local 3D…');
    const r = await window.lumi.local3dRun({
      image: await canvasPNG(c),
      options: { localModel: state.popLocalModel, steps: state.popSteps, octree: state.popOctree, seed: state.popSeed },
    });
    if (r.error) { toast('Local 3D: ' + r.error.split('\n')[0]); if (popUI.err) popUI.err.textContent = r.error.slice(0, 1200); return null; }
    if (popUI.err) popUI.err.textContent = '';
    toast(`Generated on your GPU in ${r.seconds.toFixed(0)} s`);
    return r;
  } finally { off(); }
}
const popUI = {};

function getPopWorker() {
  if (popWorker) return popWorker;
  popWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  popWorker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { exportProgress(m); return; }
    if (m.type === 'file') { exportDone(m); return; }
    if (m.type === 'pop-mesh') {
      viewer.setPopMesh(m, popFirst);
      popFirst = false;
      popReport = m.report;
      if (m.mask) popMask = { data: m.mask, cols: m.mcols, rows: m.mrows };
      if (tab === 'pop') $('#dims').textContent = `${m.report.size.map((v) => v.toFixed(1)).join(' × ')} mm`;
      if (view === '2d') draw2d();
    } else if (m.type === 'error') {
      console.error(m.message);
      if ($('#modal').classList.contains('hidden')) toast('Pop failed: ' + m.message.split('\n')[0]);
      else { toast('Export failed: ' + m.message.split('\n')[0]); closeExport(); }
    }
    popWorkerBusy = false;
    setPopBusy(null);
    syncAll();
    if (popPending) { const p = popPending; popPending = null; p(); }
  };
  return popWorker;
}

function popPost(msg, transfer = []) {
  const send = () => { popWorkerBusy = true; setPopBusy('Building model…'); getPopWorker().postMessage({ ...msg, id: ++popSeq }, transfer); };
  if (popWorkerBusy) popPending = send; else send();
}

// ---- local AI worker client
let aiWorker = null, aiSeq = 0;
const aiPending = new Map();
function ai(type, img, extra = {}) {
  if (!aiWorker) {
    aiWorker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    aiWorker.onmessage = (e) => {
      const m = e.data, p = aiPending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { setPopBusy(m.message, m.p); return; }
      aiPending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
  }
  const id = ++aiSeq;
  return new Promise((resolve, reject) => {
    aiPending.set(id, { resolve, reject });
    aiWorker.postMessage({ type, id, image: img.data.buffer.slice(0), width: img.width, height: img.height, ...extra });
  });
}

function popCanvas(maxDim) {
  if (!oriented) oriented = orient(source, state);
  const r = state.cropRect || { x: 0, y: 0, w: 1, h: 1 };
  const sw = r.w * oriented.width, sh = r.h * oriented.height;
  const k = Math.min(1, maxDim / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(sw * k)); c.height = Math.max(8, Math.round(sh * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(oriented, r.x * oriented.width, r.y * oriented.height, sw, sh, 0, 0, c.width, c.height);
  return c;
}
const canvasImage = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height);
async function canvasPNG(c) { return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()); }

function setPopBusy(msg, p) {
  popBusy = !!msg;
  $('#busy').classList.toggle('hidden', !msg);
  $('#busy span').textContent = msg ? msg + (p != null && p < 1 ? ` ${Math.round(p * 100)}%` : '') : 'Building preview…';
  popUI.buttons?.forEach((b) => { b.disabled = popBusy; });
}

function markPopStale() {
  if (popDepthMap || popSource?.kind === 'mesh') popStale = true;
  if (popUI.thumb) refreshPopThumb();
}

function refreshPopThumb() {
  if (!source || !popUI.thumb) return;
  popUI.thumb.src = popCanvas(480).toDataURL();
}

// near = high. Marigold returns depth (far = high): detect by comparing centre vs border.
function fixPolarity(d) {
  const { data, width: w, height: h } = d;
  let c = 0, cn = 0, b = 0, bn = 0;
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const v = data[i * w + j];
    if (Math.abs(i / h - 0.5) < 0.2 && Math.abs(j / w - 0.5) < 0.2) { c += v; cn++; }
    else if (i < h * 0.06 || i > h * 0.94 || j < w * 0.06 || j > w * 0.94) { b += v; bn++; }
  }
  if (c / cn < b / bn) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
  return d;
}

async function runDepth() {
  if (!source) { toast('Load an image first'); return; }
  if (popBusy) return;
  try {
    const c = popCanvas(state.popEngine === 'marigold' ? 768 : 1024);
    popAspect = c.height / c.width;
    setPopBusy('Preparing image…');
    if (state.popEngine === 'marigold') {
      const r = await hfCall('marigold', c);
      if (!r) return;
      popDepthMap = fixPolarity({ data: r.data, width: r.width, height: r.height });
    } else {
      const r = await ai('depth', canvasImage(c), { model: state.popEngine === 'localBase' ? 'depthBase' : 'depth' });
      popDepthMap = { data: r.data, width: r.width, height: r.height };
    }
    popAlpha = null;
    if (state.popBg === 'ai') await runBg(c);
    popSource = { kind: 'depth' };
    popStale = false; popFirst = true;
    makeDepthCanvas();
    buildPopDepth();
  } catch (err) {
    console.error(err);
    toast('Depth failed: ' + String(err.message).split('\n')[0]);
  } finally { if (!popWorkerBusy) setPopBusy(null); syncAll(); }
}

async function runBg(c) {
  c = c || popCanvas(1024);
  const r = await ai('bg', canvasImage(c));
  popAlpha = { data: r.data, width: r.width, height: r.height };
}

function buildPopDepth() {
  if (!popDepthMap) return;
  const input = {
    depth: popDepthMap.data.slice(), dw: popDepthMap.width, dh: popDepthMap.height,
    alpha: popAlpha ? popAlpha.data.slice() : null, aw: popAlpha?.width, ah: popAlpha?.height, aspect: popAspect,
  };
  const t = [input.depth.buffer];
  if (input.alpha) t.push(input.alpha.buffer);
  popPost({ type: 'pop-depth', input, settings: { ...state } }, t);
}

async function hfCall(engine, c) {
  if (!window.lumi?.hfRun) { toast('Online AI needs the desktop app'); return null; }
  const off = window.lumi.onHfStatus((st) => setPopBusy(st.message || st.stage));
  try {
    setPopBusy('Uploading image…');
    const r = await window.lumi.hfRun({
      engine, image: await canvasPNG(c), token: popToken || undefined,
      options: { steps: state.popSteps, octree: state.popOctree, seed: state.popSeed },
    });
    if (r.error) { toast(r.error.split('\n')[0]); if (popUI.err) popUI.err.textContent = r.error; return null; }
    if (popUI.err) popUI.err.textContent = '';
    return r;
  } finally { off(); }
}

async function runAI3D() {
  if (!source) { toast('Load an image first'); return; }
  if (popBusy) return;
  try {
    const r = state.popAI === 'local' ? await localCall(popCanvas(1024)) : await hfCall(state.popAI, popCanvas(1024));
    if (!r) return;
    popSource = { kind: 'mesh', bytes: r.data, format: r.format };
    popStale = false; popFirst = true;
    loadPopMesh();
  } catch (err) {
    toast('3D generation failed: ' + String(err.message).split('\n')[0]);
  } finally { if (!popWorkerBusy) setPopBusy(null); syncAll(); }
}

function loadPopMesh() {
  const bytes = popSource.bytes.slice();
  popPost({ type: 'pop-load', bytes, format: popSource.format, settings: { ...state } }, [bytes.buffer]);
}

async function importPopMesh(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['stl', 'obj', 'glb'].includes(ext)) { toast('Use an STL, OBJ or GLB file'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === 'stl') state.popRescale = false;
  popSource = { kind: 'mesh', bytes, format: ext };
  popFirst = true; popStale = false;
  loadPopMesh();
  syncAll();
}

let popTimer = null;
function onPopChange(keys) {
  if (keys.includes('popColor')) viewer.setClayColor(state.popColor);
  const depthKey = keys.some((k) => POP_DEPTH_KEYS.has(k));
  const cleanKey = keys.some((k) => POP_CLEAN_KEYS.has(k));
  if (!depthKey && !cleanKey) return;
  clearTimeout(popTimer);
  popTimer = setTimeout(async () => {
    if (popSource?.kind === 'depth') {
      if (keys.includes('popBg') && state.popBg === 'ai' && !popAlpha) {
        try { await runBg(); } catch (e) { toast('Background removal failed: ' + e.message); }
        if (!popWorkerBusy) setPopBusy(null);
      }
      buildPopDepth();
    } else if (popSource?.kind === 'mesh' && cleanKey) {
      popPost({ type: 'pop-clean', settings: { ...state } });
    }
  }, 160);
}

function makeDepthCanvas() {
  const d = popDepthMap;
  const c = document.createElement('canvas');
  c.width = d.width; c.height = d.height;
  const g = c.getContext('2d'), img = g.createImageData(d.width, d.height);
  let lo = Infinity, hi = -Infinity;
  for (const v of d.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < d.data.length; i++) {
    const t = (d.data[i] - lo) / (hi - lo || 1);
    // warm "glow" colormap: deep purple → orange → cream
    img.data[i * 4] = 40 + 215 * Math.min(1, t * 1.4);
    img.data[i * 4 + 1] = 20 + (220 * Math.max(0, t - 0.35)) / 0.65;
    img.data[i * 4 + 2] = 70 + (120 * Math.max(0, t - 0.7)) / 0.3 + 40 * (1 - t);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  popDepthCanvas = c;
}

function drawPop2d() {
  const useDepth = popView2d === 'depth' && popDepthCanvas;
  const base = useDepth ? popDepthCanvas : popCanvas(1600);
  const ar = useDepth ? popAspect : base.height / base.width;
  const W = Math.min(1600, Math.max(800, base.width));
  canvas2d.width = W; canvas2d.height = Math.round(W * ar);
  const g = canvas2d.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, canvas2d.width, canvas2d.height);
  if (popView2d === 'mask' && popMask && popSource?.kind === 'depth') {
    const m = document.createElement('canvas');
    m.width = popMask.cols; m.height = popMask.rows;
    const mg = m.getContext('2d'), id = mg.createImageData(m.width, m.height);
    for (let k = 0; k < popMask.data.length; k++) { id.data[k * 4] = 12; id.data[k * 4 + 1] = 14; id.data[k * 4 + 2] = 20; id.data[k * 4 + 3] = popMask.data[k] ? 0 : 200; }
    mg.putImageData(id, 0, 0);
    g.drawImage(m, 0, 0, canvas2d.width, canvas2d.height);
  }
}

function popStatusBar() {
  const r = popReport;
  if (!r) return [el('span', {}, 'Pop 3D · pick a method and press the ✨ button')];
  return [
    el('span', {}, el('b', {}, fmtCount(r.triangles)), ' tris'),
    el('span', { class: 'pill' }, r.watertight ? '✓ watertight' : `⚠ ${r.boundary} open edges`),
    el('span', {}, `${r.parts} part${r.parts === 1 ? '' : 's'}`),
    r.ms ? el('span', {}, `built in ${Math.round(r.ms)} ms`) : null,
    popStale ? el('span', { class: 'pill' }, 'Image changed — run again to update') : null,
    el('span', { class: 'right' }, source ? sourceName : 'No image'),
  ].filter(Boolean);
}

async function doPopExport() {
  if (!popReport) { toast('Make a 3D model first'); return; }
  const fmt = { stl: ['STL', 'stl'], 'stl-ascii': ['STL', 'stl'], '3mf': ['3MF', '3mf'], obj: ['OBJ', 'obj'], ply: ['PLY', 'ply'] }[state.format];
  const base = ((state.fileName || sourceName || 'model') + '-3d').replace(/[\\/:*?"<>|]+/g, '_');
  const name = `${base}.${fmt[1]}`;
  let filePath = null;
  if (window.lumi) {
    filePath = await window.lumi.pickSavePath({ defaultName: name, filters: [{ name: fmt[0], extensions: [fmt[1]] }] });
    if (!filePath) return;
  }
  exportTarget = { filePath, name, t0: performance.now(), pop: true };
  $('#modal').classList.remove('hidden');
  $('#modalTitle').textContent = `Exporting ${name}`;
  $('#modalStage').textContent = 'Preparing…';
  $('#modalBar').style.width = '2%';
  $('#modalExtra').textContent = '';
  const thumb = await exportThumbnail();
  getPopWorker().postMessage({ type: 'pop-export', settings: { ...state }, name: base, thumb });
}

function buildPopPane() {
  const f = new Form(ctx); forms.push(f);
  const isDepth = (s) => s.popMethod === 'depth', isAI = (s) => s.popMethod === 'ai', isImp = (s) => s.popMethod === 'import';
  popUI.thumb = el('img', { class: 'thumb' });
  popUI.err = el('div', { class: 'hint', style: 'white-space:pre-wrap;color:#e0603a' });
  const btn = (label, icon, onclick, cls = 'btn primary big') => el('button', { class: cls, onclick }, el('span', { html: icons[icon], style: 'display:contents' }), label);
  const depthBtn = btn('Estimate depth & pop!', 'sparkle', runDepth);
  const aiBtn = btn('Generate full 3D', 'sparkle', runAI3D);
  const fileIn = el('input', { type: 'file', accept: '.stl,.obj,.glb', hidden: true, onchange: (e) => { if (e.target.files[0]) importPopMesh(e.target.files[0]); e.target.value = ''; } });
  const impBtn = btn('Open STL / OBJ / GLB…', 'folder', () => fileIn.click());
  popUI.buttons = [depthBtn, aiBtn, impBtn];
  const token = el('input', { class: 'text', type: 'password', placeholder: 'hf_… (optional)' });
  token.value = popToken;
  token.addEventListener('change', () => { popToken = token.value.trim(); store.set('lumi.hfToken', popToken); toast(popToken ? 'Token saved on this PC' : 'Token removed'); });

  const report = f.dyn((n) => {
    const r = popReport;
    if (!r) { n.replaceChildren(el('div', { class: 'note' }, 'No model yet.')); return; }
    const grams = (r.volume / 1000) * MATERIALS[state.material][1];
    n.replaceChildren(
      el('div', { class: 'note ' + (r.watertight ? 'good' : '') }, r.watertight ? '✓ Watertight & printable' : `⚠ ${r.boundary} open edges, ${r.nonManifold} non-manifold — try more hole filling`),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Size'), el('dd', {}, r.size.map((v) => v.toFixed(1)).join(' × ') + ' mm'),
        el('dt', {}, 'Triangles'), el('dd', {}, fmtCount(r.triangles) + (r.inputTriangles !== r.triangles ? ` (from ${fmtCount(r.inputTriangles)})` : '')),
        el('dt', {}, 'Parts kept'), el('dd', {}, String(r.parts)),
        el('dt', {}, 'Junk removed'), el('dd', {}, `${r.partsRemoved} bits · ${fmtCount(r.degenerate)} bad tris`),
        r.holesFilled ? el('dt', {}, 'Holes filled') : null, r.holesFilled ? el('dd', {}, String(r.holesFilled)) : null,
        el('dt', {}, `${MATERIALS[state.material][0]} weight`), el('dd', {}, `≈ ${grams.toFixed(1)} g (solid)`)));
  });

  const viewSeg = el('div', { class: 'seg', style: 'margin-top:8px' }, ...['photo', 'depth', 'mask'].map((v) => el('button', {
    class: v === popView2d ? 'active' : '',
    onclick: (e) => {
      popView2d = v;
      viewSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
      setView('2d');
    },
  }, { photo: 'Photo', depth: 'Depth map', mask: 'Cut-out' }[v])));

  const pane = el('div', {}, fileIn,
    f.card({ title: 'Pop 3D — image to model', icon: 'pop' },
      popUI.thumb,
      el('div', { class: 'hint', style: 'margin:6px 0' }, 'Uses the image from the Image tab (Edit crop & rotation apply).'),
      f.seg('popMethod', '', [['depth', 'Depth relief'], ['ai', 'Full 3D (AI)'], ['import', 'Repair mesh']]),
      f.dyn((n) => n.replaceChildren(el('div', { class: 'note' },
        state.popMethod === 'depth' ? 'Estimates depth from one photo and sculpts a relief or a puffy figure. Runs on your PC — free & private after a one-time model download.'
          : state.popMethod === 'ai' ? 'Generative AI imagines the back and hidden sides to build a complete 3D object. Uses free Hugging Face GPUs (internet needed). Best with one object on a plain background.'
            : 'Load any STL / OBJ / GLB and clean it up for printing.'))),
      viewSeg),

    f.card({ title: 'Depth relief', icon: 'layers', show: isDepth, reset: 'pop' },
      f.select('popEngine', 'Depth AI', [['local', 'Depth Anything · fast'], ['localBase', 'Depth Anything · sharp'], ['marigold', 'Marigold · online']]),
      f.select('popBg', 'Background', [['ai', 'Remove (AI cut-out)'], ['depth', 'Remove by depth'], ['keep', 'Keep as plate']]),
      f.slider('popCutoff', 'Depth cutoff', 0, 90, 1, '%', { show: (s) => s.popBg === 'depth' }),
      depthBtn,
      f.group('Sculpt'),
      f.slider('popWidth', 'Width', 20, 300, 1, 'mm'),
      f.slider('popDepth', 'Depth', 1, 80, 0.5, 'mm', { tip: 'How far the nearest point sticks out' }),
      f.slider('popBase', 'Base', 0, 10, 0.1, 'mm', { tip: 'Solid backing thickness' }),
      f.slider('popBack', 'Back bulge', 0, 100, 1, '%', { tip: '0 = flat back (no supports). Higher mirrors depth to the back for a puffy, figure-like model.' }),
      f.slider('popRound', 'Edge rounding', 0, 15, 0.1, 'mm', { show: (s) => s.popBg !== 'keep' }),
      f.slider('popCurve', 'Depth curve', 0.3, 3, 0.05, '', { tip: '<1 lifts flat areas, >1 exaggerates the nearest parts' }),
      f.slider('popSmooth', 'Smoothing', 0, 3, 0.05, 'mm', { tip: 'Removes depth noise / bumps' }),
      f.slider('popRes', 'Resolution', 0.1, 1, 0.05, 'mm'),
      f.toggle('popInvert', 'Invert depth'),
      f.seg('popOrient', 'Orientation', [['lying', 'Lying'], ['standing', 'Standing']]),
      f.group('Cut-out cleanup', { show: (s) => s.popBg !== 'keep' }),
      f.slider('popOutline', 'Smooth outline', 0, 5, 0.1, 'mm', { show: (s) => s.popBg !== 'keep' }),
      f.slider('popIslands', 'Drop islands <', 0, 50, 0.5, '%', { show: (s) => s.popBg !== 'keep', tip: 'Removes stray specks smaller than this share of the main shape' }),
      f.slider('popHoles', 'Fill holes <', 0, 50, 0.5, '%', { show: (s) => s.popBg !== 'keep' })),

    f.card({ title: 'Full 3D with AI', icon: 'cube', show: isAI },
      f.select('popAI', 'Generator', [['local', 'Your GPU · offline'], ['hunyuan2', 'Hunyuan3D-2 · online'], ['hunyuan21', 'Hunyuan3D-2.1 · token'], ['trellis', 'TRELLIS · token']]),
      f.dyn((n) => {
        if (state.popAI !== 'local') { n.replaceChildren(); return; }
        const st = localStatus;
        if (!window.lumi?.local3dStatus) { n.replaceChildren(el('div', { class: 'note' }, 'Local 3D needs the desktop app.')); return; }
        if (!st) { n.replaceChildren(el('div', { class: 'note' }, 'Checking your GPU…')); return; }
        if (!st.gpu) { n.replaceChildren(el('div', { class: 'note' }, '⚠ No NVIDIA GPU detected — local 3D needs an NVIDIA card with ≥ 8 GB VRAM. Use an online generator instead.')); return; }
        if (!st.installed) {
          popUI.localLog = el('div', { class: 'hint', style: 'white-space:pre-wrap;max-height:64px;overflow:hidden' }, localLog);
          n.replaceChildren(
            el('div', { class: 'note' }, el('b', {}, st.gpu.name), ` (${st.gpu.vramGB} GB) detected. One-time setup downloads Python, PyTorch and Hunyuan3D-2 (≈ 8–10 GB on C:). After that: no internet, no quotas, ~10–40 s per model.`),
            el('button', { class: 'btn primary big', disabled: localInstalling, onclick: installLocal }, el('span', { html: icons.download, style: 'display:contents' }), localInstalling ? 'Installing…' : 'Install local 3D'),
            popUI.localLog);
          return;
        }
        n.replaceChildren(el('div', { class: 'note good' }, `✓ Runs on your ${st.gpu.name} — offline, unlimited.`));
      }),
      f.seg('popLocalModel', 'Model', [['turbo', 'Turbo'], ['standard', 'Best'], ['mini', 'Mini']], { show: (s) => s.popAI === 'local' && localStatus?.installed, tip: 'Turbo: ~10 s, great quality. Best: 30 steps, finest shape. Mini: smallest, least VRAM.' }),
      f.dyn((n) => n.replaceChildren(...(state.popAI !== 'hunyuan2' && state.popAI !== 'local' && !popToken ? [el('div', { class: 'note' }, 'This generator reserves 90–120 s of GPU per run, which is more than the anonymous free allowance. Add a free Hugging Face token below, or use Hunyuan3D-2 · fast.')] : []))),
      f.slider('popSteps', 'Steps', 5, 50, 1, '', { show: (s) => !(s.popAI === 'local' && s.popLocalModel !== 'standard'), tip: 'More steps = cleaner shape, slower' }),
      f.seg('popOctree', 'Detail', [[128, 'Low'], [256, 'Std'], [384, 'High'], [512, 'Max']], { show: (s) => s.popAI.startsWith('hunyuan') || s.popAI === 'local' }),
      f.slider('popSeed', 'Seed', 0, 9999, 1, '', { tip: 'Change for a different interpretation of the hidden sides' }),
      f.sub({ show: (s) => s.popAI !== 'local' }, el('div', { class: 'row full' }, el('label', {}, 'HF token'), token),
        el('div', { class: 'hint' }, 'Optional. Free Hugging Face accounts get much more GPU time — create a "read" token at huggingface.co/settings/tokens. Stored only on this PC.')),
      aiBtn, popUI.err),

    f.card({ title: 'Repair a mesh', icon: 'wand', show: isImp },
      impBtn, el('div', { class: 'note' }, 'Removes junk bits and broken triangles, fills holes, adds a flat bottom and rescales — then export a clean, slicer-friendly file.')),

    f.card({ title: 'Clean & print prep', icon: 'wand', reset: 'popClean' },
      f.slider('popMinPart', 'Drop parts <', 0, 50, 0.5, '%', { tip: 'Removes floating bits smaller than this share of the main body' }),
      f.slider('popFill', 'Fill holes ≤', 0, 2000, 10, 'edges', { show: (s) => s.popMethod !== 'depth', tip: '0 = off' }),
      f.slider('popCut', 'Flat bottom cut', 0, 40, 0.5, '%', { tip: 'Slices off the bottom and caps it so the model stands flat without supports' }),
      f.toggle('popRescale', 'Scale to height', { show: (s) => s.popMethod !== 'depth' }),
      f.slider('popHeight', 'Height', 10, 300, 1, 'mm', { show: (s) => s.popMethod !== 'depth' && s.popRescale }),
      report),

    f.card({ title: 'Export 3D model', icon: 'download' },
      f.tiles('format', [['stl', 'STL', 'cube'], ['3mf', '3MF', 'layers'], ['obj', 'OBJ', 'iso'], ['ply', 'PLY', 'grid']]),
      f.select('optimize', 'Optimize mesh', [['balanced', 'Balanced (0.02 mm)'], ['light', 'Detailed (0.005 mm)'], ['strong', 'Small file (0.05 mm)'], ['off', 'Off']]),
      f.slider('popMaxTris', 'Max triangles', 20000, 1000000, 10000),
      f.color('popColor', 'Preview color'),
      btn('Export 3D model', 'download', doPopExport)),
  );
  panes.pop = { el: pane, form: f };
}

buildImagePane(); buildEditPane(); buildModelPane(); buildExportPane(); buildPopPane();
refreshLocal();
for (const [k, p] of Object.entries(panes)) { p.el.dataset.pane = k; panel.append(p.el); }

// ---------------------------------------------------------------- tabs & view switching
function setTab(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  for (const [k, p] of Object.entries(panes)) p.el.classList.toggle('hidden', k !== t);
  viewer.setScene(t === 'pop' ? 'pop' : 'litho');
  if (t === 'edit') setView('2d');
  else if (t === 'model' || t === 'export' || t === 'pop') setView('3d');
  if (t !== 'edit' && cropMode) { cropMode = false; draw2d(); }
  panel.scrollTop = 0;
  syncAll();
}
function setView(v) {
  view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#view3d').classList.toggle('hidden', v !== '3d');
  $('#view2d').classList.toggle('hidden', v !== '2d');
  document.querySelector('.tools-3d').classList.toggle('hidden', v !== '3d');
  document.querySelector('.tools-2d').classList.toggle('hidden', v !== '2d');
  $('#dims').classList.toggle('hidden', v !== '3d');
  stage.classList.toggle('backlit', v === '3d' && state.lighting === 'back' && tab !== 'pop');
  if (v === '2d') draw2d();
  else viewer.resize();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

// toolbar
const toolState = { wire: false, grid: true, spin: false };
document.querySelectorAll('.tools [data-act]').forEach((b) => {
  const act = b.dataset.act;
  if (act === 'compare') {
    const on = () => { comparing = true; draw2d(); }, off = () => { comparing = false; draw2d(); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off);
    return;
  }
  b.addEventListener('click', () => toolAction(act));
});
function toolAction(act) {
  if (act === 'fit') viewer.fit();
  else if (['front', 'iso', 'top'].includes(act)) viewer.view(act);
  else if (act === 'shot') saveScreenshot();
  else if (act in toolState) {
    toolState[act] = !toolState[act];
    document.querySelector(`.tools [data-act=${act}]`).classList.toggle('on', toolState[act]);
    if (act === 'wire') viewer.setWireframe(toolState.wire);
    if (act === 'grid') viewer.setGrid(toolState.grid);
    if (act === 'spin') viewer.setAutoRotate(toolState.spin);
  }
}

// ---------------------------------------------------------------- theme
const mq = matchMedia('(prefers-color-scheme: dark)');
let isDark = false;
function applyTheme() {
  const dark = theme === 'dark' || (theme === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  isDark = dark;
  viewer.setTheme(dark || state.lighting === 'back');
  const cs = getComputedStyle(document.documentElement);
  window.lumi?.setTitleBar({ color: cs.getPropertyValue('--bg').trim(), symbolColor: cs.getPropertyValue('--text').trim() });
  $('#themeBtn').innerHTML = icons[theme === 'system' ? 'monitor' : theme === 'dark' ? 'moon' : 'sun'];
  $('#themeBtn').title = `Theme: ${theme} (click to change)`;
}
$('#themeBtn').addEventListener('click', () => {
  theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  store.set('lumi.theme', theme);
  applyTheme();
  toast(`Theme: ${theme}`);
});
mq.addEventListener('change', applyTheme);

// ---------------------------------------------------------------- image loading
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That doesn’t look like an image'); return; }
  try {
    const bmp = await createImageBitmap(file);
    loadSource(bmp, file.name.replace(/\.[^.]+$/, ''));
  } catch (e) { toast('Could not open image: ' + e.message); }
}

function loadSource(src, name) {
  source = src; sourceName = name || 'lithophane';
  oriented = null;
  state.cropRect = null;
  if (!state.fileName || state.fileName === store.get('lumi.autoname', '')) { state.fileName = sourceName; store.set('lumi.autoname', sourceName); }
  panes.image.form.refreshSource();
  firstMesh = true;
  scheduleImage(0);
  syncAll();
}

$('#fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('#presetInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    Object.assign(state, pick(data.settings || data, Object.keys(DEFAULTS)));
    oriented = null;
    afterChange(new Set(Object.keys(DEFAULTS)));
    toast('Settings loaded');
  } catch { toast('Not a valid Lumi settings file'); }
});

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (type) { const blob = await it.getType(type); loadSource(await createImageBitmap(blob), 'pasted'); return; }
    }
    toast('No image on the clipboard');
  } catch { toast('No image on the clipboard'); }
}
document.addEventListener('paste', (e) => {
  if (e.target.matches('input, textarea')) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); createImageBitmap(item.getAsFile()).then((b) => loadSource(b, 'pasted')); }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').classList.remove('hidden'); });
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('#drop').classList.add('hidden');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// ---------------------------------------------------------------- processing pipeline
let imageTimer = null;
function scheduleImage(delay = 60) {
  clearTimeout(imageTimer);
  imageTimer = setTimeout(runImage, delay);
}
function runImage() {
  if (!source) return;
  if (!oriented) oriented = orient(source, state);
  processed = process(oriented, state);
  enforceAspect('width');
  if (typeof markPopStale === 'function') markPopStale();
  panes.edit.form.drawHist();
  if (view === '2d') draw2d();
  syncAll();
  scheduleMesh(0);
}

// ---------------------------------------------------------------- mesh worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let busy = false, pending = false, buildId = 0, meshTimer = null, firstMesh = true, lastStats = null, lastExport = null, previewDirty = false;

function scheduleMesh(delay = 140) {
  if (!state.autoUpdate) { previewDirty = true; updateStatus(); return; }
  clearTimeout(meshTimer);
  meshTimer = setTimeout(buildPreview, delay);
}

function buildPreview() {
  if (!processed) return;
  if (busy) { pending = true; return; }
  busy = true; pending = false; previewDirty = false;
  $('#busy').classList.remove('hidden');
  const L = computeLayout(state, 'preview');
  const gray = sampleGrid(processed.canvas, L.imgCols, L.imgRows);
  worker.postMessage({ type: 'build', id: ++buildId, settings: { ...state }, gray }, [gray.buffer]);
}

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'mesh') {
    viewer.setMesh(m, firstMesh);
    firstMesh = false;
    lastStats = m.stats;
    applyLighting();
    $('#dims').textContent = `${m.stats.size[0].toFixed(1)} × ${m.stats.size[1].toFixed(1)} × ${m.stats.size[2].toFixed(1)} mm`;
  } else if (m.type === 'error') {
    console.error(m.message);
    toast('Preview failed: ' + m.message.split('\n')[0]);
  }
  busy = false;
  $('#busy').classList.add('hidden');
  syncAll();
  if (pending) buildPreview();
};

function applyLighting() {
  viewer.setLighting({
    mode: state.lighting, lightColor: state.lightColor, materialColor: state.materialColor,
    intensityMin: state.intensityMin, intensityMax: state.intensityMax,
    tmin: state.minThick, tmax: Math.max(state.maxThick, state.minThick + 0.01), attenuation: state.attenuation,
  });
  stage.classList.toggle('backlit', view === '3d' && state.lighting === 'back' && tab !== 'pop');
  const gridDark = isDark || state.lighting === 'back';
  if (viewer.dark !== gridDark) viewer.setTheme(gridDark);
}

// ---------------------------------------------------------------- 2D view + crop tool
let comparing = false;
let dispScale = 1;
let dragCrop = null; // live crop during drag (normalized)

function draw2d() {
  if (!source) return;
  if (tab === 'pop') { drawPop2d(); return; }
  if (!oriented) oriented = orient(source, state);
  const showFull = cropMode || comparing;
  const img = showFull ? oriented : processed?.canvas;
  if (!img) return;
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  dispScale = k;
  canvas2d.width = Math.round(img.width * k);
  canvas2d.height = Math.round(img.height * k);
  const g = canvas2d.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, canvas2d.width, canvas2d.height);
  if (comparing && !cropMode && state.cropRect) {
    // show crop region outline on the original
    const r = state.cropRect;
    g.strokeStyle = '#ff7a3d'; g.lineWidth = 2;
    g.strokeRect(r.x * canvas2d.width, r.y * canvas2d.height, r.w * canvas2d.width, r.h * canvas2d.height);
  }
  if (cropMode) {
    const r = dragCrop || state.cropRect || { x: 0, y: 0, w: 1, h: 1 };
    const W = canvas2d.width, H = canvas2d.height;
    const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
    g.fillStyle = 'rgba(10,12,16,0.55)';
    g.beginPath(); g.rect(0, 0, W, H); g.rect(x, y, w, h); g.fill('evenodd');
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1;
    g.beginPath();
    for (const t of [1 / 3, 2 / 3]) { g.moveTo(x + w * t, y); g.lineTo(x + w * t, y + h); g.moveTo(x, y + h * t); g.lineTo(x + w, y + h * t); }
    g.stroke();
    g.fillStyle = '#ff7a3d';
    const hs = Math.max(8, W / 120);
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { g.fillRect(cx - hs / 2, cy - hs / 2, hs, hs); }
  }
}

function toggleCrop() {
  cropMode = !cropMode;
  if (cropMode) setView('2d');
  draw2d(); syncAll();
}

function cropRatio() {
  // returns normalized w/h ratio constraint or null
  const a = state.cropAspect;
  if (a === 'free') return null;
  let r;
  if (a === 'original') r = source.width / source.height;
  else if (a === 'model') r = surfaceWidth(state) / state.height;
  else r = parseFloat(a);
  if (state.rotate % 180 !== 0 && a === 'original') r = 1 / r;
  return r * (oriented.height / oriented.width); // convert pixel ratio to normalized ratio
}

canvas2d.addEventListener('pointerdown', (e) => {
  if (!cropMode) return;
  canvas2d.setPointerCapture(e.pointerId);
  const p = normPoint(e);
  const r = state.cropRect || { x: 0, y: 0, w: 1, h: 1 };
  const tol = 0.03;
  const corners = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] };
  let mode = 'new';
  for (const [k, [cx, cy]] of Object.entries(corners)) if (Math.abs(p.x - cx) < tol && Math.abs(p.y - cy) < tol) mode = k;
  if (mode === 'new' && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h && state.cropRect) mode = 'move';
  dragCrop = { ...r };
  canvas2d._drag = { mode, start: p, orig: { ...r } };
});
canvas2d.addEventListener('pointermove', (e) => {
  const d = canvas2d._drag;
  if (!cropMode || !d) return;
  const p = normPoint(e);
  const o = d.orig;
  let r;
  if (d.mode === 'move') {
    r = { ...o, x: clamp(o.x + p.x - d.start.x, 0, 1 - o.w), y: clamp(o.y + p.y - d.start.y, 0, 1 - o.h) };
  } else {
    // anchor = opposite corner
    let ax, ay;
    if (d.mode === 'new') { ax = d.start.x; ay = d.start.y; }
    else { ax = d.mode.includes('w') ? o.x + o.w : o.x; ay = d.mode.includes('n') ? o.y + o.h : o.y; }
    let w = p.x - ax, h = p.y - ay;
    const ratio = cropRatio();
    if (ratio) {
      if (Math.abs(w) / ratio > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ratio;
      else w = Math.sign(w || 1) * Math.abs(h) * ratio;
    }
    let x = Math.min(ax, ax + w), y = Math.min(ay, ay + h);
    w = Math.abs(w); h = Math.abs(h);
    // keep inside
    if (x < 0) { if (ratio) { h *= (w + x) / w; } w += x; x = 0; }
    if (y < 0) { if (ratio) { w *= (h + y) / h; } h += y; y = 0; }
    if (x + w > 1) { const nw = 1 - x; if (ratio) h *= nw / w; w = nw; }
    if (y + h > 1) { const nh = 1 - y; if (ratio) w *= nh / h; h = nh; }
    r = { x, y, w, h };
  }
  dragCrop = r;
  draw2d();
});
canvas2d.addEventListener('pointerup', () => {
  const d = canvas2d._drag;
  canvas2d._drag = null;
  if (!d || !dragCrop) return;
  const r = dragCrop; dragCrop = null;
  if (r.w > 0.02 && r.h > 0.02) setValue('cropRect', r);
  draw2d();
});
function normPoint(e) {
  const b = canvas2d.getBoundingClientRect();
  return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- export
let exportWorker = null;

async function doExport() {
  if (!processed) { toast('Load an image first'); return; }
  const fmt = { stl: ['STL', 'stl'], 'stl-ascii': ['STL', 'stl'], '3mf': ['3MF', '3mf'], obj: ['OBJ', 'obj'], ply: ['PLY', 'ply'] }[state.format];
  const base = (state.fileName || sourceName || 'lithophane').replace(/[\\/:*?"<>|]+/g, '_');
  const name = `${base}.${fmt[1]}`;
  let filePath = null;
  if (window.lumi) {
    filePath = await window.lumi.pickSavePath({ defaultName: name, filters: [{ name: fmt[0], extensions: [fmt[1]] }] });
    if (!filePath) return;
  }
  const modal = $('#modal');
  modal.classList.remove('hidden');
  $('#modalTitle').textContent = `Exporting ${name}`;
  $('#modalStage').textContent = 'Preparing image…';
  $('#modalBar').style.width = '2%';
  $('#modalExtra').textContent = '';
  await new Promise((r) => setTimeout(r, 30));

  const L = computeLayout(state, 'export');
  const gray = sampleGrid(processed.canvas, L.imgCols, L.imgRows);
  exportWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  exportTarget = { filePath, name, t0: performance.now() };
  exportWorker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') exportProgress(m);
    else if (m.type === 'file') exportDone(m);
    else if (m.type === 'error') {
      console.error(m.message);
      toast('Export failed: ' + m.message.split('\n')[0]);
      closeExport();
    }
  };
  const thumb = await exportThumbnail();
  exportWorker.postMessage({ type: 'export', settings: { ...state }, gray, name: base, thumb }, [gray.buffer]);
}

let exportTarget = null;
function exportProgress(m) {
  $('#modalStage').textContent = m.stage + '…';
  $('#modalBar').style.width = `${Math.round(m.p * 100)}%`;
  if (m.extra?.tris) $('#modalExtra').textContent = `${fmtCount(m.extra.tris)} triangles`;
}
async function exportDone(m) {
  const { filePath, name, t0 } = exportTarget;
  $('#modalBar').style.width = '100%';
  $('#modalStage').textContent = 'Saving…';
  try {
    if (window.lumi) await window.lumi.writeFile(filePath, m.data);
    else downloadBlob(new Blob([m.data]), name);
    if (!exportTarget.pop) lastExport = m.stats;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    toast(`Saved ${name} · ${fmtCount(m.stats.triangles)} triangles · ${fmtBytes(m.stats.bytes)} · ${secs}s`, filePath);
  } catch (err) { toast('Save failed: ' + err.message); }
  closeExport();
  syncAll();
}
function closeExport() {
  exportWorker?.terminate(); exportWorker = null;
  $('#modal').classList.add('hidden');
}
function cancelExport() {
  if (exportTarget?.pop && popWorker) {
    // the Pop worker holds the model: restart it and rebuild from the cached source
    popWorker.terminate(); popWorker = null; popWorkerBusy = false;
    if (popSource?.kind === 'depth') buildPopDepth(); else if (popSource) loadPopMesh();
  }
  closeExport();
}
$('#modalCancel').addEventListener('click', () => { cancelExport(); toast('Export cancelled'); });

async function saveBytes(bytes, name, filterName, ext) {
  if (window.lumi) {
    const p = await window.lumi.saveFile({ defaultName: name, filters: [{ name: filterName, extensions: [ext] }], data: bytes });
    if (p) toast(`Saved ${name}`, p);
  } else downloadBlob(new Blob([bytes]), name);
}
function downloadBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function dataUrlBytes(url) { return new Uint8Array(await (await fetch(url)).arrayBuffer()); }

// 3MF files carry a preview image so Windows Explorer and slicers can show a thumbnail
async function exportThumbnail() {
  if (state.format !== '3mf') return null;
  try {
    const url = viewer.thumbnail(512);
    return url ? await dataUrlBytes(url) : null;
  } catch (e) {
    console.warn('thumbnail failed', e);
    return null;
  }
}

async function exportHeightmap() {
  if (!processed) return;
  const bytes = await dataUrlBytes(processed.canvas.toDataURL('image/png'));
  saveBytes(bytes, `${state.fileName || sourceName}-heightmap.png`, 'PNG image', 'png');
}
async function saveScreenshot() {
  const bytes = await dataUrlBytes(viewer.screenshot());
  saveBytes(bytes, `${state.fileName || sourceName}-preview.png`, 'PNG image', 'png');
}
function saveProject() {
  const data = { app: 'Lumi', version: 1, settings: state };
  saveBytes(new TextEncoder().encode(JSON.stringify(data, null, 2)), `${state.fileName || 'lumi'}-settings.json`, 'Lumi settings', 'json');
}

// ---------------------------------------------------------------- status / toast
function fmtCount(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n); }
function fmtBytes(b) { return b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB'; }

function updateStatus() {
  const st = $('#status');
  if (tab === 'pop' && typeof popStatusBar === 'function') { st.replaceChildren(...popStatusBar()); return; }
  const s = lastStats;
  st.replaceChildren(...[
    el('span', {}, 'Preview ', el('b', {}, s ? fmtCount(s.triangles) : '—'), ' tris'),
    el('span', {}, s ? `built in ${Math.round(s.ms)} ms` : ''),
    previewDirty ? el('span', { class: 'pill' }, 'Preview out of date — press Update') : null,
    el('span', {}, 'Export ', el('b', {}, `${state.mmpp} mm/px`), ' · ', state.format.toUpperCase().replace('-ASCII', ' ascii')),
    el('span', { class: 'right' }, source ? `${sourceName} · ${source.width}×${source.height}` : 'No image'),
  ].filter(Boolean));
}

let toastTimer = null;
function toast(msg, path) {
  const t = $('#toast');
  t.replaceChildren(...[el('span', {}, msg), path && window.lumi ? el('a', { onclick: () => window.lumi.showInFolder(path) }, 'Show in folder') : null].filter(Boolean));
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), path ? 6000 : 2400);
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input[type=text], input[type=number], textarea');
  if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); doExport(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (e.ctrlKey && ['1', '2', '3', '4', '5'].includes(e.key)) { e.preventDefault(); setTab(['image', 'edit', 'model', 'export', 'pop'][+e.key - 1]); return; }
  if (typing || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && cropMode) toggleCrop();
  if (view !== '3d') return;
  if (k === 'f') toolAction('fit');
  else if (k === '1') toolAction('front');
  else if (k === '2') toolAction('iso');
  else if (k === '3') toolAction('top');
  else if (k === 'w') toolAction('wire');
  else if (k === 'g') toolAction('grid');
  else if (k === 'r') toolAction('spin');
});

// ---------------------------------------------------------------- boot
applyTheme();
setTab('image');
setView('3d');
loadSource(demoImage(), 'lumi-demo');
