const $ = (id) => document.getElementById(id)
const dot = $('dot')
const statusTitle = $('statusTitle')
const statusAddr = $('statusAddr')
const ipEl = $('ip')
const startBtn = $('start')
const stateEl = $('state')
const refreshBtn = $('refresh')
const discoverBtn = $('discover')
const connectBtn = $('connect')
const wirelessBtn = $('wireless')
const pcaddrEl = $('pcaddr')
const pushBanner = $('pushbanner')
const versionEl = $('version')
const updateEl = $('update')
const installBtn = $('installUpdate')

let mirroring = false

const PHONE_KEY = 'otp_phone_addr'
function savePhone(addr) {
  try { localStorage.setItem(PHONE_KEY, addr) } catch (e) {}
}
function loadPhone() {
  try { return localStorage.getItem(PHONE_KEY) || '' } catch (e) { return '' }
}

// 폰 주소만 있으면(포트 없음) 폰의 고정 서버(47801)에 현재 포트를 요청해 붙인다.
async function resolveAddr() {
  let addr = ipEl.value.trim()
  if (addr && !addr.includes(':')) {
    const host = addr
    statusTitle.textContent = '폰에 포트 요청 중…'
    statusAddr.textContent = ''
    const r = await window.api.requestPort(host)
    if (r && r.port) {
      addr = `${host}:${r.port}`
      ipEl.value = addr
    }
    savePhone(host)
  } else if (addr.includes(':')) {
    savePhone(addr.split(':')[0])
  }
  return addr
}

function setStatus(connected, text) {
  dot.className = 'dot ' + (connected ? 'on' : 'off')
  statusTitle.textContent = connected ? '폰 연결됨' : (text || '연결 안 됨')
  statusAddr.textContent = connected ? text : ''
}

async function refreshDevices() {
  statusTitle.textContent = '확인 중…'
  statusAddr.textContent = ''
  const ip = ipEl.value.trim()
  try {
    const list = await window.api.getDevices(ip)
    if (list.length) {
      setStatus(true, list.join(' · '))
      startBtn.disabled = mirroring
    } else {
      setStatus(false, '연결 안 됨')
      startBtn.disabled = true
    }
  } catch (e) {
    setStatus(false, '오류')
    startBtn.disabled = true
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true
  const r = await window.api.startMirror(ipEl.value.trim())
  if (!r.ok) {
    startBtn.disabled = false
    alert(r.msg || '시작 실패')
  }
})

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function doConnect() {
  let addr = await resolveAddr()
  // 포트 요청이 실패(폰이 자고 있어 응답 없음)하면 FCM으로 깨우고 재시도
  if (addr && !addr.includes(':')) {
    const w = await window.api.wakePhone()
    if (w && w.ok) {
      statusTitle.textContent = '폰 깨우는 중…'
      statusAddr.textContent = ''
      await sleep(4500)
      addr = await resolveAddr()
    }
  }
  if (!addr) { setStatus(false, '폰 주소를 입력하세요'); return }
  await refreshDevices()
}

// 새로고침: 포트가 바뀌었을 수 있으니 폰에 현재 포트를 다시 요청한다.
refreshBtn.addEventListener('click', () => {
  ipEl.value = ipEl.value.trim().split(':')[0]
  doConnect()
})
connectBtn.addEventListener('click', doConnect)

discoverBtn.addEventListener('click', async () => {
  const orig = discoverBtn.textContent
  discoverBtn.textContent = '찾는 중…'
  try {
    const r = await window.api.discoverWireless()
    if (r.ok) {
      ipEl.value = r.addr
      await refreshDevices()
    } else {
      alert('같은 WiFi에서 폰의 무선 디버깅을 못 찾았어요.\n폰에서 "무선 디버깅"이 켜져 있는지 확인하거나, 원격이면 주소를 직접 입력하세요.')
    }
  } finally {
    discoverBtn.textContent = orig
  }
})

