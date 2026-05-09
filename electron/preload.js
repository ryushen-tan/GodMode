const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClosePanel: (callback) => ipcRenderer.on('close-panel', (_e) => callback()),
  onGodotStatus: (callback) => ipcRenderer.on('godot-status', (_e, status) => callback(status)),
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  launchGodot: () => ipcRenderer.send('launch-godot'),
});
