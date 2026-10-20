// Renders build/social-card.html to site/og-card.png (1200x630) with Electron: `npm run card`
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 630, useContentSize: true, show: false, frame: false });
  await win.loadFile(path.join(__dirname, 'social-card.html'));
  for (let i = 0; i < 50 && win.webContents.getTitle() !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 });
  const out = path.join(__dirname, '..', 'site', 'og-card.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('wrote', out, img.getSize());
  app.quit();
});
