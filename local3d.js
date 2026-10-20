// Local GPU image→3D (Hunyuan3D-2 shape model) managed from the Electron main process.
// Installs an isolated Python runtime with uv into %LOCALAPPDATA%\Lumi-AI and keeps a
// worker process alive so the model stays loaded on the GPU between runs.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Lumi-AI');
const UV = path.join(ROOT, 'uv', 'uv.exe');
const VENV = path.join(ROOT, 'venv');
const PY = path.join(VENV, 'Scripts', 'python.exe');
const MARKER = path.join(ROOT, 'installed.json');
const SCRIPT = path.join(ROOT, 'lumi_local3d.py');
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128';
const HY3D_ZIP = 'https://github.com/Tencent/Hunyuan3D-2/archive/refs/heads/main.zip';
const DEPS = ['numpy', 'pillow', 'tqdm', 'diffusers>=0.30,<0.36', 'transformers>=4.48.0,<5', 'accelerate', 'einops', 'omegaconf', 'safetensors', 'huggingface_hub',
  'opencv-python-headless', 'scikit-image', 'trimesh', 'pymeshlab', 'pygltflib', 'xatlas', 'rembg', 'onnxruntime'];

const env = () => ({
  ...process.env,
  UV_CACHE_DIR: path.join(ROOT, 'uv-cache'),
  UV_PYTHON_INSTALL_DIR: path.join(ROOT, 'python'),
  HF_HOME: path.join(ROOT, 'hf'),
  HY3DGEN_MODELS: path.join(ROOT, 'models'),
  HF_HUB_DOWNLOAD_TIMEOUT: '60',
  HF_HUB_ETAG_TIMEOUT: '30',
  U2NET_HOME: path.join(ROOT, 'u2net'),
  PYTHONIOENCODING: 'utf-8',
  PYTHONUNBUFFERED: '1',
  HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
});

function httpFetch() {
  try { const { net } = require('electron'); if (net?.fetch) return net.fetch.bind(net); } catch {}
  return globalThis.fetch;
}

function gpuInfo() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true }, (err, out) => {
      if (err || !out.trim()) return resolve(null);
      const [name, mem] = out.trim().split('\n')[0].split(',').map((s) => s.trim());
      resolve({ name, vramGB: Math.round(+mem / 1024) });
    });
  });
}

async function status() {
  const gpu = await gpuInfo();
  let installed = false, info = null;
  try { info = JSON.parse(fs.readFileSync(MARKER, 'utf8')); installed = fs.existsSync(PY); } catch {}
  return { gpu, installed, info, root: ROOT, running: !!server };
}

