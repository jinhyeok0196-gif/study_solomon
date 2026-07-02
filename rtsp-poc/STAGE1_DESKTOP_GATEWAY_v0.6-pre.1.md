# STAGE 1 — 현장 데스크탑 게이트웨이 이전 검증 (v0.6-pre.1 재현)

솔로몬스터디카페 AI 학습관리 MVP — **v0.7 착수 전 선행 단계.**
현장 데스크탑 게이트웨이 PC에서 **v0.6-pre.1 단발 미리보기 흐름이 완전히 재현**되는지 확인한다.

> **이 단계는 코드 수정이 없다. 환경 이전 + 재현 테스트만 한다.**
> **AI 판정은 보조 지표입니다. 학생 상태/출결/벌점/알림은 자동 변경되지 않습니다.**

- 작성일: 2026-07-02
- 운영 기준 장비: **현장 데스크탑 게이트웨이 PC (상시 전원)**
- 기준 경로: `C:\solomon\study_solomon-main`
- 셸: **Windows PowerShell**
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`

---

## 0. 절대 원칙 (커밋 금지 / DB 금지 / 자동변경 금지)

- **커밋 금지:** `.env`, `.env.local`, service role key, `sb_secret_*`, RTSP 실제 비밀번호, `models/*.pt`, `temp/previews`, `*.mp4`
- **DB 금지:** 영상/이미지 바이너리는 DB에 저장하지 않는다.
- **자동변경 금지:** 학생 상태/출결/벌점/알림 자동 변경 없음. AI 판정은 보조 지표.
- `.env`는 데스크탑 로컬에만 두고 깃에 올리지 않는다. RTSP 비밀번호는 로그/문서에 항상 마스킹.

---

## 1. 사전 준비물 (설치 확인)

```powershell
# 작업 경로로 이동
Set-Location C:\solomon\study_solomon-main\rtsp-poc

# (1) Python 3.x 확인
python --version

# (2) Node / npm 확인  (PowerShell 에서는 npm.cmd 권장)
node --version
npm.cmd --version      # 또는: npm --version

# (3) ffmpeg 확인 — H.264 트랜스코딩(브라우저 재생 호환)에 필요
ffmpeg -version
```

- `ffmpeg -version`이 실패하면 아래 둘 중 하나로 준비(H.264 미확보 시 mp4v fallback → 브라우저 재생 경고 발생):
```powershell
# 방법 A: 시스템 ffmpeg 설치(관리자 PowerShell)
winget install --id Gyan.FFmpeg -e          # 또는  choco install ffmpeg

# 방법 B: 파이썬 패키지로 ffmpeg 제공(코드 수정 없이 find_ffmpeg 가 자동 인식)
python -m pip install imageio-ffmpeg
```

---

## 2. 파이썬 의존성 설치

```powershell
Set-Location C:\solomon\study_solomon-main\rtsp-poc

# (권장) 가상환경
python -m venv .venv
.\.venv\Scripts\Activate.ps1
# 실행 정책으로 Activate 가 막히면(현재 세션만 허용):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install imageio-ffmpeg    # ffmpeg 를 시스템에 안 깔았다면
```

---

## 3. `.env` 배치 (로컬 전용 · 커밋 금지)

`C:\solomon\study_solomon-main\rtsp-poc\.env` 파일을 `.env.example` 을 복사해 만들고 **로컬에서만** 실제 값을 채운다(커밋 금지):

```
SEAT1_RTSP_URL=rtsp://admin:****@192.168.219.50:554/stream2
SUPABASE_URL=https://<프로젝트>.supabase.co
```

- `****` 자리에 카메라 비밀번호 입력(로컬 `.env` 전용).
- Supabase URL 과 **서비스 롤 키**(서버 전용)는 `.env.example` 항목을 참고해 로컬 `.env` 에만 입력한다. **값은 절대 커밋 금지.**

> ⚠️ `preview_clip_capture.py` / `preview_bridge_server.py` 는 `.env` 를 **자동 로드하지 않는다.**
> 따라서 이 두 스크립트를 돌리는 PowerShell 세션에는 아래처럼 환경변수를 **세션에 주입**해야 한다(코드 수정 없음).
> (`seat1_e2e_test.py --preflight` 는 자체적으로 `.env` 를 읽으므로 주입 없이도 동작한다.)

```powershell
# 현재 PowerShell 세션에 .env 를 로드(로컬 전용 · 화면 출력 없음)
Get-Content .\.env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
  $kv = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim(), 'Process')
}

# 주입 확인(값은 마스킹해서만 확인 — 비밀번호 원문 출력 금지)
if ($env:SEAT1_RTSP_URL) { "SEAT1_RTSP_URL loaded" } else { "SEAT1_RTSP_URL MISSING" }
```

---

## 4. 재현 검증 순서 (체크리스트)

> **STAGE 1 은 `--save` 없이 검증한다.** DB insert 누적 검증은 STAGE 2(v0.7)에서
> `--save` + `--verify-accumulation` 으로 진행한다. 이 단계에서 `ai_rule_decisions` insert 는 없다.

### PowerShell 창 구성 (창별 위치 고정)

동시에 3개의 PowerShell 창을 사용한다. 각 창의 **작업 위치와 역할을 아래로 고정**한다.

| 창 | 작업 위치 | 역할 |
|---|---|---|
| **PowerShell A** | `C:\solomon\study_solomon-main\rtsp-poc` | `.env` 세션 로드(3장) → preflight/single/`preview_clip_capture.py` 실행 |
| **PowerShell B** | `C:\solomon\study_solomon-main\rtsp-poc` | `.env` 세션 로드(3장) → `preview_bridge_server.py` 실행 후 **창 유지(끄지 않음)** |
| **PowerShell C** | `C:\solomon\study_solomon-main` | `npm.cmd run dev` (프론트 dev 서버) |

> A·B 는 두 스크립트가 `.env` 를 자동 로드하지 않으므로 **각 창에서 3장 세션 주입을 각각** 실행해야 한다.

### 4-1. [창 A] 연결/설정 점검 (preflight)
```powershell
Set-Location C:\solomon\study_solomon-main\rtsp-poc
python seat1_e2e_test.py --preflight --seat Seat1
```
- [ ] RTSP URL 존재(마스킹 출력) · `cameras.yaml Seat1 enabled=true` · OpenCV/RuleEngine ready 확인

### 4-2. [창 A] Seat1 RTSP 연결 확인 (단발 파이프라인, 저장 없이)
> 노트북에서 실제 성공했던 형태를 기준으로 한다(opencv 단일 엔진 · 워밍업 15초).
```powershell
python seat1_e2e_test.py --single --seat Seat1 --engines opencv --camera-seconds 15
```
- [ ] 카메라 연결 성공(`connected=true`, `frames_received>0`) — **`--save` 없으므로 DB insert 없음**

### 4-3. [창 A] 5초 미리보기 클립 생성
```powershell
# (3장에서 SEAT1_RTSP_URL 세션 주입이 되어 있어야 함)
python preview_clip_capture.py --seat Seat1 --seconds 5 --ttl 120
```
- [ ] `temp\previews\Seat1\latest.mp4` + `latest.json` 생성

### 4-4. [창 A] `latest.json` 성공 기준 확인
```powershell
Get-Content .\temp\previews\Seat1\latest.json
```
- [ ] `status = available`
- [ ] `frame_count > 0`
- [ ] `codec = h264`
- [ ] `browser_compatible = true`
- [ ] `transcode_status = success`
- (ffmpeg 미설치 시 `codec=mp4v` / `browser_compatible=false` → 1장으로 돌아가 ffmpeg 준비)

### 4-5. [창 B] preview bridge 서버 실행 (창 유지)
```powershell
Set-Location C:\solomon\study_solomon-main\rtsp-poc
# (창 B 에도 3장 .env 세션 주입 실행)
python preview_bridge_server.py --host 127.0.0.1 --port 8765
```
> 이 창은 서버가 계속 떠 있어야 하므로 **끄지 말고 유지**한다.

### 4-6. [창 A] bridge 엔드포인트 확인
```powershell
# /health
Invoke-RestMethod http://127.0.0.1:8765/health

# /api/previews/Seat1/latest  (preview_status=available 기대)
Invoke-RestMethod http://127.0.0.1:8765/api/previews/Seat1/latest

# /previews/Seat1/latest.mp4  브라우저 직접 재생
Start-Process "http://127.0.0.1:8765/previews/Seat1/latest.mp4"
```
- [ ] `/health` → `status: ok`
- [ ] `/api/previews/Seat1/latest` → `preview_status: available`, `preview_clip_url` 존재
- [ ] `/previews/Seat1/latest.mp4` 브라우저 직접 재생 성공

### 4-7. [창 C] 관리자 대시보드에서 미리보기 확인

**(1) `.env.local` 작성 — 최소 3줄 (커밋 금지)**

> ⚠️ `VITE_LOCAL_PREVIEW_BRIDGE_URL` 한 줄만 `Set-Content` 로 덮어쓰면 **Supabase 설정이 삭제되어
> 로그인/DB 연결이 깨진다.** 반드시 아래 **3줄을 모두** 포함해 작성한다.

`C:\solomon\study_solomon-main\.env.local` 내용:
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_LOCAL_PREVIEW_BRIDGE_URL=http://127.0.0.1:8765
```
- 이미 `.env.local` 이 있으면 기존 두 값은 **보존**하고 `VITE_LOCAL_PREVIEW_BRIDGE_URL` 한 줄만 **추가**한다(덮어쓰기 금지).

**(2) 의존성 설치 + dev 서버 (창 C)**
```powershell
Set-Location C:\solomon\study_solomon-main

# package-lock.json 이 있으면 재현성 위해 ci 우선, 실패할 때만 install
if (Test-Path .\package-lock.json) {
  npm.cmd ci        # 또는: npm ci
} else {
  npm.cmd install   # 또는: npm install
}
# ↑ npm.cmd ci 가 실패하면 그때만: npm.cmd install (또는 npm install)

npm.cmd run dev      # 또는: npm run dev
```
- [ ] `.env.local` 3줄 확인(Supabase URL/ANON_KEY 보존 + bridge URL)
- [ ] `http://localhost:3000` 관리자 대시보드 접속(로그인/DB 정상)
- [ ] Seat1 카드 "최근 5초 미리보기"에서 클립 재생 확인
- [ ] AI 판정이 표시되어도 학생 상태/출결/벌점 자동 변경 없음 확인

---

## 5. STAGE 1 통과 기준 (Definition of Done)

- [ ] §4-1 preflight 통과 (RTSP/설정/엔진 ready)
- [ ] §4-2 Seat1 RTSP 연결 성공 — `--single --engines opencv --camera-seconds 15` 기준, **`--save` 없이**
- [ ] §4-3~4-4 `latest.json`: `status=available`, `frame_count>0`, `codec=h264`, `browser_compatible=true`, `transcode_status=success`
- [ ] §4-5~4-6 bridge `/health`·`/api/previews/Seat1/latest`·`/previews/Seat1/latest.mp4` 정상
- [ ] §4-7 `.env.local` 3줄(Supabase URL/ANON_KEY 보존 + bridge URL) → 대시보드 Seat1 최근 5초 미리보기 재생
- [ ] STAGE 1 전 과정에서 `--save` 미사용 → `ai_rule_decisions` insert 0건
- [ ] 커밋 금지 항목 미포함 재확인(`.env`, `.env.local`, service role key, `sb_secret_*`, RTSP 비밀번호, `models/*.pt`, `temp/previews`, `*.mp4`)

> **위 항목 전부 통과해야 STAGE 2(v0.7 코드 수정)로 진입한다. 통과 전에는 v0.7 코드 수정을 시작하지 않는다.**

---

## 6. 트러블슈팅 (Windows)

| 증상 | 조치 |
|---|---|
| `latest.json` `status=unavailable`, `frame_count=0` | RTSP 미연결. `SEAT1_RTSP_URL` 세션 주입(3장) 확인, `--single`로 연결 재확인, stream2 경로/인증/방화벽 점검 |
| `codec=mp4v`, `browser_compatible=false` | ffmpeg 없음 → 1장에서 `winget install Gyan.FFmpeg` 또는 `pip install imageio-ffmpeg` |
| bridge `/api/...` 는 되는데 mp4 재생 실패 | 클립 만료(TTL) 가능 → 4-3 재생성 후 재시도. 또는 브라우저 코덱(mp4v) 경고 → ffmpeg 준비 |
| `Activate.ps1` 실행 차단 | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` (현재 세션만) |
| 대시보드에서 "미리보기 준비 안 됨" | `.env.local`의 `VITE_LOCAL_PREVIEW_BRIDGE_URL=http://127.0.0.1:8765` 설정 및 dev 서버 재시작 |
| 포트 8765 접근 불가 | 로컬 방화벽에서 `127.0.0.1:8765` 허용 확인 |

---

## 7. 범위 밖 (후속 과제로 명시)

- 작업 스케줄러를 통한 **자동 재기동은 STAGE 2에서도 코드가 아니라 문서 절차로만** 다룬다.
- **로그 회전(log rotation)** 은 이번 단계 범위 밖 — 후속 과제.
- STAGE 2(v0.7): 1분 간격 반복 판정·반복 클립, `--forever`/`--duration 0`, tick 예외 격리, `--verify-accumulation`, preview TTL 보정, 프론트 만료 UX 개선. (본 STAGE 1 통과 후 착수)
