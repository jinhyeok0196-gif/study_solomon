# CTO Field Result — v0.9 P3 : 현장 PC Seat1~Seat8 Short No-Save Camera Readiness Check

작업일: 2026-07-02 (오늘 밤)
작업 성격: **8대 짧은 연결 점검** (운영/production 검증 아님)
안전 원칙: `--save` 금지 · fake --save 금지 · 원격 DB 쓰기 금지 · 자동 출결/벌점/상태/알림/보호자 변경 금지 · frame binary DB 저장 금지 · RTSP 주소/비번/env/서비스롤키/`sb_secret_*` 값 출력 금지 · RTSP 주소는 `configured/empty`만 기록

---

## ⚠️ 먼저 읽으세요 — 이 문서의 성격

**CTO(Claude) 세션은 현재 GitHub Codespace(클라우드, Linux) 안에서 동작 중이며, 현장 PC가 아닙니다.**

| 확인 항목 | 값 |
|---|---|
| CTO 세션 경로 | `/workspaces/codespaces-react/rtsp-poc` (Linux) |
| 호스트 | `codespaces-1a6ef6`, `CODESPACES=true` |
| `C:\solomon\study_solomon-main` | **없음** (Windows 현장 PC 아님) |

- **Chrome Remote Desktop은 사람이 현장 PC 화면에 접속하는 도구**이지, CTO(Claude) 세션이 현장 PC에 명령을 실행하는 통로가 아닙니다.
- 따라서 CTO는 CEO 지시("Codespace 금지")를 지켜 **이 환경에서 8대 점검을 실행하지 않았습니다.** (실행해도 사설 LAN 카메라에 도달 불가 → 무의미) **가짜 결과도 만들지 않았습니다.**
- 아래는 **현장 PC(C:\solomon\study_solomon-main)에서 CEO/운영자가 Chrome Remote Desktop 터미널(PowerShell)에 직접 붙여넣어 실행할 런북**과, 실행 후 채울 **결과 기록 템플릿**입니다.
- **현장 PC에서 실행했는지 여부: (실행자 기입) ☐ 예 / ☐ 아니오**

---

## 0. 현장 PC 실행 전 필수 조건

1. 현장 PC는 **카메라 사설 LAN(예: 192.168.x.x)** 에 물리적으로 연결돼 있어야 함(같은 스위치/공유기).
2. `C:\solomon\study_solomon-main` 에 저장소가 이미 있고, Python venv(3.12) 준비돼 있어야 함(v0.7 STAGE1에서 구성 완료된 상태).
3. 각 좌석 RTSP 주소는 **`.env` 에만** 넣는다. `cameras.yaml` 에는 절대 실주소를 넣지 않는다(placeholder `${SEATn_RTSP_URL}` 유지).

---

## 1. 현장 PC 실행 런북 (PowerShell — 그대로 복사/붙여넣기)

> 아래 블록을 위에서 아래로 순서대로 실행. **어떤 명령에도 `--save` 를 붙이지 않는다.**

### STEP 1 — 현장 PC 여부 + git 상태 확인 + pull

```powershell
cd C:\solomon\study_solomon-main
Get-Location                        # C:\solomon\study_solomon-main 이어야 함
$env:CODESPACES                     # 아무것도 안 나와야 함(현장 PC)
git branch --show-current           # feat/v0.7-seat1-repeat 기대
git rev-parse HEAD
git remote -v | Select-String origin
git pull origin feat/v0.7-seat1-repeat
```

### STEP 2 — 좌석 설정/`.env` 키 확인 (값 출력 없이)

```powershell
cd C:\solomon\study_solomon-main\rtsp-poc

# (a) cameras.yaml 에 Seat1~Seat8 항목 + enabled 상태 확인
Select-String -Path cameras.yaml -Pattern 'seat_id:|enabled:'

# (b) .env 의 SEATn_RTSP_URL 키가 'configured' 인지 'empty' 인지만 출력 (값 노출 금지)
Get-Content .env | Where-Object { $_ -match '^\s*SEAT[1-8]_RTSP_URL\s*=' } | ForEach-Object {
  $parts = $_ -split '=', 2
  $k = $parts[0].Trim()
  $v = $parts[1].Trim()
  if ($v) { "$k : configured" } else { "$k : empty" }
}

# (c) .env 가 git 추적에서 제외돼 있는지 확인
git -C C:\solomon\study_solomon-main check-ignore -v rtsp-poc/.env
```

