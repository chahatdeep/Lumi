// Hugging Face Spaces bridge (runs in the Electron main process).
// Each engine knows how to call its Space and where the output file is in the result.
const zlib = require('zlib');

let clientMod = null;
async function gradio() {
  if (!clientMod) {
    // Electron's bundled Node fetch suffers intermittent ECONNRESETs against huggingface.co;
    // Chromium's network stack (net.fetch) is reliable and honours system proxy settings.
    try {
      const { net } = require('electron');
      if (net?.fetch) {
        const nodeFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          for (let attempt = 0; ; attempt++) {
            try {
              // net.fetch can't send multipart FormData bodies; use Node's fetch for uploads
              if (init?.body instanceof FormData) return await nodeFetch(input, init);
              return await net.fetch(typeof input === 'string' || input instanceof URL ? String(input) : input, init);
            } catch (e) {
              if (attempt >= 3) throw e;
              await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
          }
        };
      }
    } catch {}
    clientMod = await import('@gradio/client');
  }
  return clientMod;
}

const pickUrl = (x) => (x && (x.value?.url || x.url || x.image?.url)) || null;

const ENGINES = {
  hunyuan2: {
    space: 'tencent/Hunyuan3D-2', label: 'Hunyuan3D-2',
    async run(c, img, o, call) {
      return call('/shape_generation', {
        caption: null, image: img, mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null,
        steps: o.steps ?? 30, guidance_scale: 5, seed: o.seed ?? 1234, octree_resolution: o.octree ?? 256,
        check_box_rembg: true, num_chunks: 8000, randomize_seed: false,
      }, (d) => pickUrl(d[0]));
    },
    ext: 'glb',
  },
  hunyuan21: {
    space: 'tencent/Hunyuan3D-2.1', label: 'Hunyuan3D-2.1',
    async run(c, img, o, call) {
      return call('/shape_generation', {
        image: img, mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null,
        steps: o.steps ?? 30, guidance_scale: 5, seed: o.seed ?? 1234, octree_resolution: o.octree ?? 256,
        check_box_rembg: true, num_chunks: 8000, randomize_seed: false,
      }, (d) => pickUrl(d[0]));
    },
    ext: 'glb',
  },
  trellis: {
    space: 'trellis-community/TRELLIS', label: 'TRELLIS',
    async run(c, img, o, call) {
      try { await c.predict('/start_session', {}); } catch {}
      // same flow as the web UI: background removal / centring first, then generation
      const pre = await call('/preprocess_image', { image: img }, (d) => d[0], 'Preparing image…');
      return call('/generate_and_extract_glb', {
        image: pre, multiimages: [], seed: o.seed ?? 0, ss_guidance_strength: 7.5, ss_sampling_steps: o.steps ?? 12,
        slat_guidance_strength: 3, slat_sampling_steps: o.steps ?? 12, multiimage_algo: 'stochastic', mesh_simplify: 0.95, texture_size: 512,
      }, (d) => pickUrl(d[2]) || pickUrl(d[1]));
    },
    ext: 'glb',
  },
  marigold: {
    space: 'prs-eth/marigold', label: 'Marigold',
    async run(c, img, o, call) {
      return call('/on_process_first', {
        image_slider: [img, null], modality_selector_left: null, modality_selector_right: null,
        param_3: 1, param_4: o.steps ?? 4, param_5: 768,
      }, (d) => {
        const gallery = d[0] || [];
        const item = gallery.find((g) => /16-bit/i.test(g.caption || '')) || gallery[2];
        return pickUrl(item);
      });
    },
    ext: 'png16',
  },
};

// Turn Gradio / ZeroGPU errors into something a person can act on.
function friendlyError(e, label, hasToken) {
  const raw = (e && (e.message || e.title || (typeof e === 'string' ? e : JSON.stringify(e)))) || 'Unknown error';
  const q = raw.match(/\((\d+)s requested vs\. (\d+)s left\)/);
  const again = raw.match(/Try again in ([\d:]+)/);
  if (/quota|ZeroGPU/i.test(raw)) {
    return `${label}: free GPU quota used up` + (q ? ` (a run needs ${q[1]} s, ${q[2]} s left)` : '') +
      (again && again[1] !== '0:00:00' ? `, resets in ${again[1]}` : '') + '.\n' +
      (hasToken ? 'Your token’s GPU time is used up for now — wait for the reset' : 'Add a free Hugging Face token below for much more GPU time') +
      (label === 'Hunyuan3D-2' ? '' : ', try Hunyuan3D-2 · fast (needs the least GPU)') +
      ', or use Depth relief (runs on your PC, no quota).';
  }
  if (/^An error occurred$/i.test(raw.trim())) return `${label}: the Space reported an internal error (often busy or out of GPU quota). Try again shortly or pick another generator.`;
  if (/sleep|paused|building|not running/i.test(raw)) return `${label}: the Space is waking up or paused — try again in a minute.`;
  return `${label}: ${raw}`;
}

async function hfRun({ engine, image, options = {}, token }, send) {
  const E = ENGINES[engine];
  if (!E) throw new Error('Unknown engine ' + engine);
  const { Client, handle_file } = await gradio();
  send({ stage: 'connecting', message: `Connecting to ${E.label}…` });
  let c;
  try { c = await Client.connect(E.space, token ? { token } : {}); }
  catch (e) { throw new Error(friendlyError(e, E.label, !!token)); }
  const img = handle_file(new Blob([Buffer.from(image)], { type: 'image/png' }));

  // predict() surfaces real errors (the streaming API silently ends on failure); show elapsed time meanwhile
  const call = async (ep, args, pick, msg = `Generating with ${E.label}…`) => {
    const t0 = Date.now();
    const tick = setInterval(() => send({ stage: 'generating', message: `${msg} ${Math.round((Date.now() - t0) / 1000)}s` }), 1000);
    send({ stage: 'generating', message: msg });
    try {
      const r = await c.predict(ep, args);
      const out = pick(r.data);
      if (!out) throw new Error('The Space returned no file');
      return out;
    } catch (e) {
      throw new Error(friendlyError(e, E.label, !!token));
    } finally { clearInterval(tick); }
  };

  const url = await E.run(c, img, options, call);
  send({ stage: 'download', message: 'Downloading result…' });
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (E.ext === 'png16') return { kind: 'depth', ...decodePNGGray(buf) };
  return { kind: 'mesh', format: E.ext, data: new Uint8Array(buf) };
}

// Minimal PNG decoder → Float32 luminance (keeps 16-bit precision).
function decodePNGGray(buf) {
  let p = 8, w = 0, h = 0, depth = 8, ctype = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; if (data[12]) throw new Error('Interlaced PNG not supported'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (channels * depth) / 8);
  const stride = Math.ceil((w * channels * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const data = new Float32Array(w * h);
  const maxv = depth === 16 ? 65535 : 255;
  for (let i = 0; i < w * h; i++) {
    const o = i * channels * (depth / 8);
    data[i] = (depth === 16 ? out.readUInt16BE(o) : out[o]) / maxv;
  }
  return { width: w, height: h, data };
}

module.exports = { hfRun, decodePNGGray };
