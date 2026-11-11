# 빌드 방법

OTP 미러링 PC 앱 (Electron). 세컨드폰 화면을 PC로 미러링하고, 미러링 중엔
안드로이드 쪽 포워딩 앱(com.boss.otpforwarder)의 텔레그램 전달을 자동 중지/재개한다.

## 준비
1. Node.js 설치 (v20+ 권장, v24 확인됨)
2. 의존성 설치:
   ```
   npm install
   ```
3. **scrcpy 배치** (git에는 미포함): [scrcpy win64](https://github.com/Genymobile/scrcpy/releases) 압축을 풀어
   `resources/scrcpy/` 에 `scrcpy.exe`, `adb.exe` 등이 바로 보이도록 넣는다.

## 설치파일 빌드
```
npx electron-builder --win --publish never
```
결과물: `dist/OtpMirror_Setup_v<버전>.exe` + `dist/latest.yml` + `dist/*.blockmap`

## 새 버전 배포 (자동업데이트)
1. `package.json` 의 `version` 을 올린다
2. 위 빌드 실행
3. 릴리즈 업로드 (3개 파일 모두 — latest.yml 이 있어야 자동업데이트 동작):
   ```
   gh release create v<버전> dist/OtpMirror_Setup_v<버전>.exe dist/latest.yml dist/*.blockmap --repo cirross2/OtpForwarderPC --title "v<버전>" --notes "..."
   ```
설치된 앱은 실행 시 최신 릴리즈를 확인해 자동으로 내려받고 설치한다.

## 서명
현재 코드 서명 없음(개인용). Windows SmartScreen 경고는 "추가 정보 → 실행"으로 넘어갈 수 있고,
무서명이어도 자동업데이트는 정상 동작한다.
