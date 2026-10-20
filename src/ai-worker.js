// Local, in-app AI: monocular depth (Depth Anything V2 Small) and background removal (RMBG-1.4).
// Models are downloaded once from Hugging Face and cached by the browser cache.
import { pipeline, env, RawImage, AutoModel, AutoProcessor } from './vendor/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;

const MODELS = {
  depth: { task: 'depth-estimation', id: 'onnx-community/depth-anything-v2-small' },
  depthBase: { task: 'depth-estimation', id: 'onnx-community/depth-anything-v2-base' },
};
const RMBG = 'briaai/RMBG-1.4';
let rmbg = null;

// RMBG-1.4 is a custom architecture: load model + processor directly (official transformers.js recipe).
async function getRMBG(id) {
  if (rmbg) return rmbg;
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) postMessage({ type: 'progress', id, message: `Downloading cut-out model (${Math.round(p.progress)}%) — first run only`, p: p.progress / 100 });
  };
  const tries = (await hasGPU()) ? [{ device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }] : [{ device: 'wasm', dtype: 'q8' }];
  let lastErr;
  for (const opt of tries) {
    try {
      postMessage({ type: 'progress', id, message: `Loading cut-out model (${opt.device})…` });
      const model = await AutoModel.from_pretrained(RMBG, { config: { model_type: 'custom' }, ...opt, progress_callback });
      const processor = await AutoProcessor.from_pretrained(RMBG, {
        config: {
          do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5],
          feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2,
          rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 },
        },
      });
      rmbg = { model, processor, device: opt.device };
      return rmbg;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const pipes = {};
let gpuOk = null;

async function hasGPU() {
  if (gpuOk === null) {
    try { gpuOk = !!(self.navigator?.gpu && (await navigator.gpu.requestAdapter())); } catch { gpuOk = false; }
  }
  return gpuOk;
}

async function getPipe(key, id) {
  if (pipes[key]) return pipes[key];
  const m = MODELS[key];
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) postMessage({ type: 'progress', id, message: `Downloading ${p.file.split('/').pop()} (${Math.round(p.progress)}%) — first run only` , p: p.progress / 100 });
    else if (p.status === 'ready') postMessage({ type: 'progress', id, message: 'Model ready', p: 1 });
  };
  const tries = (await hasGPU()) ? [{ device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }] : [{ device: 'wasm', dtype: 'q8' }];
  let lastErr;
  for (const opt of tries) {
    try {
      postMessage({ type: 'progress', id, message: `Loading model (${opt.device})…` });
      pipes[key] = await pipeline(m.task, m.id, { ...opt, progress_callback });
      pipes[key].device = opt.device;
      return pipes[key];
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

self.onmessage = async (e) => {
  const { type, id, image, width, height } = e.data;
  try {
    const img = new RawImage(new Uint8ClampedArray(image), width, height, 4);
    if (type === 'depth') {
      const pipe = await getPipe(e.data.model || 'depth', id);
      postMessage({ type: 'progress', id, message: `Estimating depth (${pipe.device})…` });
      const out = await pipe(img);
      const t = out.predicted_depth;
      const dims = t.dims;
      const h = dims[dims.length - 2], w = dims[dims.length - 1];
      const data = Float32Array.from(t.data);
      postMessage({ type: 'depth', id, data, width: w, height: h, device: pipe.device }, [data.buffer]);
    } else if (type === 'bg') {
      const { model, processor, device } = await getRMBG(id);
      postMessage({ type: 'progress', id, message: `Removing background (${device})…` });
      const { pixel_values } = await processor(img);
      const { output } = await model({ input: pixel_values });
      const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(width, height);
      const alpha = new Uint8Array(mask.data.length / mask.channels);
      for (let i = 0; i < alpha.length; i++) alpha[i] = mask.data[i * mask.channels];
      postMessage({ type: 'bg', id, data: alpha, width: mask.width, height: mask.height }, [alpha.buffer]);
    }
  } catch (err) {
    postMessage({ type: 'error', id, message: String(err && err.message || err) });
  }
};
