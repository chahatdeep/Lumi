// Copies the few runtime library files the renderer needs into src/vendor (keeps the app self-contained).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'vendor');
fs.mkdirSync(out, { recursive: true });
const files = {
  'three.module.js': 'node_modules/three/build/three.module.js',
  'OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
  'fflate.js': 'node_modules/fflate/esm/browser.js',
  'earcut.js': 'node_modules/earcut/src/earcut.js',
  'transformers.min.js': 'node_modules/@huggingface/transformers/dist/transformers.min.js',
  'ort/ort-wasm-simd-threaded.asyncify.mjs': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
  'ort/ort-wasm-simd-threaded.asyncify.wasm': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
};
fs.mkdirSync(path.join(out, 'ort'), { recursive: true });
for (const [dst, src] of Object.entries(files)) fs.copyFileSync(path.join(root, src), path.join(out, dst));
console.log('vendored:', Object.keys(files).join(', '));
