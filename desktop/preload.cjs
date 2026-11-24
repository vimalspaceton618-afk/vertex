const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vertexReview', {
  chooseFile: () => ipcRenderer.invoke('coding:choose-file'),
  applyEdit: () => ipcRenderer.invoke('coding:apply'),
  propose: (input) => ipcRenderer.invoke('coding:propose', input),
  choose: () => ipcRenderer.invoke('review:choose'),
  refresh: () => ipcRenderer.invoke('review:refresh'),
});
