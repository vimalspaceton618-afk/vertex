const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vertexReview', {
  choose: () => ipcRenderer.invoke('review:choose'),
  refresh: () => ipcRenderer.invoke('review:refresh'),
});
