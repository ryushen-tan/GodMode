const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClosePanel:         (cb) => ipcRenderer.on('close-panel',  (_e) => cb()),
  onGodotStatus:        (cb) => ipcRenderer.on('godot-status', (_e, s) => cb(s)),
  onAgentStep:          (cb) => ipcRenderer.on('agent-step',   (_e, s) => cb(s)),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  launchGodot:          () => ipcRenderer.send('launch-godot'),
  sendPrompt:           (prompt) => ipcRenderer.invoke('send-prompt', { prompt }),
});
