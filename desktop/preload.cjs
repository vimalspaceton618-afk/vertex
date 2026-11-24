const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vertexReview', {
  propose: (input) => ipcRenderer.invoke('coding:propose', input),
  choose: () => ipcRenderer.invoke('review:choose'),
  refresh: () => ipcRenderer.invoke('review:refresh'),
});
