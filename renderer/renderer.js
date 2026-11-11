const $ = (id) => document.getElementById(id)
const deviceEl = $('device')
const ipEl = $('ip')
const startBtn = $('start')
const stateEl = $('state')
const refreshBtn = $('refresh')
const versionEl = $('version')
const updateEl = $('update')
const installBtn = $('installUpdate')

let mirroring = false

async function refreshDevices() {
  deviceEl.textContent = '확인 중…'
  const ip = ipEl.value.trim()
  try {
    const list = await window.api.getDevices(ip)
    if (list.length) {
      deviceEl.textContent = list.join(', ')
      deviceEl.style.color = 'var(--ok)'
      startBtn.disabled = mirroring
    } else {
      deviceEl.textContent = '연결 안 됨'
      deviceEl.style.color = 'var(--dim)'
      startBtn.disabled = true
    }
  } catch (e) {
    deviceEl.textContent = '오류'
    startBtn.disabled = true
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true
  const ip = ipEl.value.trim()
  const r = await window.api.startMirror(ip)
  if (!r.ok) {
    startBtn.disabled = false
    alert(r.msg || '시작 실패')
  }
})

refreshBtn.addEventListener('click', refreshDevices)

window.api.onMirrorState((on) => {
  mirroring = on
  if (on) {
    stateEl.textContent = '● 미러링 중 — 포워딩 일시중지'
    stateEl.className = 'state mirroring'
    startBtn.disabled = true
    startBtn.textContent = '미러링 진행 중…'
  } else {
    stateEl.textContent = '● 대기 중 — 포워딩 활성'
    stateEl.className = 'state idle'
    startBtn.textContent = '미러링 시작'
    refreshDevices()
  }
})

window.api.onUpdate((u) => {
  switch (u.state) {
    case 'checking': updateEl.textContent = '업데이트 확인 중…'; break
    case 'none': updateEl.textContent = '최신 버전'; break
    case 'available': updateEl.textContent = `새 버전 ${u.version} 내려받는 중…`; break
    case 'downloading': updateEl.textContent = `업데이트 ${u.percent}%`; break
    case 'ready':
      updateEl.textContent = `v${u.version} 준비됨`
      installBtn.hidden = false
      break
    case 'error': updateEl.textContent = '업데이트 확인 실패'; break
  }
})

installBtn.addEventListener('click', () => window.api.installUpdate())

;(async () => {
  versionEl.textContent = 'v' + (await window.api.appVersion())
  refreshDevices()
})()