function run(cmd, args, send, label) {
  return new Promise((resolve, reject) => {
    send({ stage: 'install', message: label });
    const p = spawn(cmd, args, { env: env(), windowsHide: true });
    let tail = '';
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      for (const line of s.split(/\r?\n|\r/)) if (line.trim()) send({ stage: 'install', message: label, log: line.trim().slice(0, 200) });
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code})\n${tail.slice(-1500)}`))));
  });
}

async function install(send) {
  const gpu = await gpuInfo();
  if (!gpu) throw new Error('No NVIDIA GPU found (nvidia-smi not available).');
  fs.mkdirSync(path.join(ROOT, 'uv'), { recursive: true });
  if (!fs.existsSync(UV)) {
    send({ stage: 'install', message: 'Downloading uv (Python manager)…', p: 0.02 });
    const res = await httpFetch()('https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip');
    if (!res.ok) throw new Error('Could not download uv: HTTP ' + res.status);
    const zip = path.join(ROOT, 'uv.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    try {
      await run(winTar, ['-xf', zip, '-C', path.join(ROOT, 'uv')], send, 'Unpacking uv…');
    } catch {
      await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${path.join(ROOT, 'uv')}'`], send, 'Unpacking uv…');
    }
    fs.rmSync(zip, { force: true });
  }
  send({ stage: 'install', message: 'Installing Python 3.11…', p: 0.08 });
  // uv sometimes fails to create its "minor version" junction in a custom dir even though Python installed fine
  try { await run(UV, ['python', 'install', '3.11'], send, 'Installing Python 3.11…'); } catch (e) { send({ stage: 'install', message: 'Installing Python 3.11…', log: 'note: ' + e.message.split('\n').pop() }); }
  if (!fs.existsSync(PY)) {
    // point the venv straight at Lumi's own interpreter so it never depends on a system Python
    const pyRoot = path.join(ROOT, 'python');
    const own = fs.existsSync(pyRoot) && fs.readdirSync(pyRoot)
      .filter((d) => /^cpython-3\.11\.\d+-windows/.test(d)).sort().reverse()
      .map((d) => path.join(pyRoot, d, 'python.exe')).find((p) => fs.existsSync(p));
    if (own) await run(UV, ['venv', VENV, '--python', own], send, 'Creating environment…');
    else await run(UV, ['venv', VENV, '--python', '3.11'], send, 'Creating environment…');
  }
  send({ stage: 'install', message: 'Installing PyTorch with CUDA (≈3 GB)…', p: 0.15 });
  await run(UV, ['pip', 'install', '--python', PY, 'torch', 'torchvision', '--index-url', TORCH_INDEX], send, 'Installing PyTorch with CUDA (≈3 GB)…');
  send({ stage: 'install', message: 'Installing Hunyuan3D-2 and helpers…', p: 0.6 });
  await run(UV, ['pip', 'install', '--python', PY, ...DEPS], send, 'Installing helpers…');
  await run(UV, ['pip', 'install', '--python', PY, '--no-deps', HY3D_ZIP], send, 'Installing Hunyuan3D-2…');
  send({ stage: 'install', message: 'Checking the GPU from Python…', p: 0.9 });
  writeScript();
  await run(PY, ['-c', 'import torch, hy3dgen.shapegen; assert torch.cuda.is_available(), "CUDA not available"; x = torch.ones(8, device="cuda") * 2; print("cuda ok", torch.__version__, torch.cuda.get_device_name(0), x.sum().item())'], send, 'Checking the GPU from Python…');
  fs.writeFileSync(MARKER, JSON.stringify({ date: new Date().toISOString(), gpu }, null, 2));
  send({ stage: 'install', message: 'Local 3D is ready', p: 1 });
  return status();
}

function writeScript() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(SCRIPT, fs.readFileSync(path.join(__dirname, 'python', 'lumi_local3d.py')));
}

// ---- model download through Chromium's network stack (resumable, retried)
const MODEL_REPOS = {
  standard: ['tencent/Hunyuan3D-2', 'hunyuan3d-dit-v2-0'],
  turbo: ['tencent/Hunyuan3D-2', 'hunyuan3d-dit-v2-0-turbo'],
  mini: ['tencent/Hunyuan3D-2mini', 'hunyuan3d-dit-v2-mini-turbo'],
};

async function fetchRetry(url, init = {}, tries = 12) {
  const f = httpFetch();
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await f(url, init);
      if (r.ok || r.status === 206 || r.status === 416) return r;
      if (r.status === 404 || r.status === 401) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { fatal: true });
      last = new Error(`HTTP ${r.status}`);
    } catch (e) { if (e.fatal) throw e; last = e; }
    await new Promise((r) => setTimeout(r, Math.min(15000, 800 * (i + 1))));
  }
  throw last;
}

async function downloadModel(key, send) {
  const [repo, sub] = MODEL_REPOS[key];
  const dir = path.join(ROOT, 'models', repo, sub);
  const done = path.join(dir, '.lumi-complete');
  if (fs.existsSync(done)) return;
  fs.mkdirSync(dir, { recursive: true });
  const list = await (await fetchRetry(`https://huggingface.co/api/models/${repo}/tree/main/${sub}`)).json();
  let files = list.filter((x) => x.type === 'file');
  // safetensors + config are all that's needed (skip duplicate .ckpt weights)
  if (files.some((x) => x.path.endsWith('.safetensors'))) files = files.filter((x) => !/\.(ckpt|bin|pth)$/.test(x.path));
  const total = files.reduce((a, x) => a + (x.lfs?.size || x.size || 0), 0);
  let have = 0;
  for (const file of files) {
    const size = file.lfs?.size || file.size || 0;
    const dest = path.join(dir, path.basename(file.path));
    let got = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    for (let attempt = 0; got < size || (size === 0 && !fs.existsSync(dest)); attempt++) {
      if (attempt > 25) throw new Error(`Download of ${file.path} keeps failing — check your internet connection and try again (it resumes).`);
      try {
        const res = await fetchRetry(`https://huggingface.co/${repo}/resolve/main/${file.path}`, got ? { headers: { Range: `bytes=${got}-` } } : {});
        if (got && res.status !== 206) got = 0; // server ignored the range: start over
        const out = fs.createWriteStream(dest, { flags: got ? 'a' : 'w' });
        const reader = res.body.getReader();
        let lastSend = 0;
        try {
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
            got += value.length;
            if (Date.now() - lastSend > 500) {
              lastSend = Date.now();
              const pct = total ? Math.round(((have + got) / total) * 100) : 0;
              send({ stage: 'local', message: `Downloading ${key} model (first run only): ${pct}% of ${(total / 1e9).toFixed(1)} GB` });
            }
          }
        } finally { await new Promise((r) => out.end(r)); }
      } catch (e) {
        got = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
        send({ stage: 'local', message: 'Connection dropped — resuming download…' });
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (size === 0) break;
    }
    have += size;
  }
  fs.writeFileSync(done, new Date().toISOString());
}

