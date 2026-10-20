// Builds a lithophane STL from an image with Lumi's own engine, using the app's default settings.
// Usage: electron build/render/make-stl.js <image> <out.stl> [JSON settings overrides]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [img, out, over = '{}'] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('make-stl.js') && a !== '.');

// the app's DEFAULTS object, read straight from src/app.js so the result matches the app
const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app.js'), 'utf8');
const DEFAULTS = Function(`return ${appSrc.match(/const DEFAULTS = (\{[\s\S]*?\n\});/)[1]}`)();
const settings = { ...DEFAULTS, ...JSON.parse(over) };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } });
  await win.loadFile(path.join(__dirname, 'make-stl.html'));
  for (let i = 0; i < 100 && win.webContents.getTitle() !== 'ready'; i++) await new Promise((r) => setTimeout(r, 50));
  const r = await win.webContents.executeJavaScript(`makeSTL(${JSON.stringify(pathToFileURL(path.resolve(img)).href)}, ${JSON.stringify(settings)})`);
  fs.writeFileSync(out, Buffer.from(r.stl));
  console.log(`wrote ${out}: ${r.tris} triangles (raw ${r.raw}), size ${r.size.map((v) => v.toFixed(1)).join(' x ')} mm`);
  app.quit();
});
