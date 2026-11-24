const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vertexReview', {
  discover: input => ipcRenderer.invoke('agent:discover', input),
  context: names => ipcRenderer.invoke('agent:context', names),
  proposeWorkspace: input => ipcRenderer.invoke('agent:propose', input),
  applyWorkspace: () => ipcRenderer.invoke('agent:apply'),
  runTest: command => ipcRenderer.invoke('agent:test', command),
  recoveryStatus: () => ipcRenderer.invoke('agent:recovery-status'),
  recover: () => ipcRenderer.invoke('agent:recover'),
  choose: () => ipcRenderer.invoke('review:choose'),
  refresh: () => ipcRenderer.invoke('review:refresh'),
});
