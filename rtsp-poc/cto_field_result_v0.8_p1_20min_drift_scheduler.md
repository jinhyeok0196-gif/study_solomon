# CTO Field Result — v0.8 P1 20min Drift-aware Scheduler

## 1. Executive Summary

- **결과: v0.8 P1 20분 현장 테스트 성공 (drift-aware scheduler PASS)**
- 테스트 명령:
  ```
  python seat1_e2e_test.py --duration 20 --interval 60 --save --preview --seat Seat1
  ```
- verify 명령:
  ```
  python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 100
  ```
- CTO 요약:
  - **drift-aware scheduler 현장 작동**: 작동함. 20분에 total_runs=21, sleep 이 약 40초대로 자동 조정되어
    작업시간(~19.4초)을 제외한 남은 시간만 sleep → cycle 이 wall-clock 60초에 수렴.
  - **strict one-minute cadence 검증 가능성**: 크게 개선. avg/max schedule_drift=0.0,
    avg/max tick_started_late=0.0, scheduler_overrun_count=0 → 20분 구간에서 1분 주기 정확도 관측·검증됨.
  - **60분 재테스트 진행 가능 여부**: 가능(GO). 20분 PASS 기준으로 60분 drift-aware 재테스트 진행 권장.

## 2. 20-minute Test Result

- mode: duration
- total_runs: 21
- saved: 21
- interval: 60.0s
- activity_counts: {'UNKNOWN': 21}
- tick_errors: 0
- interrupted: False
- previews_generated: 21
- preview_errors: 0
- cleanup_removed: 0

## 3. Perf Summary

- total_perf_samples: 21
- perf_logging_enabled: True
- avg_total_tick_duration: 19.4
- max_total_tick_duration: 21.8
- avg_schedule_drift_seconds: 0.0
- max_schedule_drift_seconds: 0.0
- avg_tick_started_late_by_seconds: 0.0
- max_tick_started_late_by_seconds: 0.0
- scheduler_overrun_count: 0
- slowest_tick_index: 1

slowest_tick_breakdown:
- camera_start_wait: 2.006
- warmup_duration: 10.011
- frame_collect_duration: 0.0
- inference_duration: 1.185
- supabase_save_duration: 3.371
- camera_stop_duration: 0.024
- preview_capture_duration: 6.73
- preview_transcode_duration: 0.665
- cleanup_duration: 0.016
- sleep_until_next_tick_duration: 38.218

## 4. Scheduler Diagnosis

- 기존 v0.8 60분 테스트는 **fixed sleep 구조** 때문에 total_runs=46 이었다.
- P1 20분 테스트에서는 **total_runs=21** 로, 20분 구간에서 **wall-clock interval(60초) 기준 실행에 근접**했다.
- 핵심 perf 로그에서 **sleep 이 약 40초대(예: slowest tick 38.218s)로 자동 조정**됐다
  (= interval 60초 − 작업시간 ≈ 40초, 작업시간을 제외한 남은 시간만 sleep).
- avg_schedule_drift_seconds = 0.0
- max_schedule_drift_seconds = 0.0
- avg_tick_started_late_by_seconds = 0.0
- max_tick_started_late_by_seconds = 0.0
- scheduler_overrun_count = 0
- 따라서 **drift-aware scheduler 는 현장 20분 테스트 기준 PASS.**
- 다만 **production-grade unattended operation, multi-seat, AI accuracy 는 아직 검증하지 않았다.**

## 5. DB Accumulation Check

verify-accumulation 결과:

- Supabase GET: HTTP/2 200 OK
- seat_id: Seat1
- total_rows: 100
- activity_counts: {'UNKNOWN': 100}
- earliest_decided_at: 2026-07-02T16:42:58.447535+09:00
- latest_decided_at: 2026-07-02T22:16:25.716212+09:00
- 읽기 전용 집계 — insert/update/delete 없음
- 주의: `--limit 100` 조회 결과이므로 전체 row 증가분 정밀 대조는 제한될 수 있음
- 20분 테스트 중 saved=21, HTTP/2 201 Created 반복 성공 근거로 **insert path PASS** 표시

## 6. Preview Verification

- previews_generated: 21
- preview_errors: 0
- status=available
- codec=h264
- browser_compatible=True
- transcode=success
- latest.mp4 / latest.json 은 **local temporary preview only**
- preview bridge 는 **127.0.0.1 local-only 원칙 유지**

## 7. Stability Assessment

**PASS:**
- drift-aware scheduler 20분 현장 작동
- RTSP connection stability
- Supabase append-only insert path under `--save`
- preview generation path
- perf logging visibility
- read-only verify path

**HOLD:**
- 60분 재테스트
- production-grade unattended operation
- multi-seat operation
- AI classification accuracy
- exact DB row increase reconciliation due to `--limit 100` cap

## 8. GO / NO-GO

**GO:**
- controlled Seat1 field testing
- v0.8 P1 60분 drift-aware scheduler 재테스트 진행

**NO-GO:**
- production-grade unattended multi-seat operation
- AI classification accuracy claim
- automatic attendance/penalty/notification/guardian mutation
- video/frame DB storage

## 9. Security Check

아래 항목이 파일/로그에 포함되지 않았음을 확인:
- [x] .env
- [x] .env.local
- [x] service role key
- [x] sb_secret_*
- [x] RTSP password
- [x] full RTSP URL (마스킹 형태 `rtsp://admin:****@...` 만 허용)
- [x] models/*.pt
- [x] mp4/images/temp/previews
- [x] latest.mp4/latest.json
- [x] video/image binaries

주의:
- 로그에 Supabase URL 은 보일 수 있으나 **service-role key 값은 절대 포함하지 않음.**
- RTSP 는 **마스킹만 허용** (`rtsp://admin:****@...`).

## 10. CTO Decision Request

CTO 에게 아래 판단을 요청한다:
- **20분 field test PASS / HOLD / NO-GO** 판정
- **60분 drift-aware scheduler 재테스트 진행 여부**
- **60분 PASS 후 v0.8 P1 완료 처리 여부**
