# CTO Field Result — v0.8 60min Perf Test

## 1. Executive Summary

- **결과: v0.8 60분 field perf 테스트 성공 (기능적 PASS, cadence는 HOLD)**
- 테스트 명령:
  ```
  python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1
  ```
- verify 명령:
  ```
  python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 100
  ```
- CTO 요약:
  - **저장/preview/RTSP 안정성**: 안정적. 60분 동안 save 46/46, preview 46/46, tick_errors=0, preview_errors=0, reconnects=0.
  - **strict one-minute cadence 여부**: 미검증(FAIL/HOLD). 60분에 60회가 아닌 46회만 실행됨. 정확히 1분 간격이 보장되지 않음.
  - **지연 원인 후보**: RTSP 장애가 아니라 **fixed sleep(interval) scheduler 구조**가 1순위 원인. tick 작업 자체가 평균 ~19.5초 걸린 뒤 고정 60초 sleep을 수행 → 실제 cycle ≈ 79~80초.

## 2. 60-minute Test Result

- mode: duration
- total_runs: 46
- saved: 46
- interval: 60.0s
- activity_counts: {'UNKNOWN': 46}
- tick_errors: 0
- interrupted: False
- previews_generated: 46
- preview_errors: 0
- cleanup_removed: 0

## 3. Perf Summary

- total_perf_samples: 46
- perf_logging_enabled: True
- avg_total_tick_duration: 19.5
- max_total_tick_duration: 20.0
- avg_schedule_drift_seconds: 18.2
- max_schedule_drift_seconds: 20.0
- slowest_tick_index: 26

slowest_tick_breakdown:
- camera_start_wait: 2.002
- warmup_duration: 10.011
- frame_collect_duration: 0.0
- inference_duration: 1.32
- supabase_save_duration: 1.856
- camera_stop_duration: 0.062
- preview_capture_duration: 6.68
- preview_transcode_duration: 0.691
- cleanup_duration: 0.017
- sleep_until_next_tick_duration: 60.0

## 4. Tick Delay Diagnosis

- v0.7에서는 60분 테스트에서 **total_runs=32**였다.
- v0.8에서는 60분 테스트에서 **total_runs=46**이었다.
- **strict one-minute cadence는 여전히 검증되지 않았다.**
- 이번 로그에서 tick 작업 자체는 평균 **약 19.5초** 걸렸다.
- 현재 루프는 작업 약 19.5초 후 **고정 sleep 60초**를 수행하는 구조다.
- 따라서 실제 cycle은 **약 79~80초**가 된다.
- 3600초 / 약 79~80초 ≈ 45~46회이므로 **total_runs=46은 구조적으로 설명 가능하다.**
- **지연의 1순위 원인은 RTSP 장애가 아니라 fixed sleep(interval) scheduler 구조다.**
  - 근거: **reconnects=0, tick_errors=0, preview_errors=0** — 네트워크/카메라/파이프라인 장애 신호 없음.
- 단, **AI 판정 정확도는 검증하지 않았다.**

## 5. DB Accumulation Check

verify-accumulation 결과:

- Supabase GET: HTTP/2 200 OK
- seat_id: Seat1
- total_rows: 100
- activity_counts: {'UNKNOWN': 98, 'ABSENT': 1, 'PHONE': 1}
- earliest_decided_at: 2026-07-01T21:38:09.314064+09:00
- latest_decided_at: 2026-07-02T21:24:44.037628+09:00
- 읽기 전용 집계 — insert/update/delete 없음
- 주의: `--limit 100` 조회 결과이므로 total_rows=100은 **전체 DB row count 증가분을 확정하는 값이 아닐 수 있음**
- 따라서 saved=46과 total_rows 증가분의 **정밀 대조는 HOLD**로 표시
- 하지만 60분 테스트 중 HTTP/2 201 Created가 반복 성공했고 saved=46이므로 **insert path는 PASS**로 표시

## 6. Preview Verification

- previews_generated: 46
- preview_errors: 0
- latest.mp4 / latest.json은 **local temporary preview only**
- status=available
- codec=h264
- browser_compatible=True
- transcode=success
- preview bridge는 **127.0.0.1 local-only 원칙 유지**

## 7. Stability Assessment

**PASS:**
- RTSP connection stability for Seat1 during this run
- Supabase append-only insert path under `--save`
- preview generation path
- perf logging visibility
- read-only verify path

**HOLD:**
- strict one-minute cadence
- exact DB row increase reconciliation due to `--limit 100` cap
- production-grade unattended operation
- multi-seat operation
- AI classification accuracy

## 8. GO / NO-GO

**GO:**
- controlled Seat1 field testing
- drift-aware scheduler 개선 작업 착수
- current perf logs 기반 원인 분석

**NO-GO:**
- production-grade unattended multi-seat operation
- strict one-minute cadence claim
- AI classification accuracy claim
- automatic attendance/penalty/notification/guardian mutation
- video/frame DB storage

## 9. Security Check

아래 항목이 파일/커밋/로그에 포함되지 않았음을 확인:
- [x] .env
- [x] .env.local
- [x] service role key
- [x] sb_secret_*
- [x] RTSP password
- [x] full RTSP URL (마스킹 형태 `rtsp://admin:****@...`만 허용)
- [x] models/*.pt
- [x] mp4/images/temp/previews
- [x] latest.mp4 / latest.json (바이너리)
- [x] video/image binaries

주의:
- 로그에 Supabase URL은 보일 수 있으나 **service-role key 값은 절대 포함하지 않음.**
- RTSP는 **마스킹만 허용** (`rtsp://admin:****@...`).

## 10. CTO Decision Request

CTO에게 아래 결정을 요청한다:
1. v0.8 field perf test **PASS / HOLD / NO-GO** 판정
2. 다음 작업을 **drift-aware scheduler로 진행할지**
3. **fixed sleep(interval)을 유지할지 폐기할지**
4. **Windows power / remote-desktop 원인 조사를 계속할지**
5. **8시간 soak test는 scheduler 개선 후 진행할지**

## 11. Recommended Next Work

1. **v0.8 P1: drift-aware scheduler 구현**
2. 목표: 작업시간 포함해서 **wall-clock 기준 60초마다 tick 시작**
3. preview/save는 유지하되 **다음 tick 예정 시간을 기준으로 sleep 계산**
4. 작업시간이 interval을 초과하면 **negative sleep 대신 drift/overrun을 기록**
5. 구현 후 **20분 테스트 → 60분 테스트** 순서로 검증
