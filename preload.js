// Pencereye yalnızca gereken köprüyü açar (güvenli: Node erişimi yok)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('isikNet', {
  setLang: l => ipcRenderer.send('set-lang', l),
  start: o => ipcRenderer.invoke('net-start', o),
  stop: () => ipcRenderer.invoke('net-stop'),
  onDMX: cb => { ipcRenderer.removeAllListeners('dmx'); ipcRenderer.on('dmx', (e, d) => cb(d)); },
  onStatus: cb => { ipcRenderer.removeAllListeners('net-status'); ipcRenderer.on('net-status', (e, s) => cb(s)); },
  update: {
    check: () => ipcRenderer.invoke('update-check'),
    install: () => ipcRenderer.invoke('update-install'),
    open: url => ipcRenderer.invoke('update-open', url),
    on: cb => { ipcRenderer.removeAllListeners('update'); ipcRenderer.on('update', (e, d) => cb(d)); }
  },
  gdtf: {
    login: (user, password) => ipcRenderer.invoke('gdtf-login', { user, password }),
    list: () => ipcRenderer.invoke('gdtf-list'),
    download: rid => ipcRenderer.invoke('gdtf-download', rid)
  }
});