### STEP 3 — (비어있는 좌석) CEO가 `.env` 에 RTSP 주소 입력

- STEP 2(b)에서 `empty` 로 나온 좌석은 **CEO가 현장 PC에서 직접** `.env` 를 열어 해당 `SEATn_RTSP_URL=` 뒤에 실주소를 입력한다.
- **주의: 이 문서/채팅/커밋 어디에도 실주소를 쓰지 않는다.** `.env` 는 gitignore 대상이라 커밋되지 않는다.
- 입력 후 STEP 2(b)를 다시 돌려 원하는 좌석이 `configured` 로 바뀌었는지만 확인.

### STEP 4 — 테스트할 좌석 enabled=true (로컬 편집, 커밋 금지)

- `cameras.yaml` 은 현재 **Seat1만 `enabled: true`**, Seat2~Seat8은 `enabled: false`.
- 코드상 `enabled: false` 좌석은 RTSP 연결 시도 자체를 하지 않는다(`camera_manager.py:58-60`). → 8대를 점검하려면 점검 대상 좌석을 `enabled: true` 로 바꿔야 한다.
- 메모장 등으로 `cameras.yaml` 을 열어, **점검할 좌석의 `enabled: false` → `enabled: true`** 로만 수정. **RTSP 주소는 넣지 않는다**(placeholder 유지).

```powershell
# 편집 후 enabled 상태 재확인
Select-String -Path cameras.yaml -Pattern 'seat_id:|enabled:'
```

- ⚠️ 이 변경은 **로컬 전용, 커밋/푸시 금지**. (CEO 결정: commit/push 미실행)

### STEP 5 — Python venv 활성화 + 의존성 확인

```powershell
cd C:\solomon\study_solomon-main\rtsp-poc
..\venv\Scripts\Activate.ps1        # venv 위치가 다르면 실제 경로로
python --version                    # 3.12.x 기대
python -c "import cv2, yaml, dotenv; print('deps ok', cv2.__version__)"
```

### STEP 6 — 8대 순차 짧은 점검 (모두 `--save` 없음)

```powershell
python seat1_e2e_test.py --single --preview --seat Seat1 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat2 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat3 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat4 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat5 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat6 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat7 --camera-seconds 6
python seat1_e2e_test.py --single --preview --seat Seat8 --camera-seconds 6
```

> 연결 안 되는 좌석은 preview 캡처가 최대 ~30초(FFmpeg 타임아웃) 지연될 수 있음 — 정상적인 실패 대기이니 기다리면 됨.

---

## 2. 각 좌석 출력에서 읽을 값 (판정용)

각 실행 로그에서 아래 줄을 확인해 표에 기입한다:

- `[camera SeatN] ... connected=True/False ... frames_received=N ... reconnects=N` (warm-up 완료 줄)
- `[camera SeatN] RTSP 연결 성공 (frames_received=N)` **또는** `RTSP 연결 실패`
- `preview: status=available / unavailable / error`
- `mode=real seat_id=SeatN frames=N`
- `activity: ...`  (UNKNOWN 여부)
- `saved: False`  ← **반드시 False/0 이어야 함**

---

## 3. Seat1~Seat8 결과표  (← 현장 PC 실행 후 기입)

| seat_id | RTSP URL(configured/empty) | enabled | connected=True | frames_received>0 | warm-up | reconnects | saved(=False/0) | preview(available/unavailable/error) | preview_errors | tick_errors | activity | UNKNOWN | 판정(PASS/HOLD/FAIL) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Seat1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat2 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat3 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat4 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat5 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat6 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat7 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Seat8 |  |  |  |  |  |  |  |  |  |  |  |  |  |

**판정 기준**
- **PASS**: `connected=True` + `frames_received>0` + `saved=False` + `tick_errors=0` + preview available(또는 graceful degrade)
- **HOLD**: 연결은 됐으나 preview 실패/간헐 오류/프레임 불안정
- **FAIL**: RTSP 연결 실패 / frames 0 / URL 미설정(empty) / 실행 불가

---

## 4. 결과 해석  (← 기입)

