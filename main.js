const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 660,
    title: 'Lumi',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: dark ? '#0e1014' : '#f4f5f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#0e1014' : '#f4f5f9', symbolColor: dark ? '#e8eaf0' : '#1b1d24', height: 48 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  // automated visual checks: LUMI_SHOT=out.png [LUMI_SHOT_JS="..."] electron .
  if (process.env.LUMI_SHOT) {
    win.webContents.on('console-message', (_e, _lvl, msg) => console.log('[renderer]', msg));
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (process.env.LUMI_SHOT_JS) {
        try { console.log('[js]', JSON.stringify(await win.webContents.executeJavaScript(process.env.LUMI_SHOT_JS))); } catch (e) { console.log('[js error]', e.message); }
        await new Promise((r) => setTimeout(r, 2500));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.LUMI_SHOT, img.toPNG());
      app.quit();
    });
  }
}

ipcMain.handle('pick-save-path', async (_e, { defaultName, filters }) => {
  if (process.env.LUMI_SAVE_TO) return path.join(process.env.LUMI_SAVE_TO, defaultName); // automated tests only
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters,
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('write-file', async (_e, { filePath, data }) => {
  await fs.promises.writeFile(filePath, Buffer.from(data));
  return true;
});

ipcMain.handle('save-file', async (_e, { defaultName, filters, data }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters,
  });
  if (r.canceled) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.handle('hf-run', async (e, req) => {
  const { hfRun } = require('./hf.js');
  try {
    return await hfRun(req, (status) => { try { e.sender.send('hf-status', status); } catch {} });
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
});

// ---- local GPU 3D (Hunyuan3D-2 via a managed Python runtime)
const local3d = () => require('./local3d.js');
const relay = (e) => (st) => { try { e.sender.send('hf-status', st); } catch {} };
ipcMain.handle('local3d-status', async () => local3d().status());
ipcMain.handle('local3d-install', async (e) => {
  try { return await local3d().install(relay(e)); } catch (err) { return { error: String(err && err.message || err) }; }
});
ipcMain.handle('local3d-run', async (e, req) => {
  try { return await local3d().generate(req, relay(e)); } catch (err) { return { error: String(err && err.message || err) }; }
});
ipcMain.handle('local3d-uninstall', async () => local3d().uninstall());
app.on('before-quit', () => { try { require('./local3d.js').stop(); } catch {} });

ipcMain.handle('read-file', async (_e, filePath) => new Uint8Array(await fs.promises.readFile(filePath)));

ipcMain.on('set-titlebar', (_e, { color, symbolColor }) => {
  try { win.setTitleBarOverlay({ color, symbolColor, height: 48 }); } catch {}
});

ipcMain.on('show-in-folder', (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
