const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumi', {
  pickSavePath: (opts) => ipcRenderer.invoke('pick-save-path', opts),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', { filePath, data }),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  setTitleBar: (opts) => ipcRenderer.send('set-titlebar', opts),
  showInFolder: (p) => ipcRenderer.send('show-in-folder', p),
  hfRun: (req) => ipcRenderer.invoke('hf-run', req),
  local3dStatus: () => ipcRenderer.invoke('local3d-status'),
  local3dInstall: () => ipcRenderer.invoke('local3d-install'),
  local3dRun: (req) => ipcRenderer.invoke('local3d-run', req),
  local3dUninstall: () => ipcRenderer.invoke('local3d-uninstall'),
  onHfStatus: (fn) => {
    const h = (_e, s) => fn(s);
    ipcRenderer.on('hf-status', h);
    return () => ipcRenderer.removeListener('hf-status', h);
  },
});