// ---- persistent worker process (JSON lines protocol)
let server = null;
let pending = null;

function startServer() {
  if (server) return server;
  writeScript();
  const p = spawn(PY, ['-u', SCRIPT], { env: env(), windowsHide: true, cwd: ROOT });
  server = p;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (!pending) continue;
      if (msg.type === 'status') { pending.phase = msg.message; pending.pct = null; pending.send({ stage: 'local', message: msg.message }); }
      else if (msg.type === 'done') { const p2 = pending; pending = null; p2.resolve(msg); }
      else if (msg.type === 'error') { const p2 = pending; pending = null; p2.reject(new Error(msg.message + (msg.trace ? '\n' + msg.trace : ''))); }
    }
  });
  p.stderr.on('data', (d) => {
    const s = d.toString();
    if (!pending) return;
    // tqdm progress lines → percentage
    const m = [...s.matchAll(/(\d{1,3})%\|/g)].pop();
    if (/Fetching|Downloading|\.safetensors|\.ckpt|model\.fp16/.test(s)) pending.phase = 'Downloading model (first run only, a few GB)…';
    if (m) pending.pct = m[1];
  });
  p.on('close', (code) => {
    server = null;
    if (pending) { const p2 = pending; pending = null; p2.reject(new Error(`Local 3D worker stopped (exit ${code}). Try again — if it keeps failing, reinstall Local 3D.`)); }
  });
  return p;
}

async function generate({ image, options = {} }, send) {
  if (!fs.existsSync(PY)) throw new Error('Local 3D is not installed yet.');
  if (pending) throw new Error('Local 3D is already working on a model.');
  const tmp = path.join(ROOT, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const inPath = path.join(tmp, 'input.png'), outPath = path.join(tmp, `out-${Date.now()}.glb`);
  fs.writeFileSync(inPath, Buffer.from(image));
  await downloadModel(options.localModel || 'turbo', send);
  const p = startServer();
  const t0 = Date.now();
  const result = await new Promise((resolve, reject) => {
    pending = { resolve, reject, send, phase: 'Generating' };
    const tick = setInterval(() => pending && send({ stage: 'local', message: `${pending.phase}${pending.pct ? ' ' + pending.pct + '%' : ''} · ${Math.round((Date.now() - t0) / 1000)}s` }), 1000);
    const done = (fn) => (v) => { clearInterval(tick); fn(v); };
    pending.resolve = done(resolve); pending.reject = done(reject);
    p.stdin.write(JSON.stringify({
      cmd: 'generate', image: inPath, out: outPath,
      model: options.localModel || 'turbo', steps: options.steps ?? 30, octree: options.octree ?? 256,
      seed: options.seed ?? 1234, rembg: options.rembg !== false,
    }) + '\n');
  });
  const data = new Uint8Array(fs.readFileSync(outPath));
  fs.rmSync(outPath, { force: true });
  return { kind: 'mesh', format: 'glb', data, seconds: (Date.now() - t0) / 1000, faces: result.faces };
}

function stop() { try { server?.kill(); } catch {} server = null; }

async function uninstall() {
  stop();
  fs.rmSync(ROOT, { recursive: true, force: true });
  return status();
}

module.exports = { status, install, generate, stop, uninstall, ROOT };
