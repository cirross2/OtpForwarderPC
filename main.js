const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { spawn, execFile } = require('child_process')
const { autoUpdater } = require('electron-updater')
const { initializeApp, cert, getApp, getApps } = require('firebase-admin/app')
const { getMessaging } = require('firebase-admin/messaging')

const PKG = 'com.boss.otpforwarder'
const RECEIVER = `${PKG}/.ControlReceiver`
const PORT_SERVER_PORT = 47800

// ---- FCM: 잠든 폰을 깨우기 ----
let fcmApp = null
let phoneToken = ''

function initFcm() {
  if (getApps().length > 0) { fcmApp = getApp(); return }
  const candidates = [
    path.join(app.getPath('userData'), 'service-account.json'),
    path.join(process.resourcesPath || '', 'service-account.json'),
    path.join(__dirname, 'service-account.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const sa = JSON.parse(fs.readFileSync(p, 'utf8'))
        fcmApp = initializeApp({ credential: cert(sa) })
        return
      }
    } catch (e) {}
  }
}

const tokenFile = () => path.join(app.getPath('userData'), 'phone-token.txt')
function loadToken() {
  try { phoneToken = fs.readFileSync(tokenFile(), 'utf8').trim() } catch (e) { phoneToken = '' }
}
function saveToken(t) {
  if (t && t !== phoneToken) {
    phoneToken = t
    try { fs.writeFileSync(tokenFile(), t) } catch (e) {}
  }
}

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
    height: 680,
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

// 주소에 포트가 없으면 기본 포트를 붙인다. 있으면 그대로(무선 디버깅 포트 지원).
function withPort(addr, def = 5555) {
  if (!addr) return null
  const a = String(addr).trim()
  if (!a) return null
  return a.includes(':') ? a : `${a}:${def}`
}

ipcMain.handle('get-devices', async (_e, ip) => {
  const target = withPort(ip)
  if (target) await adb(['connect', target])
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
  const target = withPort(ip)
  const sel = target ? ['-s', target] : []
  if (target) await adb(['connect', target])

  const sendCmd = (cmd) =>
    adb([...sel, 'shell', 'am', 'broadcast', '-n', RECEIVER, '--es', 'cmd', cmd])

  // 1) 포워딩 일시중지
  await sendCmd('pause')
  mirroring = true
  if (win) win.webContents.send('mirror-state', true)

  // 하트비트: 미러링 동안 60초마다 pause를 재전송한다.
  // PC가 죽거나 창을 닫으면 폰이 3분 뒤 자동으로 포워딩을 재개한다(안전장치).
  const heartbeat = setInterval(() => { sendCmd('pause') }, 60000)

  // 2) 미러링 (무선/원격에선 --stay-awake가 안 먹으므로 화면 꺼짐 타임아웃을 늘려 유지)
  const sc = spawn(
    SCRCPY(),
    [...sel, '--stay-awake', '--screen-off-timeout=1800', '--window-title', 'Second Phone'],
    { windowsHide: false }
  )
  // 3) 창 닫히면 포워딩 재개 (오류/강제종료에도)
  let resumed = false
  const resume = async () => {
    if (resumed) return
    resumed = true
    clearInterval(heartbeat)
    await sendCmd('resume')
    mirroring = false
    if (win && !win.isDestroyed()) win.webContents.send('mirror-state', false)
  }
  sc.on('close', resume)
  sc.on('error', resume)
  return { ok: true }
})

// PC가 꺼진 사이 포트가 바뀌어도, 폰의 고정 포트 서버(47801)에 현재 포트를 요청한다.
ipcMain.handle('request-port', async (_e, host) => {
  const h = String(host || '').trim().split(':')[0]
  if (!h) return null
  return await new Promise((resolve) => {
    const req = http.get({ host: h, port: 47801, path: '/port', timeout: 12000 }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => {
        try {
          const j = JSON.parse(b)
          if (j && j.token) saveToken(j.token)
          resolve(j)
        } catch (e) { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
})

// 잠든 폰을 FCM으로 깨운다(죽어 있어도 구글이 깨움). 토큰이 있어야 함.
ipcMain.handle('wake-phone', async () => {
  if (!fcmApp || !phoneToken) return { ok: false, reason: !fcmApp ? 'no-key' : 'no-token' }
  try {
    await getMessaging(fcmApp).send({
      token: phoneToken,
      android: { priority: 'high' },
      data: { type: 'wake' },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) }
  }
})

ipcMain.handle('fcm-status', () => ({ hasKey: !!fcmApp, hasToken: !!phoneToken }))

// FCM 서비스 계정 키(json)를 직접 골라 userData에 복사하고 초기화한다.
ipcMain.handle('pick-fcm-key', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'FCM 서비스 계정 키 선택 (service-account.json)',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true }
  try {
    const raw = fs.readFileSync(r.filePaths[0], 'utf8')
    const j = JSON.parse(raw)
    if (j.type !== 'service_account' || !j.private_key) {
      return { ok: false, msg: 'Firebase 서비스 계정 키가 아닙니다.' }
    }
    fs.writeFileSync(path.join(app.getPath('userData'), 'service-account.json'), raw)
    fcmApp = null
    initFcm()
    return { ok: !!fcmApp, hasKey: !!fcmApp }
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) }
  }
})

// 같은 WiFi면 폰이 광고하는 무선 디버깅 포트를 mDNS로 자동 감지한다.
ipcMain.handle('discover-wireless', async () => {
  const r = await adb(['mdns', 'services'])
  for (const line of r.stdout.split('\n')) {
    if (line.includes('_adb-tls-connect._tcp')) {
      const m = line.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/)
      if (m) return { ok: true, ip: m[1], port: Number(m[2]), addr: `${m[1]}:${m[2]}` }
    }
  }
  return { ok: false }
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

// 무선 모드 켜기: USB 연결된 폰에 tcpip 5555 적용 + IP 반환 (옛 방식, 폴백용)
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

// 이 PC의 Tailscale 주소(폰에 등록할 값)를 돌려준다.
ipcMain.handle('pc-address', () => {
  const ifs = os.networkInterfaces()
  for (const name in ifs) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) {
        const o = a.address.split('.').map(Number)
        if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return a.address
      }
    }
  }
  return null
})

// 폰이 재부팅 후 바뀐 무선 포트를 이 PC로 직접 쏴주는 수신 서버.
function startPortServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/port')) {
      let body = ''
      req.on('data', (c) => {
        body += c
        if (body.length > 2000) req.destroy()
      })
      req.on('end', async () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
        let ip, port, token
        try {
          const j = JSON.parse(body)
          ip = j.ip
          port = j.port
          token = j.token
        } catch (e) {}
        if (token) saveToken(token)
        if (ip && port && /^\d+\.\d+\.\d+\.\d+$/.test(String(ip))) {
          const addr = `${ip}:${port}`
          await adb(['connect', addr])
          if (win && !win.isDestroyed()) win.webContents.send('port-received', { ip, port, addr })
        }
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  server.on('error', () => {})
  server.listen(PORT_SERVER_PORT, '0.0.0.0')
}

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
  loadToken()
  initFcm()
  createWindow()
  startPortServer()
  win.webContents.once('did-finish-load', setupUpdater)
})

app.on('window-all-closed', () => app.quit())
