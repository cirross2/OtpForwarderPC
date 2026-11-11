const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getDevices: (ip) => ipcRenderer.invoke('get-devices', ip),
  startMirror: (ip) => ipcRenderer.invoke('start-mirror', ip),
  enableWireless: () => ipcRenderer.invoke('enable-wireless'),
  discoverWireless: () => ipcRenderer.invoke('discover-wireless'),
  pcAddress: () => ipcRenderer.invoke('pc-address'),
  onPortReceived: (cb) => ipcRenderer.on('port-received', (_e, v) => cb(v)),
  onMirrorState: (cb) => ipcRenderer.on('mirror-state', (_e, v) => cb(v)),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, v) => cb(v)),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  appVersion: () => ipcRenderer.invoke('app-version'),
})
