// Full 3D from one photo with Lumi's local GPU pipeline (Pop 3D → Full 3D, Hunyuan3D-2), then
// Lumi's own repair/flat-base/optimise step, exactly like the Pop 3D tab. Needs the local AI
// runtime installed from the app first.
// Usage: electron build/render/make-3d.js <image> <out-prefix>   → <out-prefix>.glb and .stl
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [img, prefix] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('make-3d.js') && a !== '.');
const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app.js'), 'utf8');
const DEFAULTS = Function(`return ${appSrc.match(/const DEFAULTS = (\{[\s\S]*?\n\});/)[1]}`)();

app.whenReady().then(async () => {
  try {
    const local3d = require('../../local3d.js');
    const st = await local3d.status();
    if (!st.installed) throw new Error('Local 3D runtime is not installed (install it from the Pop 3D tab).');
    console.log('GPU:', st.gpu?.name);
    let last = '';
    const r = await local3d.generate(
      { image: fs.readFileSync(img), options: { localModel: 'standard', steps: 50, octree: 384, seed: 1234 } },
      (s) => { const m = s.message || s.stage; if (m && m.replace(/\d+s$/, '') !== last) { last = m.replace(/\d+s$/, ''); console.log(' ', m); } },
    );
    fs.writeFileSync(prefix + '.glb', Buffer.from(r.data));
    console.log(`generated ${prefix}.glb in ${r.seconds.toFixed(0)} s (${r.faces} faces)`);
    local3d.stop();

    // repair + flat base + scale + optimise with the same worker code the app uses
    const win = new BrowserWindow({ show: false });
    await win.loadFile(path.join(__dirname, 'make-stl.html'));
    for (let i = 0; i < 100 && win.webContents.getTitle() !== 'ready'; i++) await new Promise((res) => setTimeout(res, 50));
    const settings = { ...DEFAULTS, popHeight: 90 };
    const out = await win.webContents.executeJavaScript(`popSTL(new Uint8Array(${JSON.stringify(Array.from(r.data))}), ${JSON.stringify(settings)})`);
    fs.writeFileSync(prefix + '.stl', Buffer.from(out.stl));
    console.log(`wrote ${prefix}.stl: ${out.tris} triangles, size ${out.size.map((v) => v.toFixed(1)).join(' x ')} mm`);
  } catch (e) {
    console.error('failed:', e.message);
    process.exitCode = 1;
  }
  app.quit();
});
