# CTO Handoff — v0.8 P1 Drift-aware Scheduler

## 1. Executive Summary

- **무엇을 바꿨나**: `seat1_e2e_test.py` 의 반복 루프(`run_duration`)를 **fixed sleep(interval)** 구조에서
  **wall-clock 고정 grid 기반 drift-aware scheduler** 로 교체했다.
- **fixed sleep 구조가 어떻게 바뀌었나**:
  - 기존: `tick 작업 → sleep(interval)` → 실제 cycle = 작업(~19.5초) + 60초 ≈ **79~80초**.
  - 신규: tick n 예정 시작 = `loop_start + (n-1)*interval` (단조 시계 기준).
    각 tick 작업 후 `sleep = max(0, 다음 예정 시작 - now)` → **작업시간을 제외한 남은 시간만** sleep.
    작업 19.5초면 sleep ≈ 40.5초 → **cycle 이 interval(60초)로 수렴**.
- **strict one-minute cadence 검증 가능성 개선**:
  - 이제 tick 시작이 grid 에 정렬되며, "예정 대비 시작 지연"을 `tick_started_late_by_seconds` 로 tick 마다 측정한다.
  - 작업 < interval 이면 late ≈ 0, `schedule_drift_seconds` = 0(정상). 즉 **1분 주기 정확도를 직접 관측·검증**할 수 있다.
  - 단, 이는 코드/유닛 레벨 검증이며 **현장 실측(20분→60분)은 CTO 승인 후 진행**한다.

## 2. Background

- v0.8 60분 field perf 테스트 결과:
  - total_runs: 46
  - saved: 46
  - previews_generated: 46
  - tick_errors: 0
  - preview_errors: 0
  - avg_total_tick_duration: 19.5
  - max_total_tick_duration: 20.0
  - avg_schedule_drift_seconds: 18.2
  - max_schedule_drift_seconds: 20.0
- 원인:
  - 작업 약 19.5초 + fixed sleep 60초 = cycle 약 79~80초.
  - 3600초 / 약 79~80초 ≈ 45~46회 → total_runs=46 은 구조적으로 설명 가능.
  - 즉 지연 1순위 원인은 RTSP 장애가 아니라 **fixed sleep(interval) scheduler 구조**(reconnects=0, tick_errors=0, preview_errors=0).

## 3. Files Changed

커밋/푸시하지 않음. working tree 수정만.

- **`seat1_e2e_test.py`** (수정)
  - `run_duration(...)` 에 주입 가능한 단조 시계 `monotonic_fn=time.monotonic` 파라미터 추가.
  - deadline/스케줄링을 `time.time()` → `time.monotonic()`(단조 시계) 기준으로 전환(시스템 시각 점프 무관, 테스트 주입 가능).
  - fixed `sleep(interval)` 블록을 **drift-aware sleep**(`max(0, 다음 예정 시작 - now)`)으로 교체.
  - overrun 시 sleep=0 + `scheduler_overrun=True` + 초과분을 `schedule_drift_seconds` 에 기록(negative sleep 금지).
  - perf sample 에 scheduler 필드 추가(§5).
  - `summarize_perf` 에 `avg/max_tick_started_late_by_seconds`, `scheduler_overrun_count` 추가.
  - `_format_perf_line` 한 줄 요약에 `late=`, `overrun=` 추가.
  - `_print_perf_summary` 문구를 drift-aware 의미로 갱신 + 신규 필드 출력.
- **`test_seat1_e2e_test.py`** (수정)
  - drift-aware 검증 테스트 6종 추가(§6). 결정론적 가짜 단조 시계(`_FakeClock`) 주입.
- **`README.md`** (수정)
  - "v0.8 P1 — drift-aware scheduler" 절 추가. `schedule_drift_seconds` **의미 변경** 및 신규 필드 문서화.
- **`cto_handoff_v0.8_p1_drift_aware_scheduler.md`** (신규, 이 파일)

## 4. Scheduler Design

- **기존 구조**:
  ```
  run tick
  sleep(interval)          # 작업시간 무시 → cycle = 작업 + interval
  ```
- **신규 구조(drift-aware, 고정 grid)**:
  ```
  loop_start = monotonic()
  for n = 1,2,3,...:
      scheduled_start = loop_start + (n-1)*interval
      run tick (작업)
      next_scheduled  = loop_start + n*interval
      remaining = next_scheduled - now
      if remaining < 0:                # overrun
          sleep = 0; scheduler_overrun = True; drift = -remaining
      else:
          sleep = remaining            # 작업시간 제외한 남은 시간만
      sleep_fn(sleep)
  ```
- **overrun 처리**: 작업시간이 interval 초과 시 sleep=0, `scheduler_overrun=True`.
  negative sleep 대신 `schedule_drift_seconds` 에 초과분(다음 tick 이 밀리는 양)을 기록.
- **drift 계산**: `schedule_drift_seconds = max(0, tick_end - 다음 예정 시작)`.
  작업 < interval 이면 0. 고정 grid 라 지속 overrun 시 drift/late 는 누적된다.
- **duration 종료 조건**: deadline 도 단조 시계 기준(`loop_start + minutes*60`).
  다음 예정 시작이 deadline 을 넘으면 더 이상 sleep/실행하지 않고 종료. KeyboardInterrupt 는 요약 출력 후 정상 종료(기존 유지).

## 5. Perf Log Fields

tick perf sample 에 추가/유지된 필드:

- `scheduled_tick_start_at` (신규): 이 tick 의 고정 grid 예정 시작(ISO, 사람용 표기).
- `actual_tick_start_at` (신규): 이 tick 이 실제로 시작한 시각(ISO).
- `next_scheduled_tick_start_at` (신규): 다음 tick 예정 시작(ISO).
- `tick_started_late_by_seconds` (신규): 예정 대비 이 tick 시작 지연 초(정상 0, overrun 누적 시 증가).
- `scheduler_overrun` (신규, bool): 이 tick 작업이 슬롯(interval)을 초과했는가.
- `total_tick_duration` (유지): 이 tick 작업 소요(sleep 제외).
- `sleep_until_next_tick_duration` (유지, 계산식 변경): 다음 예정 시작까지의 sleep(= max(0, 남은 시간)).
- `schedule_drift_seconds` (유지, **의미 변경**): overrun 초(작업 < interval 이면 0). 구버전은 ≈작업시간(상수)였음.

summary(`perf_summary`) 추가 필드:
- `avg_tick_started_late_by_seconds`, `max_tick_started_late_by_seconds`
- `scheduler_overrun_count`

## 6. Tests

- 실행한 테스트 명령:
  ```
  python -m pytest rtsp-poc -q
  ```
- pytest 결과: **175 passed** (기존 169 + 신규 6). 실패/스킵 **없음**.
- 추가한 테스트(모두 결정론적 가짜 단조 시계 주입, 실카메라/실DB 없음):
  1. `test_drift_aware_sleep_subtracts_work_time` — 작업 < interval 이면 sleep ≈ interval - work, late ≈ 0, overrun False, drift 0. (마지막 tick 은 max_ticks 도달로 sleep 0)
  2. `test_drift_aware_no_accumulation_across_ticks` — 모든 tick 이 grid 에 정시 시작(late ≈ 0). fixed-sleep 대비 누적 지연 없음 확인.
  3. `test_drift_aware_overrun_zero_sleep_and_records_drift` — 작업 > interval → sleep=0, overrun True, drift/late 누적 기록(negative sleep 아님).
  4. `test_drift_aware_duration_mode_no_fixed_sleep_accumulation` — duration 모드에서도 작업+interval 누적 지연 없음(총 실행 횟수 fixed-sleep 대비 개선).
  5. `test_scheduler_perf_fields_present_in_samples_and_summary` — 신규 scheduler perf 필드가 sample/summary 에 존재.
  6. `test_drift_aware_save_gating_and_read_only_verify` — drift-aware 루프에서도 `--save` 일 때만 insert(append-only), `--verify-accumulation` read-only 유지.
- 스모크: `python seat1_e2e_test.py --duration 0.02 --interval 30 --fake --seat Seat1` 정상 동작, perf 한 줄 요약에 `late=/drift=/overrun=` 표시, perf_summary 신규 필드 출력 확인.

## 7. Behavior Preservation

아래가 유지됨을 코드/테스트로 확인:
- `--save` 일 때만 insert (테스트 6번, `repo.health()["count"]` 대조).
- `--verify-accumulation` read-only (select 만, count 불변).
- preview `latest.mp4`/`latest.json` 은 local temporary only (127.0.0.1 local-only 원칙 유지).
- no DB video/frame storage (소스 스캔 테스트 `.update(`/`.delete(`/`imwrite`/`videowriter` 부재 유지).
- AI advisory-only.
- no automatic attendance/penalty/notification/guardian mutation.
- 기존 옵션 전부 유지: `--duration` `--interval` `--save` `--preview` `--seat` `--verify-accumulation` `--perf-log`/`--no-perf-log`.

## 8. Security Check

아래 항목이 변경 diff/파일/로그에 포함되지 않음을 확인:
- [x] .env
- [x] .env.local
- [x] service role key
- [x] sb_secret_*
- [x] RTSP password
- [x] full RTSP URL (마스킹 형태 `rtsp://admin:****@...` 만 허용)
- [x] models/*.pt
- [x] mp4/images/temp/previews
- [x] latest.mp4/latest.json (바이너리)
- [x] video/image binaries

- `git diff` 대상(seat1_e2e_test.py / test_seat1_e2e_test.py / README.md) secret 스캔 결과: 해당 패턴 **0건**.
- RTSP 는 기존 `mask_rtsp`(→ `rtsp://admin:****@...`)만 사용, 마스킹 정책 불변.

## 9. Git Status

- current branch: `feat/v0.7-seat1-repeat`
- git status(요약):
  - `M README.md`
  - `M seat1_e2e_test.py`
  - `M test_seat1_e2e_test.py`
  - `?? cto_field_result_v0.8_60min_perf.md`
  - `?? cto_handoff_v0.8_p1_drift_aware_scheduler.md`
  - `?? cto_push_result_v0.8_tick_perf_logging.md`
- working tree clean 여부: **아니오(수정 있음, 미커밋)**
- commit 여부: **NO**
- push 여부: **NO**

## 10. CTO Review Request

CTO 에게 아래 판단을 요청한다:
- **구현 방향 PASS/HOLD/NO-GO** (drift-aware = 고정 grid + `max(0, 다음 예정 - now)` sleep, overrun 시 drift 기록).
- **commit 진행 여부** (승인 시 커밋/푸시).
- **현장 데스크탑에서 20분 테스트 진행 여부**.
- **20분 PASS 후 60분 재테스트 진행 여부**.

주의:
- 커밋하지 않음.
- 푸시하지 않음.
- 이 handoff 파일에 모든 작업 결과를 기록함.
