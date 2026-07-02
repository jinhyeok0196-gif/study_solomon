# CTO Field Result — v0.8 P1 60min Drift-aware Scheduler

## 1. Executive Summary

- **결과: v0.8 P1 60분 drift-aware scheduler 현장 테스트 PASS**
- **v0.8 P1 완료 처리 가능**
- 단, 아래 항목은 아직 **NO-GO**:
  - production-grade unattended multi-seat operation
  - AI classification accuracy claim
  - automatic attendance/penalty/notification/guardian mutation
  - video/frame DB storage
- 판정 근거: 60분 controlled Seat1 field test 에서 total_runs=61, drift=0.0,
  late=0.0, scheduler_overrun_count=0, tick/preview error 0 으로 1분 cadence 수렴 확인.

## 2. Test Command

```
python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1
```

## 3. Runtime Result

- mode: duration
- total_runs: 61
- saved: 61
- interval: 60.0s
- activity_counts: {'UNKNOWN': 61}
- tick_errors: 0
- interrupted: False
- previews_generated: 61
- preview_errors: 0
- cleanup_removed: 0

## 4. Perf Summary

- total_perf_samples: 61
- perf_logging_enabled: True
- avg_total_tick_duration: 19.2
- max_total_tick_duration: 21.8
- avg_schedule_drift_seconds: 0.0
- max_schedule_drift_seconds: 0.0
- avg_tick_started_late_by_seconds: 0.0
- max_tick_started_late_by_seconds: 0.0
- scheduler_overrun_count: 0
- slowest_tick_index: 1

slowest_tick_breakdown:
- camera_start_wait: 2.006
- warmup_duration: 10.012
- frame_collect_duration: 0.0
- inference_duration: 1.336
- supabase_save_duration: 3.346
- camera_stop_duration: 0.046
- preview_capture_duration: 6.615
- preview_transcode_duration: 0.613
- cleanup_duration: 0.013
- sleep_until_next_tick_duration: 38.25

## 5. Verify Accumulation

명령:

```
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 100
```

결과:

- Supabase GET: HTTP/2 200 OK
- seat_id: Seat1
- total_rows: 100
- activity_counts: {'UNKNOWN': 100}
- earliest_decided_at: 2026-07-02T21:02:13.238534+09:00
- latest_decided_at: 2026-07-02T23:22:06.179004+09:00
- 읽기 전용 집계 (read-only aggregation)
- insert/update/delete 없음
- 주의: total_rows=100 은 `--limit 100` 조회 결과이며 **전체 row count 가 아님**

## 6. Scheduler Diagnosis

- 기존 **fixed sleep 구조**에서는 60분 테스트 total_runs=46 이었다.
- v0.8 P1 **drift-aware scheduler** 적용 후 60분 테스트 total_runs=61 로
  **wall-clock 60초 cadence 에 수렴**했다.
- 작업시간 평균 약 19.2초, sleep 약 40초대로 자동 조정됨
  (= interval 60초 − 작업시간 ≈ 40초, 남은 시간만 sleep).
- avg/max schedule_drift = 0.0
- avg/max tick_started_late = 0.0
- scheduler_overrun_count = 0
- 따라서 **Seat1 controlled field 기준 1분 cadence 검증 PASS.**

## 7. Preview Verification

- previews_generated: 61
- preview_errors: 0
- status=available
- codec=h264
- browser_compatible=True
- transcode=success
- latest.mp4 / latest.json 은 **local temporary preview only**
- preview bridge 는 **127.0.0.1 local-only 원칙 유지**

## 8. Security Check

아래 항목이 파일/로그에 포함되지 않았음을 확인:

- [x] .env / .env.local 미포함
- [x] service role key 미포함
- [x] sb_secret_* 미포함
- [x] RTSP password 미포함
- [x] full RTSP URL 미포함 (마스킹 형태 `rtsp://admin:****@...` 만 허용)
- [x] models/*.pt 미포함
- [x] mp4 / images / temp / previews 미포함
- [x] latest.mp4 / latest.json 미포함
- [x] video / image binaries 미포함

주의:
- 로그에 Supabase URL 은 보일 수 있으나 **service-role key 값은 절대 포함하지 않음.**
- RTSP 는 **마스킹만 허용** (`rtsp://admin:****@...`).

## 9. GO / NO-GO

**GO:**
- v0.8 P1 완료 처리
- controlled Seat1 field testing 지속
- 다음 단계 설계 검토

**NO-GO:**
- production-grade unattended multi-seat operation
- AI classification accuracy claim
- automatic attendance/penalty/notification/guardian mutation
- video/frame DB storage

## 10. Git Status

- 현재 브랜치: `feat/v0.7-seat1-repeat`
- 이 결과 파일 생성됨: `rtsp-poc/cto_field_result_v0.8_p1_60min_drift_scheduler.md` (untracked)
- 기타 untracked 파일:
  - rtsp-poc/cto_commit_result_v0.8_p1_drift_aware_scheduler.md
  - rtsp-poc/cto_field_result_v0.8_p1_20min_drift_scheduler.md
  - rtsp-poc/cto_push_result_v0.8_p1_drift_aware_scheduler.md
- **아직 commit / push 하지 않음 — CTO 검토 대기.**
