# REVIEW — Seat1 반복 안정화 v0.7 (진행 현황 포함 · CTO 검토용)

솔로몬스터디카페 AI 학습관리 MVP — v0.6-pre.1(로컬 5초 미리보기 재생 성공)을
**현장 데스크탑 게이트웨이로 이전**한 뒤, **Seat1을 1분 간격으로 반복 판정 + 반복 클립 생성**하고
**PHONE/UNKNOWN/ABSENT 누적을 검증**하는 단계.

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점, 알림은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**

- 작성일: 2026-07-02
- 개정: **v5 — 현장 데스크탑 STAGE 2 실검증 통과 반영**
- 상태: **STAGE 2 현장 검증 통과(2026-07-02)** — Seat1 real RTSP 60분 save+preview **32/32 insert · 32/32 preview 성공**, 누적 12→20→52 정합 확인. Python 1차 커밋 `f218c8f` + 프론트 2차 커밋 `0ea218a`(브랜치 `feat/v0.7-seat1-repeat`, origin push 완료) · 테스트 통과(py 34/158, FE 51) · build OK. **CTO 리뷰 파일: `cto_review_v0.7_seat1_field_verification.md`.**
  - ⚠️ 단, **1분 주기 정확도 완전 검증은 아니다**(§9 known observations — tick 지연 관찰).
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`

### 작업 위치 (v2 수정)

- **Codespaces 또는 로컬:** 코드 수정, 문서, 단위 테스트
- **현장 데스크탑 게이트웨이 PC:** 실제 RTSP 캡처, 반복 판정, preview clip 생성, preview bridge 실행 (**운영 기준 장비**)
  - 기준 경로: `C:\solomon\study_solomon-main`
- **노트북:** 임시 개발/검증 장비일 뿐 **운영 기준 장비가 아님**

---

## 0. CTO 조건부 승인 요약

### 0-1. CTO 최종 판정 (2026-07-02)

- **GO** — Seat1 **controlled field testing 지속 승인**. (대시보드 preview 관찰, append-only `ai_rule_decisions` 누적 검증, 계측·운영 하드닝 지속)
- **NO-GO** — **production-grade unattended multi-seat operation(상용 무인·다좌석 상시 운영)은 아직 미승인.** 출결/벌점/알림/보호자 연락 자동 변경 미승인.
- 운영 하드닝 전 **tick 지연 단계별 계측(duration logging)이 선행 필요**.
- **AI 판정 정확도 미검증 · 1분 주기 정확도 미검증**(§9). 이번 검증은 실패가 아니라 **MVP 기술 검증 성공**이나, "상시 운영 제품"이라 부르기엔 tick 지연·장시간·다좌석·자동복구 검증이 부족하다.
- CTO 복붙용 독립 리뷰: **`cto_review_v0.7_seat1_field_verification.md`**.

### 0-2. 승인된 방향(유지)

- 기존 `seat1_e2e_test.py` 반복 루프 재사용 / `--preview` 플래그로 판정 후 클립 생성
- 카메라 판정용·클립용 **동시 오픈 금지, 순차 접근**
- `preview_bridge_server.py` 그대로 재사용
- `ai_rule_decisions` append-only / `--save`일 때만 insert / `--verify-accumulation` read-only
- 영상·이미지 바이너리 DB 미저장 / 학생 상태·출결·벌점·알림 자동 변경 없음
- 프리뷰 TTL 기본값 `max(120, interval+30)`

**수정 전제(이번 v2 반영):**
운영 기준 장비를 **노트북 → 현장 데스크탑 게이트웨이(`C:\solomon\study_solomon-main`, 상시 전원)** 로 변경.
이에 따라 계획을 **1단계(게이트웨이 이전 검증) → 2단계(반복 안정화)** 로 재정리하고, **장시간 상시 실행** 관점을 추가한다.

---

## 1. 실행 환경 / 운영 기준 장비

- 운영 기준 장비는 스터디카페에 **항상 켜져 있는 현장 데스크탑 게이트웨이 PC**다(노트북 아님).
- 이 PC가 내부망 RTSP에 접근하고, 반복 판정·클립 생성·bridge 서빙을 **상시** 수행한다.
- 기준 경로 `C:\solomon\study_solomon-main` 에 코드/`.env`/`temp/previews`가 위치한다.
- Codespaces·노트북은 코드/문서/단위 테스트용 보조 장비다(실 카메라 접근 없음).

---

## 2. 1단계 — v0.6-pre.1 현장 데스크탑 게이트웨이 이전 (선행, 코드 변경 없음)

> 목적: **v0.7 착수 전에 이미 검증된 단발 캡처·재생 흐름이 현장 데스크탑에서 동일하게 동작함을 확인.**
> 이 단계는 코드 수정이 아니라 **환경 이전 + 재검증(체크리스트)** 이다.

> ✅ **STAGE 1 현장 데스크탑 완료(2026-07-02)** — 아래 전 항목 현장 검증 통과.

- [x] 코드/`.env`를 `C:\solomon\study_solomon-main` 기준으로 배치(민감정보 커밋 금지, `.env`는 로컬만)
- [x] 데스크탑에서 Seat1 RTSP 연결 확인 (`seat1_e2e_test.py --preflight`) — 640x480, fps~24~25, frames_received>0
- [x] `preview_clip_capture.py --seat Seat1 --seconds 5`로 5초 클립 생성 확인
- [x] `latest.json` 확인: `status=available`, `frame_count>0`, `codec=h264`, `browser_compatible=true`, `transcode_status=success`
- [x] `preview_bridge_server.py` 실행 → `/health` 정상
- [x] `/api/previews/Seat1/latest` 정상
- [x] `/previews/Seat1/latest.mp4` 브라우저 직접 재생 확인
- [x] `localhost:3000` 관리자 대시보드 Seat1 "최근 5초 미리보기" 확인
- [x] ffmpeg(H.264 트랜스코딩) 존재 확인 — ffmpeg 8.1.2, transcode success
- [x] Chrome Remote Desktop 원격제어 설정 완료 / STAGE 1에서 `--save` 미사용(insert 0건)

**전제 점검(완료):** Python 3.12.10 / Node v24.18.0 / ffmpeg 8.1.2 / venv+requirements+imageio-ffmpeg 설치, `127.0.0.1:8765` 로컬 접근 확인.
**남은 경고:** 현장에 `models/yolo_object.pt` 없음(preflight YOLO WARN) — STAGE 1 미리보기 재현엔 영향 없음. TTL 만료 UX는 v0.7(STAGE 2)에서 개선.

→ 1단계 통과 확인됨. **2단계(반복) DoD는 아직 현장 데스크탑 실검증 전이므로 §6에서 미체크 유지.**

---

## 3. 2단계 — v0.7 Seat1 반복 안정화 (코드 수정)

> **구현 현황(2026-07-02):** Python **구현 완료 + 1차 커밋 완료**(`f218c8f`). 프론트 **구현/테스트 완료 + 2차 커밋 완료**(`0ea218a`).
> - `rtsp-poc/seat1_e2e_test.py` **수정 완료** — `--preview` 통합, `--forever`/`--duration 0` 무기한, tick 예외 격리, `--verify-accumulation`(read-only), TTL `max(120, interval+30)` 보정.
> - `rtsp-poc/test_seat1_e2e_test.py` **v0.7 테스트 17개 추가 완료**.
> - `preview_clip_capture.py` / `preview_bridge_server.py` **무수정 재사용**(캡처 클래스 그대로).
> - `ai_decision_repository.py`(`get_recent_by_seat`) 재사용. **DB 스키마 변경 없음 → 마이그레이션 불필요.**

### 3.1 반복 루프 (요구 1)

같은 RTSP 카메라를 판정용(CameraManager)과 클립용(cv2)이 **동시에 열지 않도록 순차화**.
`run_once()`가 카메라를 shutdown한 **뒤** 클립을 캡처한다.

```
run_duration(minutes, interval=60s)  # MIN_INTERVAL=30s
  [루프 시작 전] cleanup_expired()
  각 tick:
    1) run_once()            # 카메라 open → 프레임 수집 → engines → fusion → decision → shutdown
    2) if --save: repo.save_decision(decision)   # insert 1건 (update/delete 없음)
    3) if --preview: PreviewClipCapturer(seat).capture()   # 카메라 순차 재오픈 → 5초 클립 → close (DB 미접근)
    4) cleanup_expired()     # 만료된 latest.mp4/latest.json 정리
    5) sleep(interval)