wirelessBtn.addEventListener('click', async () => {
  const orig = wirelessBtn.textContent
  wirelessBtn.disabled = true
  wirelessBtn.textContent = '설정 중…'
  try {
    const r = await window.api.enableWireless()
    if (r.ok) {
      ipEl.value = r.ip
      alert(`무선 모드 켜짐\n${r.ip} 로 연결했어요. 이제 USB 케이블을 빼도 됩니다.`)
      refreshDevices()
    } else {
      alert(r.msg)
    }
  } finally {
    wirelessBtn.disabled = false
    wirelessBtn.textContent = orig
  }
})

function showPush(addr) {
  pushBanner.hidden = false
  pushBanner.textContent = `폰에서 포트 받음 · ${addr} — 연결됨`
  setTimeout(() => { pushBanner.hidden = true }, 12000)
}

window.api.onPortReceived((v) => {
  ipEl.value = v.addr
  if (v.ip) savePhone(v.ip)
  showPush(v.addr)
  refreshDevices()
})

window.api.onMirrorState((on) => {
  mirroring = on
  if (on) {
    stateEl.textContent = '미러링 중 · 포워딩 일시중지'
    stateEl.className = 'state mirroring'
    startBtn.disabled = true
    startBtn.textContent = '미러링 진행 중…'
  } else {
    stateEl.textContent = '대기 중 · 포워딩 활성'
    stateEl.className = 'state idle'
    startBtn.textContent = '미러링 시작'
    refreshDevices()
  }
})

window.api.onUpdate((u) => {
  switch (u.state) {
    case 'checking': updateEl.textContent = '업데이트 확인 중…'; break
    case 'none': updateEl.textContent = '최신 버전'; break
    case 'available': updateEl.textContent = `새 버전 ${u.version} 받는 중…`; break
    case 'downloading': updateEl.textContent = `업데이트 ${u.percent}%`; break
    case 'ready':
      updateEl.textContent = `v${u.version} 준비됨`
      installBtn.hidden = false
      break
    case 'error': updateEl.textContent = '업데이트 확인 실패'; break
  }
})

installBtn.addEventListener('click', () => window.api.installUpdate())

const fcmStatusEl = $('fcmStatus')
const pickKeyBtn = $('pickKey')
async function refreshFcm() {
  try {
    const s = await window.api.fcmStatus()
    if (s.hasKey) {
      fcmStatusEl.textContent = s.hasToken ? '준비됨' : '키 OK · 폰 연결 대기'
      fcmStatusEl.className = 'ok'
    } else {
      fcmStatusEl.textContent = '키 없음'
      fcmStatusEl.className = 'dim'
    }
  } catch (e) {}
}
pickKeyBtn.addEventListener('click', async () => {
  const r = await window.api.pickSetup()
  if (r && r.ok) {
    if (r.phoneIp) { ipEl.value = r.phoneIp; savePhone(r.phoneIp) }
    const parts = []
    if (r.phoneIp) parts.push(`폰 주소 ${r.phoneIp}`)
    if (r.hasKey) parts.push('FCM 키 OK')
    alert('설정을 불러왔어요' + (parts.length ? ' — ' + parts.join(' · ') : '') + '.')
    refreshFcm()
    if (r.phoneIp) doConnect()
  } else if (r && !r.canceled) {
    alert(r.msg || '설정 불러오기 실패')
  }
})

;(async () => {
  versionEl.textContent = 'v' + (await window.api.appVersion())
  const pc = await window.api.pcAddress()
  pcaddrEl.textContent = pc || '테일스케일 미연결'
  refreshFcm()

  // 1) 저장된 폰 주소가 있으면 포트를 요청해 자동 연결
  const saved = loadPhone()
  if (saved) {
    ipEl.value = saved
    await doConnect()
    return
  }
  // 2) 없으면 같은 WiFi에서 자동 감지 시도
  const d = await window.api.discoverWireless()
  if (d.ok) { ipEl.value = d.addr; savePhone(d.ip) }
  refreshDevices()
})()
