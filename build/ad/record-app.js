// Records the real Lumi UI for the ad: loads a photo, opens Model in the 3/4 view and steps
// through shapes (wrap-around shapes use a tiled photo), capturing timestamped frames.
// Usage: electron build/ad/record-app.js <image> <out_dir> [wrap_image for cylinder/prism]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [img, out, wrapImg] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('record-app.js') && a !== '.');
const root = path.join(__dirname, '..', '..');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({
    width: 1600, height: 1000, useContentSize: true, show: true, frame: false, backgroundColor: '#0e1014',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.removeMenu();
  await win.loadFile(path.join(root, 'src', 'index.html'));
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2000);
  // dark theme, load the photo, Model tab, auto-rotate on
  await js(`(async () => {
    localStorage.setItem('lumi.theme', JSON.stringify('dark'));
    const b = await (await fetch(${JSON.stringify(pathToFileURL(path.resolve(img)).href)})).blob();
    const dt = new DataTransfer(); dt.items.add(new File([b], 'djokovic.jpg', { type: 'image/jpeg' }));
    const i = document.getElementById('fileInput'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1500);
  await js(`document.documentElement.dataset.theme = 'dark';
    document.querySelector('[data-tab=model]').click();
    const tile = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    tile('Flat')?.click();
    const spin = document.querySelector('[data-act=spin]'); if (spin.classList.contains('on')) spin.click();
    document.querySelector('[data-act=iso]').click();
    document.getElementById('toast')?.classList.add('hidden'); 1`);
  await wait(1500);

  // shape schedule (seconds from record start)
  const plan = [[1.2, 'Curved'], [2.4, 'Cylinder'], [3.6, 'Prism']];
  const t0 = Date.now(), dur = 4800, frames = [];
  const wrapUrl = wrapImg ? pathToFileURL(path.resolve(wrapImg)).href : null;
  let n = 0;
  while (Date.now() - t0 < dur) {
    const t = (Date.now() - t0) / 1000;
    while (plan.length && t >= plan[0][0]) {
      const [, name] = plan.shift();
      const load = name === 'Cylinder' && wrapUrl ? `const b = await (await fetch(${JSON.stringify(wrapUrl)})).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'djokovic-wrap.jpg', { type: 'image/jpeg' })); const i = document.getElementById('fileInput'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));` : '';
      js(`(async () => { ${load} [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})?.click(); await new Promise((r) => setTimeout(r, 250)); document.querySelector('[data-act=iso]').click(); document.getElementById('toast')?.classList.add('hidden'); })()`);
    }
    const im = await win.webContents.capturePage();
    const f = `f${String(n++).padStart(4, '0')}.jpg`;
    fs.writeFileSync(path.join(out, f), im.toJPEG(92));
    frames.push({ f, t: (Date.now() - t0) / 1000 });
  }
  fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(frames));
  console.log(`captured ${frames.length} frames in ${(dur / 1000).toFixed(1)} s (${(frames.length / (dur / 1000)).toFixed(1)} fps)`);
  app.quit();
});