- 문제 좌석 목록: __________
- 전체 판정(PASS/HOLD/FAIL): __________
- **내일 아침 Seat1 실제 행동 테스트**: ☐ GO(8대 모두 PASS) / ☐ HOLD
  - GO 여도 내일 아침 **테스트 직전 Seat1 짧은 사전 확인**(`--single --preview --seat Seat1`, 무저장)을 한 번 더 하고 진행.
- **다좌석 동시 장시간 테스트**: ☐ GO / ☐ HOLD / ☐ **NO-GO(현재 기본값)**
  - 오늘은 "짧은 연결 점검" 단계이므로 장시간·동시 테스트는 아직 진행하지 않는다.

---

## 5. CEO 결정 필요 사항

1. STEP 3에서 어떤 좌석의 RTSP 주소를 `.env` 에 실제로 입력할지(오늘 몇 대까지 점검할지).
2. STEP 4의 `cameras.yaml` enabled=true 변경을 **로컬 전용(커밋 안 함)** 으로 둘지, 아니면 8대 상시 운영을 확정하고 별도 커밋 절차를 밟을지.
3. 이 런북/결과 문서를 현장 PC로 전달하는 방법(아래 "전달 방법" 참조).

---

## 6. 보안 점검 (실행자 확인)

- [ ] `.env` 값 / full RTSP URL / 비밀번호 / service role key / `sb_secret_*` **출력 안 함**
- [ ] 결과표에 RTSP 주소는 `configured/empty` 로만 기록(실주소 없음)
- [ ] 8좌석 전부 `saved=False` (원격 DB insert 0건)
- [ ] `git status` 에 `.env`, `previews/`, `temp/`, `latest.mp4`, `latest.json`, `*.mp4` **없음**(이미 .gitignore 로 차단됨: `rtsp-poc/.gitignore` 1·17~31행)
- [ ] `git diff` 에 민감정보 없음
- [ ] preview 파일 / 영상 커밋 안 함

---

## 7. git status / 코드 수정 / commit·push

- **CTO(Codespace)에서의 코드/설정 수정: 없음.** (읽기·환경확인만)
- **현장 PC에서의 수정(예상)**: `cameras.yaml` enabled 로컬 편집(커밋 금지), `.env` RTSP 주소 입력(gitignore 대상, 커밋 안 됨). → **둘 다 commit/push 하지 않는다.**
- **commit/push 여부: 미실행.**
- 생성 파일(문서): `rtsp-poc/cto_field_result_v0.9_p3_fieldpc_8seat_short_no_save_check.md` (본 문서)

---

## 8. 이 문서를 현장 PC로 전달하는 방법

이 문서는 CTO 세션(Codespace)에서 생성됐고, 현장 PC의 `git pull` 로 받으려면 이 문서를 원격 브랜치에 올려야 한다. CEO 결정 필요:
- **(A)** 이 문서(.md)만 commit+push → 현장 PC에서 `git pull` 로 수신 (코드/설정은 안 건드림, 문서만).
- **(B)** push 없이, CEO가 Codespace에서 이 파일 내용을 직접 복사해 현장 PC에 저장.

> CEO 지시의 "commit/push 미실행"은 점검 대상 코드/설정(`cameras.yaml`, 점검 로직)에 대한 것으로 이해했으며, 문서 전달을 위한 (A) 여부는 CEO 승인 후에만 진행한다. **현재는 아무것도 push하지 않은 상태.**

---

## 9. CTO → CEO 다음 판단 요청

1. **이 CTO 세션은 Codespace라 현장 PC 점검을 직접 실행할 수 없습니다.** 실제 8대 점검은 현장 PC(Chrome Remote Desktop 화면)에서 위 런북을 붙여넣어 진행해야 합니다. — 런북대로 실행 후 §3 결과표를 채워 주시면, 그 값으로 CTO가 판정/다음 단계를 정리하겠습니다.
2. 문서 전달 방법 (A)/(B) 중 선택 바랍니다.
3. 오늘 밤 점검 대상 좌석 수(전부 8대 vs 주소 입력 가능한 좌석만)를 알려주시면 STEP 3/4 안내를 그에 맞게 좁히겠습니다.

---

*본 문서는 "운영/다좌석 검증 완료"를 주장하지 않는다. 오늘 작업은 현장 PC에서 수행할 "8대 짧은 연결 점검"의 실행 지침과 결과 기록 틀이다.*
