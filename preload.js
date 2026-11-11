const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getDevices: (ip) => ipcRenderer.invoke('get-devices', ip),
  startMirror: (ip) => ipcRenderer.invoke('start-mirror', ip),
  enableWireless: () => ipcRenderer.invoke('enable-wireless'),
  onMirrorState: (cb) => ipcRenderer.on('mirror-state', (_e, v) => cb(v)),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, v) => cb(v)),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  appVersion: () => ipcRenderer.invoke('app-version'),
})
