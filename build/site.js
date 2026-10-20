// Assembles the GitHub Pages site into _site/: the landing page (site/) plus the lithophane
// maker, which is Lumi's own renderer (src/) running in the browser with the desktop-only
// Pop 3D tab hidden. Run `npm run vendor` first so src/vendor exists.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
const app = path.join(out, 'app');

const cp = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(root, src), dst); };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

// landing page
for (const f of fs.readdirSync(path.join(root, 'site'))) {
  if (f !== 'web.css') cp(`site/${f}`, path.join(out, f));
}
cp('build/icon.png', path.join(out, 'assets', 'icon.png'));
for (const f of fs.readdirSync(path.join(root, 'docs'))) if (f.endsWith('.png')) cp(`docs/${f}`, path.join(out, 'assets', f));

// web app: renderer modules (the AI worker is desktop-only)
for (const f of fs.readdirSync(path.join(root, 'src'))) {
  if (/\.(js|css)$/.test(f) && f !== 'ai-worker.js') cp(`src/${f}`, path.join(app, f));
}
for (const f of ['three.module.js', 'OrbitControls.js', 'fflate.js', 'earcut.js']) cp(`src/vendor/${f}`, path.join(app, 'vendor', f));
cp('build/icon.png', path.join(app, 'icon.png'));
cp('site/web.css', path.join(app, 'web.css'));

let html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const swap = (a, b) => { if (!html.includes(a)) throw new Error(`site build: "${a}" not found in src/index.html`); html = html.replace(a, b); };
swap('<title>Lumi</title>', `<title>Lumi · Lithophane Maker</title>
  <meta name="description" content="Make a 3D-printable lithophane from any photo, right in your browser. Nothing is uploaded.">
  <link rel="icon" href="icon.png">`);
swap('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="web.css">');
swap('src="../build/icon.png"', 'src="icon.png"');
swap('<div class="title-actions">', `<div class="title-actions">
      <a class="web-link" href="../" target="_top" title="About Lumi and the desktop app">About Lumi</a>`);
fs.writeFileSync(path.join(app, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log('site built:', path.relative(root, out));
