const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('regionPickerAPI', {
  confirm: (dataUrl) => ipcRenderer.send('region-picker:confirm', dataUrl),
  cancel:  () => ipcRenderer.send('region-picker:cancel'),
});