```

- **단일 프로세스 · 단일 루프 · 카메라 순차 접근** → 커넥션 충돌 없음.
- 프리뷰 서빙은 별도로 `preview_bridge_server.py`를 상시 실행(변경 없음).
- **TTL ↔ interval:** 프리뷰 TTL = `max(120, interval + 30)` → 매분 새 클립 전까지 갭 없음.

### 3.2 장시간 상시 실행 (신규 · CTO 요청)

현장 데스크탑은 **상시 가동**이므로 장시간 실행 견고성이 필요하다.

- **무한/장기 실행 옵션:** 현재 `--duration <분>`만 있음 → **`--forever`(또는 `--duration 0` = 무기한)** 추가.
- **tick 격리:** 한 tick의 예외(카메라 순단, 캡처 실패)가 **루프 전체를 중단시키지 않도록** try/except로 감싸고 다음 tick 진행. (run_once는 이미 내부 예외를 잡지만, save/preview/정리 단계까지 tick 단위로 방어.)
- **RTSP 재연결:** CameraManager의 reconnect 카운트를 tick 로그에 노출(연결 품질 관찰).
- **디스크:** 좌석당 `latest.mp4`/`latest.json`만 유지(덮어쓰기) + `cleanup_expired()` → 무한 증가 없음. capture 임시원본(`capture_tmp.mp4`)은 finalize 후 삭제 확인.
- **로그:** 장시간 로그 폭증 방지(주기 요약 로그 · 과도한 per-frame 로그 지양). 필요 시 파일 로그 회전은 후속 과제로 명시.
- **graceful shutdown:** `KeyboardInterrupt`/종료 시 카메라·writer 자원 정리(이미 finally 정리, 루프 레벨에서도 확인).
- **자동 재기동(운영):** 데스크탑에서 작업 스케줄러/서비스로 bridge + 반복 루프 상시 기동(문서 안내). 코드보다 운영 절차 문서로 다룸.

### 3.3 누적 검증 (요구 2)

`seat1_e2e_test.py`에 **읽기 전용** `--verify-accumulation` 모드. `AIDecisionRepository.get_recent_by_seat` 재사용.

```
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 50
```
출력: `total_rows`, `activity_counts`(STUDYING/PHONE/SLEEPING/ABSENT/UNKNOWN), `earliest/latest_decided_at`. **write 없음.**

### 3.4 프리뷰 TTL 만료 UX (요구 3) — `latest.mp4`/`latest.json` 구조 유지

현재 결함: `AIDecisionSection.tsx`의 `nowMs=Date.now()`가 tick 안 함 + `SeatPreviewButton` fetch가 mount 1회.
수정: 주기 refetch(~30s) + `nowMs` tick 승격 + 만료 문구("만료됨 · 곧 재생성") + 남은시간 힌트(`previewRemainingSeconds`).
**구현 완료(프론트, 2차 커밋 완료 `0ea218a`):** `previewTypes.ts`(`previewRemainingSeconds` 헬퍼, `preview_expired='만료됨 · 곧 재생성'`, `PREVIEW_REFETCH_INTERVAL_MS=30000`), `AIDecisionSection.tsx`(`Date.now()` → `useState`+`setInterval(30s)` tick, cleanup `clearInterval`), `SeatPreviewButton.tsx`(`useBridgePreview` 30초 주기 refetch + `clearInterval`/`AbortController.abort()` 정리 + `~n초 후 재생성` 남은시간 표시). available → expired → (다음 tick 클립 생성 후 30초 내) 재생성 자연 전이.

### 3.5 테스트 결과

```
cd rtsp-poc && python -m pytest test_seat1_e2e_test.py -q   →  34 passed
python -m pytest -q                                         →  158 passed (전체 회귀)
npm run test -- admin-ai-decisions                          →  51 passed (프론트)
npm run build (tsc --noEmit 포함)                           →  성공
```
- Python v0.7 신규 테스트 17개: forever(max_ticks 상한) · `--duration 0`→forever · tick 예외 격리 · preview 실패/예외 격리 · run→capture→cleanup 순차 · `--preview`만→insert 0건 · save+preview 누적 · KeyboardInterrupt graceful · TTL 보정 · verify read-only · verify 배타(rc=2) · CLI 파서/배타 · 금지토큰 회귀.
- 프론트 신규: `previewRemainingSeconds` · available→expired 전이 · 남은시간 표시 · **30초 refetch + unmount 정리**(fake timers).

### 3.6 안전성 확인

- **`--preview`만 있고 `--save` 없을 때 insert 0건** — `save_decision` 호출은 소스 단 1곳(`if self.save:` 게이트). preview 경로는 repository 미참조. (테스트 `test_preview_without_save_no_insert`)
- **`--save` 동반 시에만 insert** — append-only 누적. (`test_save_with_preview_inserts_each_tick`)
- **`--verify-accumulation` read-only** — `get_recent_by_seat`만 호출, `save_decision` 없음. save/preview 동반 시 rc=2. (`test_verify_accumulation_read_only`, `..._rejects_save_and_preview`)
- **run_once → capture → cleanup 순차 접근** — `run_once()` finally에서 카메라 shutdown 후에만 capture. 판정용·클립용 동시 오픈 없음. (`test_preview_is_sequential_after_run_once`)
- **tick 예외 / preview 예외 / KeyboardInterrupt 격리** — 각각 try/except, 루프 중단 없음, KeyboardInterrupt는 요약 후 graceful 종료.
- **민감정보 grep clean** — `git diff` / `--cached` 모두 clean. RTSP는 `mask_rtsp()` 마스킹본만.
- **영상/이미지 바이너리 DB 저장 없음** — 클립은 로컬 `temp/previews` 파일, DB엔 판정 메타만.
- **학생 상태/출결/벌점/알림 자동 변경 없음** — 소스 금지토큰 스캔(py/tsx) 강제.

---

## 4. 수정 / 추가 파일 목록

**1단계(이전):** 코드 변경 없음 — 환경 배치 + README 운영 안내 갱신만.

**2단계(rtsp-poc/ · Python)**
| 파일 | 내용 |
|---|---|
| `seat1_e2e_test.py` | `--preview` 통합, **`--forever`(무기한)**, **tick 예외 격리**, `--verify-accumulation`, TTL 보정, preflight에 preview/ffmpeg 항목 |
| `test_seat1_e2e_test.py` | `--preview` 순차 호출·`--forever` 종료조건·tick 예외 격리·`--verify-accumulation`·**save 없이 insert 안 됨** 회귀 |

**2단계(src/features/admin-ai-decisions/ · Frontend)**
| 파일 | 내용 |
|---|---|
| `components/SeatPreviewButton.tsx` | 주기 refetch + tick now + 만료/남은시간 문구 |
| `previewTypes.ts` | 만료 라벨 강화 + `previewRemainingSeconds` |
| `components/AIDecisionSection.tsx` | `nowMs` tick 승격 |
| `__tests__/*` | 만료 전이·남은시간·refetch 테스트 |

**문서**
- `rtsp-poc/README.md` — 현장 데스크탑 게이트웨이 운영 절차(상시 기동·경로·재기동) + 본 파일

**변경 없음(재사용):** `preview_bridge_server.py`, `preview_clip_capture.py`, `ai_decision_repository.py`, `decision_serializer.py`, `rule_engine.py`, `.gitignore`. **스키마 변경 없음 → 마이그레이션 불필요.**

---

## 5. 현장 데스크탑 실행 방법 (`C:\solomon\study_solomon-main`)

```powershell
# 1) 반복 판정 + 반복 클립 (무기한 상시, 1분 간격, 저장 포함)
python seat1_e2e_test.py --forever --interval 60 --save --preview --seat Seat1

#    (기간 지정 예: 8시간)  --duration 480

# 2) 로컬 bridge 서버(프론트 재생용) — 상시
python preview_bridge_server.py --host 127.0.0.1 --port 8765

# 3) 누적 확인(읽기 전용, 언제든)
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 50

# 4) 프론트(선택): .env.local 에 VITE_LOCAL_PREVIEW_BRIDGE_URL=http://127.0.0.1:8765
npm run dev
```

---

## 6. 검증 기준 (Definition of Done)

**1단계**
- [x] 현장 데스크탑에서 §2 체크리스트 전부 통과.

**2단계 — 현장 데스크탑 실검증 통과(2026-07-02)**
- [x] `--preview` 매 tick 판정 + `latest.mp4/latest.json` 재생성. — 60분 테스트 `previews_generated=32`, `preview_errors=0`, 매 tick `status=available, codec=h264, browser_compatible=True, transcode=success`.
- [x] `--save` 동반 시에만 `ai_rule_decisions` insert 누적(미동반 0건). — no-save 10분 `saved=0`(insert 없음), save 10분 `saved=8`(HTTP 201×8), save 60분 `saved=32`(HTTP 201×32).
- [x] `--forever`/장시간 실행에서 tick 예외가 루프를 중단시키지 않음. — 60분 `tick_errors=0, interrupted=False`, 중간 지연 구간에도 루프 유지·매 tick RTSP open/close(연결/해제) 반복 성공(로그상 reconnects=0)(§9).
- [x] `--verify-accumulation`에서 PHONE/UNKNOWN/ABSENT 카운트 증가 확인. — total_rows 12→20→52 단조 증가, read-only(HTTP 200), UNKNOWN 누적 증가.
- [x] 대시보드 클립 만료→재생성 실시간 전이. — 브라우저 관리자 화면에서 Seat1 최근 5초 미리보기 활성화·H.264 재생 성공 확인.
- [x] append-only 유지 / 바이너리 DB 미저장 / 자동 상태변경 없음. — POST insert만(update/delete 없음), 클립은 로컬 `temp/previews` 파일, DB엔 판정 메타만.
- [x] 디스크 무한 증가 없음(latest만 유지 + 만료 정리). — 좌석당 `latest.mp4/latest.json` 덮어쓰기 유지, `cleanup_removed=0`(TTL 내 재생성으로 정리 대상 없음).
- [x] Build/Type/Lint/pytest 통과 / 커밋 전 민감정보 미포함 재확인. — py 34/158, FE 51, build OK, grep clean.

> ⚠️ **비검증 항목:** 위 통과는 **1분 주기 정확도 완전 검증이 아니다** — 그리고 **AI 판정 정확도 검증도 아니다**(activity가 UNKNOWN 위주인 것은 이번 검증 목적상 실패가 아님; 모델 미배치 상태). 60분 테스트에서 tick은 60회가 아니라 **32회** 돌았고 중간 지연 구간이 있었다(§9). "루프 생존성 + RTSP 접근(open/close) + DB append insert + 로컬 preview 생성 + 브라우저 재생 구조 유지"를 검증한 것이지, 스케줄링 정확도나 AI 판정 정확도를 검증한 것은 아니다.

---

## 7. CTO 검토 요청 포인트 (v2)

1. **운영 기준 장비 = 현장 데스크탑 게이트웨이(`C:\solomon\study_solomon-main`)** 전제 반영 확인. (반영 완료)
2. 장시간 상시 실행: **`--forever` + tick 예외 격리** 범위가 적절한지? 자동 재기동을 코드가 아닌 **운영 절차(작업 스케줄러) 문서**로 다루는 것에 동의?
3. 로그 회전을 이번 단계 범위 밖(후속 과제)으로 두는 것에 동의?
4. 이번 단계에서 **학생 상태/출결/벌점 자동 변경은 계속 하지 않는다**는 범위 재확인.

---

## 8. v0.7 범위 밖 / 후속 과제 (지금 구현하지 않음)

> ⚠️ 아래는 **장기 제품 방향 기록용**이다. **v0.7 에서는 구현하지 않는다.**
> v0.7 은 여전히 "Seat1 반복 판정 + preview 재생성 + 누적 검증(읽기)"까지만 다룬다.
> AI 판정은 보조 지표이며, 학생 상태·출결·벌점·알림은 계속 자동 변경하지 않는다.

### 후속 과제 1 — Event Evidence Clip (중요 이벤트 증거 클립)

현재 `latest preview` 와 성격이 다른, **사후 확인/이의신청용 증거 클립**을 분리한다.

- `latest preview` 는 지금처럼 **짧은 TTL 로 계속 덮어쓰기**(휘발성 미리보기).
- `event evidence clip` 은 **PHONE / ABSENT / SLEEPING 등 중요 이벤트 발생 시에만** 10~20초 저장.
- 용도: 벌점 처리, 관리자 사후 확인, **학생 이의신청**.
- **영상 바이너리는 DB 에 저장하지 않는다.** 로컬 또는 스토리지 **파일**로만 저장.
- DB 에는 **메타데이터만**: `event_id, seat_id, student_id, event_type, confidence, started_at, ended_at, clip_path, clip_expires_at, review_status, admin_decision, appeal_status`.
- 흐름: 이벤트 감지 → 증거 클립 저장(파일) + 메타 insert → **관리자 확인 후에만** 벌점 처리 → 학생 이의신청 가능.
- ⚠️ v0.7 미구현. 벌점/알림 자동화는 여전히 하지 않는다(관리자 확인 필수 구조).

### 후속 과제 2 — Solomon Focus Certificate (학습과정 인증서)

앱 상용화 + AI 정확도/운영 신뢰성 확보 **이후**의 장기 제품 비전.

- 순공시간 · 집중시간 · 루틴 유지율 · 목표 달성률 등을 기반으로 **학습과정 인증서** 발급.
- 결과 중심 평가를 보완하는 **과정 인증**.
- "실력 보증"이 아니라 **"검증된 환경에서 일정 기간 성실히 학습 과정을 수행했다는 인증"**.
- **사용자 동의 기반 공유** / 보호자·지인·관리자·외부 제출용 리포트 단계 구분.
- 위변조 방지 코드 또는 검증 링크는 후속 설계.
- ⚠️ v0.7 미구현(장기 비전 기록).

---

## 9. Known Observations — tick 지연 (현장 검증 기록)

STAGE 2 60분 save+preview 테스트(`--duration 60 --interval 60`).

**Observed:**
- 60분 테스트에서 `total_runs = 32` (정확히 60회 tick이 돈 것이 아니다).
- 지연 구간 예: `17:12:55 → 17:18:51`, `17:27:52 → 17:39:57`.

**Impact:**
- strict one-minute cadence는 검증되지 않음(not validated).
- 그러나 루프는 죽지 않음(loop did not crash).
- `saved 32/32` 성공, `previews 32/32` 성공.
- `tick_errors=0`, `preview_errors=0`, `interrupted=False`.

**Root cause:**
- **이번 테스트에서 확정하지 않았다(not determined in this test).**
- 후보 원인: 프로세스 스케줄링, sleep/drift 계산 방식, blocking I/O, preview transcode, RTSP/OpenCV open/close 지연, Windows 전원/백그라운드 스케줄링, 원격 데스크톱 환경 영향 등. **RTSP 순단으로 단정하지 않는다**(로그상 reconnects=0 흐름이 반복됨).

**Required next step — tick 단계별 duration logging 추가:**
`camera_start_wait`, `warmup_duration`, `frame_collect_duration`, `inference_duration`, `supabase_save_duration`, `camera_stop_duration`, `preview_capture_duration`, `preview_transcode_duration`, `total_tick_duration`, `sleep_until_next_tick_duration`, `schedule_drift_seconds`.

> **정확한 표현(문서·리뷰에 반드시 이 표현 사용):**
> "v0.7 STAGE 2는 **1분 주기 정확도 완전 검증이 아니라**, 장시간 실행 중 지연이 있어도 **루프가 죽지 않고 RTSP 접근·DB 저장·preview 생성·브라우저 재생 구조가 유지됨**을 검증했다. 지연 원인은 이번 테스트에서 확정하지 않았다."

---

## 10. 운영 전환 전 보완 과제 (Pre-operation TODO)

STAGE 2 통과 = "구조가 살아있다" 확인. 아래는 **실운영 상시 가동 전** 정리/결정이 필요한 항목이다.

1. **tick 지연 원인 분석** — §9의 단계별 duration logging 추가(run_once/캡처/트랜스코딩/카메라 open·close/sleep drift 각 단계 소요시간 계측). 원인은 아직 미확정이므로 계측 후 판단.
2. **1분 주기 정확도 개선 여부 결정** — 고정 sleep(interval) → "다음 정각 정렬(drift 보정)" 스케줄로 바꿀지, 아니면 "지연 허용 + 저장/preview 무결성 우선" 현행 유지로 확정할지 CTO 결정.
3. **save path 의존성 requirements 반영 확인** — `supabase` 패키지를 `requirements.txt`에 반영 완료(v0.7). 현장 재배포 시 `pip install -r requirements.txt`로 재현되는지 확인.
4. **YOLO/MediaPipe 모델 배치 계획** — 현재 현장에 `models/*.pt`/MediaPipe 모델 없음(preflight WARN, preview 검증엔 non-blocking). 실제 활동판정 정확도용 모델 배치·버전관리 계획(모델 파일은 커밋 금지).
5. **관리자 대시보드 read migration 적용 여부 확인** — `20260709000000_ai_rule_decisions_admin_read.sql`(read-only RLS + realtime) 원격 반영 상태 재확인.
6. **preview bridge 운영 방식 정리** — `preview_bridge_server.py` 상시 기동(작업 스케줄러/서비스), 반복 루프와 함께 자동 재기동 절차 문서화.
7. **local preview 보안/접근 범위 정리** — bridge는 `127.0.0.1:8765` 로컬 전용, 외부 노출 금지 원칙 명문화. 원격제어(Chrome Remote Desktop) 경유 접근 범위 정리.
8. **60분 이상 장시간/반나절 테스트 계획** — `--forever` 또는 `--duration 480`(8시간) 이상 상시 실행에서 디스크/메모리/로그/RTSP open·close 누적 거동 관찰. 로그 회전 후속 과제 확정. Windows 전원/절전/화면꺼짐/원격 데스크톱 영향 점검 포함.
9. **Seat2~Seat8 확장 전 카메라별 RTSP/ROI 검증 계획** — 좌석별 RTSP URL·서브스트림·ROI·enabled 검증, 동시 다좌석 순차 접근 부하 검토.
