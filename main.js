const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { autoUpdater } = require('electron-updater')

const PKG = 'com.boss.otpforwarder'
const RECEIVER = `${PKG}/.ControlReceiver`

// 내장 scrcpy/adb 경로 (개발 vs 패키징)
function resBase() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scrcpy')
    : path.join(__dirname, 'resources', 'scrcpy')
}
const ADB = () => path.join(resBase(), 'adb.exe')
const SCRCPY = () => path.join(resBase(), 'scrcpy.exe')

let win = null
let mirroring = false

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 580,
    resizable: false,
    title: 'OTP 미러링',
    backgroundColor: '#1c1c1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

function adb(args) {
  return new Promise((resolve) => {
    execFile(ADB(), args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

ipcMain.handle('get-devices', async (_e, ip) => {
  if (ip) await adb(['connect', `${ip}:5555`])
  const r = await adb(['devices'])
  return r.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0])
})

ipcMain.handle('start-mirror', async (_e, ip) => {
  if (mirroring) return { ok: false, msg: '이미 미러링 중입니다' }
  const sel = ip ? ['-s', `${ip}:5555`] : []
  if (ip) await adb(['connect', `${ip}:5555`])

  // 1) 포워딩 일시중지
  await adb([...sel, 'shell', 'am', 'broadcast', '-n', RECEIVER, '--es', 'cmd', 'pause'])
  mirroring = true
  if (win) win.webContents.send('mirror-state', true)

  // 2) 미러링
  const sc = spawn(SCRCPY(), [...sel, '--stay-awake', '--window-title', 'Second Phone'], {
    windowsHide: false,
  })
  // 3) 창 닫히면 포워딩 재개 (오류/강제종료에도)
  const resume = async () => {
    await adb([...sel, 'shell', 'am', 'broadcast', '-n', RECEIVER, '--es', 'cmd', 'resume'])
    mirroring = false
    if (win && !win.isDestroyed()) win.webContents.send('mirror-state', false)
  }
  sc.on('close', resume)
  sc.on('error', resume)
  return { ok: true }
})

// USB 연결된 폰의 IP를 찾는다 (Tailscale 100.64~127 우선, 없으면 WiFi)
async function getPhoneIp(serial) {
  const r = await adb(['-s', serial, 'shell', 'ip', '-4', 'addr'])
  let tailscale = null, wifi = null
  for (const line of r.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/)
    const i = parts.indexOf('inet')
    if (i < 0 || !parts[i + 1]) continue
    const ip = parts[i + 1].split('/')[0]
    const iface = parts[parts.length - 1]
    const o = ip.split('.').map(Number)
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) tailscale = ip
    else if (/wlan/.test(iface)) wifi = ip
  }
  return tailscale || wifi
}

// 무선 모드 켜기: USB 연결된 폰에 tcpip 5555 적용 + IP 반환
ipcMain.handle('enable-wireless', async () => {
  const r = await adb(['devices'])
  const usb = r.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0])
    .filter((s) => !s.includes(':'))
  if (!usb.length) return { ok: false, msg: 'USB로 폰을 먼저 연결한 뒤 눌러주세요.' }
  const serial = usb[0]
  const ip = await getPhoneIp(serial)
  if (!ip) return { ok: false, msg: '폰 IP를 찾지 못했습니다. WiFi/Tailscale 연결을 확인하세요.' }
  await adb(['-s', serial, 'tcpip', '5555'])
  await new Promise((res) => setTimeout(res, 1500))
  await adb(['connect', `${ip}:5555`])
  return { ok: true, ip }
})

// ---- 자동 업데이트 ----
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

function setupUpdater() {
  const send = (v) => { if (win && !win.isDestroyed()) win.webContents.send('update', v) }
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (err) => send({ state: 'error', msg: String(err && err.message || err) }))
  try { autoUpdater.checkForUpdates() } catch (e) {}
}

ipcMain.handle('install-update', () => autoUpdater.quitAndInstall())
ipcMain.handle('check-update', () => { try { autoUpdater.checkForUpdates() } catch (e) {} })
ipcMain.handle('app-version', () => app.getVersion())

app.whenReady().then(() => {
  createWindow()
  win.webContents.once('did-finish-load', setupUpdater)
})

app.on('window-all-closed', () => app.quit())
