const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onClosePanel:         (cb) => ipcRenderer.on('close-panel',  (_e) => cb()),
  onGodotStatus:        (cb) => ipcRenderer.on('godot-status', (_e, s) => cb(s)),
  onAgentStep:          (cb) => ipcRenderer.on('agent-step',   (_e, s) => cb(s)),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  launchGodot:          () => ipcRenderer.send('launch-godot'),
  launchMultiplayerDemo: () => ipcRenderer.invoke('launch-multiplayer-demo'),
  sendPrompt:           (prompt) => ipcRenderer.invoke('send-prompt', { prompt }),
  indexSprites:         (args) => ipcRenderer.invoke("assets:indexSprites", args),
  searchAsset:          (args) => ipcRenderer.invoke("assets:search", args),
  captureGameWindow:    () => ipcRenderer.invoke('capture-game-window'),
  openExternal:         (url) => ipcRenderer.send('open-external', url),
  onScreenshotCaptured: (cb) => ipcRenderer.on('screenshot-captured', (_e, dataUrl) => cb(dataUrl)),
  onScreenshotError:    (cb) => ipcRenderer.on('screenshot-error',    (_e, msg) => cb(msg)),
  onToggleTopButtons:   (cb) => ipcRenderer.on('toggle-top-buttons',  () => cb()),
});
