// Pencereye yalnızca gereken köprüyü açar (güvenli: Node erişimi yok)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('isikNet', {
  start: o => ipcRenderer.invoke('net-start', o),
  stop: () => ipcRenderer.invoke('net-stop'),
  onDMX: cb => { ipcRenderer.removeAllListeners('dmx'); ipcRenderer.on('dmx', (e, d) => cb(d)); },
  onStatus: cb => { ipcRenderer.removeAllListeners('net-status'); ipcRenderer.on('net-status', (e, s) => cb(s)); },
  gdtf: {
    login: (user, password) => ipcRenderer.invoke('gdtf-login', { user, password }),
    list: () => ipcRenderer.invoke('gdtf-list'),
    download: rid => ipcRenderer.invoke('gdtf-download', rid)
  }
});
