# CTO Handoff — v0.8 Tick Delay Perf (Duration) Logging

> Solomon Study Cafe — AI Learning Management MVP
> Standalone handoff document. Copy-paste ready for CTO / external technical reviewer.
>
> **AI decisions are an advisory signal only. STABLE is not a final adjudication.**
> Student state / attendance / penalty / notification / guardian contact are **not** mutated automatically.

- Date: 2026-07-02
- Branch: `feat/v0.7-seat1-repeat`
- Predecessor: v0.7 Seat1 field verification (`cto_review_v0.7_seat1_field_verification.md`)
- Seat under test: Seat1 (TP-Link VIGI substream `stream2`)
- RTSP (masked, masking-only allowed): `rtsp://admin:****@192.168.219.50:554/stream2`

---

## 1. Executive Summary

v0.8 is the **tick-delay root-cause instrumentation** step. In the v0.7 60-minute Seat1 save+preview field test, only `total_runs=32` ticks ran in 60 minutes (not 60). v0.8 does **not** fix that delay — it adds **stage-level duration logging** to `seat1_e2e_test.py` so the delay can be decomposed and observed per tick.

- **This work is instrumentation only. It is NOT a scheduling fix.**
- **Strict one-minute cadence is still neither validated nor changed.** The fixed `sleep(interval)` behavior and the `run_once → save → preview → cleanup → sleep` flow are unchanged.
- **AI classification accuracy is not validated** (models not deployed; activity is UNKNOWN-dominant, which is expected here).
- **Multi-seat operation is not validated.**
- **Production-grade unattended operation remains NO-GO.**
- **Controlled Seat1 field testing remains GO.**

Recommended next action: run the 60-minute field re-test on the field desktop gateway, then analyze `perf_summary`.

---

## 2. Why v0.8 Starts Here

v0.7 confirmed the structure survives (loop, RTSP access, append-only insert, browser-compatible preview) but revealed a scheduling delay: 32 ticks in 60 minutes with gaps (e.g. `17:12:55 → 17:18:51`, `17:27:52 → 17:39:57`). The v0.7 review deferred **"add stage-level duration logging"** as the first P0 before any operational hardening. v0.8 delivers exactly that measurement — no behavior change — so the delay's cause (currently undetermined) can be isolated with data instead of guesses.

---

## 3. Scope

- Add per-tick, stage-level duration measurement to `seat1_e2e_test.py`.
- Emit a one-line human-readable `[perf Seat1] ...` log per tick.
- Emit an end-of-run `perf_summary` (averages, maxima, slowest-tick breakdown).
- Expose preview transcode duration from `preview_clip_capture.py` as an **additive, optional** metadata field (existing preview JSON structure and browser playback unchanged).
- CLI toggle `--perf-log` / `--no-perf-log` (default enabled).
- Tests for the above, keeping all existing safety/regression tests green.

---

## 4. Non-goals

- **Not** a scheduling fix; fixed `sleep(interval)` and tick flow are unchanged.
- **Not** a validation of strict one-minute cadence.
- **Not** an AI classification accuracy test.
- **Not** multi-seat operation.
- **Not** production/unattended readiness.
- **No** automatic mutation of attendance / student state / penalty / notification / guardian contact.
- **No** video/frame binaries stored in DB; `latest.mp4` / `latest.json` remain local temporary preview artifacts.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `rtsp-poc/seat1_e2e_test.py` | Stage-level timing in `run_once` (inference/save/camera-stop) and `_make_burst` (camera start/warmup/frame-collect); per-tick perf sample + `[perf Seat1]` log + `perf_summary` in `run_duration`; `--perf-log`/`--no-perf-log`; `perf_log` runner arg. No scheduling/flow change. |
| `rtsp-poc/preview_clip_capture.py` | `capture()` times `finalize_clip`; `build_metadata` gains **optional** `transcode_duration_seconds` (additive — omitted when None, existing JSON unchanged). |
| `rtsp-poc/test_seat1_e2e_test.py` | +11 v0.8 perf tests (per-tick sample, summary present, save/preview duration gating, failure/exception still produce samples, verify-accumulation runs no perf loop, scalar-only samples, log-line format, flag parse). |
| `rtsp-poc/requirements.txt` | Unchanged (`supabase>=2.0.0` already present from v0.7). |
| `rtsp-poc/README.md` | Document `--perf-log` + v0.8 "measurement-only" note. |
| `rtsp-poc/REVIEW_Seat1_Repeat_v0.7.md` | §10 P0 item marked "v0.8 계측 구현 완료". |

---

## 6. Implementation Summary

- Timing uses `time.perf_counter()` (monotonic) for durations; `datetime` for `tick_started_at`.
- `_make_burst` (real mode) records `camera_start_wait`, `warmup_duration`, `frame_collect_duration`, `reconnects` into `self._capture_perf`. Fake mode leaves them at 0.
- `run_once` measures `inference_duration` (engines + fusion + rule), `supabase_save_duration` (only when `--save`), `camera_stop_duration`, and returns a `perf` sub-dict.
- `run_duration` wraps each tick: times preview capture + cleanup, computes `total_tick_duration` (work, excluding sleep), measures the (unchanged) `sleep(interval)` as `sleep_until_next_tick_duration`, and derives `schedule_drift_seconds = (total_tick_duration + sleep) - interval`. A perf sample is appended **every tick**, including ticks where `run_once` raised or preview failed.
- `perf_summary` aggregates all samples (avg/max total tick, avg/max drift, slowest tick index + stage breakdown).
- **Known measurement limitations (documented in code):** `camera_start_wait` is observed at the 2s warm-up poll granularity; `warmup_duration` includes the connect-wait window; `preview_transcode_duration` times `finalize_clip` (ffmpeg transcode + trivial file finalize).

---

## 7. New Perf Fields

Per-tick perf sample fields:

`tick_index`, `seat_id`, `tick_started_at`, `camera_start_wait`, `warmup_duration`, `frame_collect_duration`, `inference_duration`, `supabase_save_duration`, `camera_stop_duration`, `preview_capture_duration`, `preview_transcode_duration`, `cleanup_duration`, `total_tick_duration`, `sleep_until_next_tick_duration`, `schedule_drift_seconds`, `reconnects`, `saved`, `preview_available`, `preview_status`, `tick_error`, `preview_error`.

`perf_summary` fields:

`total_perf_samples`, `perf_logging_enabled`, `avg_total_tick_duration`, `max_total_tick_duration`, `avg_schedule_drift_seconds`, `max_schedule_drift_seconds`, `slowest_tick_index`, `slowest_tick_breakdown` (per-stage durations of the slowest tick).

`preview_clip_capture` metadata (additive, optional): `transcode_duration_seconds`.

---

## 8. How to Run Field Test

On the field desktop gateway (`C:\solomon\study_solomon-main`):

```bash
# 60-minute save + preview re-test with per-stage perf logging (default on)
python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1

# preview bridge (local-only) — as before
python preview_bridge_server.py --host 127.0.0.1 --port 8765

# read-only accumulation check (no perf loop)
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 100

# perf logging can be disabled if needed
python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1 --no-perf-log
```

---

## 9. Expected Output

Per tick (illustrative — actual numbers will vary):

```
[perf Seat1] tick=7 total=84.2s drift=24.2s camera_start=1.1s warmup=3.0s collect=5.0s inference=0.2s save=0.4s camera_stop=0.8s preview_capture=7.1s transcode=2.3s cleanup=0.0s sleep=0.0s reconnects=0 saved=True preview=available errors=0
```

End of run:

```
perf_summary:
  total_perf_samples: 32
  perf_logging_enabled: True
  avg_total_tick_duration: 82.4
  max_total_tick_duration: 721.3
  avg_schedule_drift_seconds: ...
  max_schedule_drift_seconds: ...
  slowest_tick_index: 18
  slowest_tick_breakdown:
    camera_start_wait: ...
    preview_capture_duration: ...
    preview_transcode_duration: ...
    supabase_save_duration: ...
```

After the field test, check: `[perf Seat1]` lines, `perf_summary`, `slowest_tick_breakdown`, `schedule_drift_seconds`, preview_capture/transcode durations, camera_start/open/stop durations, and consider Windows power/remote-desktop effects.

---

## 10. What This Validates

- Each tick's time can now be **decomposed** into camera start/warmup/collect, inference, save, camera stop, preview capture, preview transcode, cleanup, and sleep.
- Schedule drift per tick is quantified and summarized (avg/max) with the slowest tick's stage breakdown.
- Instrumentation itself is safe: samples are scalar (numbers/strings) only; no video/frame binaries; existing preview JSON and browser playback unchanged; append-only insert path unchanged.

---

## 11. What This Does Not Validate

- Strict one-minute scheduling accuracy (not changed, not validated).
- AI classification accuracy (models not deployed; UNKNOWN-dominant is expected).
- Multi-seat operation (Seat1 only).
- Unattended production operation / automated recovery.
- Root cause of the delay — v0.8 only measures it; the cause remains **undetermined until field data is analyzed**.

Candidate causes to weigh against the measured data: process scheduling, sleep/drift behavior, blocking I/O, preview transcoding, RTSP/OpenCV open/close latency, Windows power/background scheduling, remote-desktop environment effects. (We do **not** attribute the delay to RTSP dropouts — v0.7 logs showed a repeated `reconnects=0` flow.)

---

## 12. GO / NO-GO

**GO:**
- Continue controlled Seat1 field testing.
- Run the 60-minute perf re-test and collect `perf_summary`.
- Continue dashboard preview observation and append-only accumulation checks.

**NO-GO:**
- Do not claim production readiness.
- Do not run unattended multi-seat production operation.
- Do not enable automatic attendance / penalty / notification / guardian-contact mutation.
- Do not claim strict one-minute scheduling accuracy (unchanged).
- Do not claim AI classification accuracy from this test.
- Do not store video/frame binaries in DB.

---

## 13. Security / Sensitive Data Check

- RTSP URL: **masking only** — full credentials never written to docs/logs.
- Service-role key: **existence only, value NEVER displayed** in code, logs, or docs.
- Never committed: `.env`, `.env.local`, service-role key, `sb_secret_*`, RTSP password, `models/*.pt`, `mp4/images/temp/previews`, `latest.mp4`/`latest.json`.
- `latest.mp4` / `latest.json`: **local temporary preview artifacts only.**
- Preview bridge: `127.0.0.1` **local-only; no external exposure.**
- **No video/frame binaries stored in the DB.** Perf samples contain scalar values (numbers/strings) only.

---

## 14. Risks

- **Measurement granularity:** `camera_start_wait` observed at 2s poll resolution; `preview_transcode_duration` includes trivial file-finalize overhead. Interpret accordingly.
- **Drift definition under fixed sleep:** with the unchanged fixed `sleep(interval)`, `sleep ≈ interval`, so `schedule_drift_seconds ≈ per-tick work overrun`. This is intentional and honest for diagnosis; a future drift-aware scheduler (if chosen) would shrink sleep and change this relationship.
- **Log volume:** one perf line per tick. For very long soaks, pair with log rotation (P1) or `--no-perf-log`.
- **No behavior change verified in field yet:** the instrumentation is unit-tested (169 passed); the 60-minute field re-test is still pending.

---

## 15. Next Actions After Field Test

1. Analyze `perf_summary` + `slowest_tick_breakdown` to identify which stage dominates the delay.
2. Decide (CTO) whether to improve one-minute accuracy (drift-aware schedule) or keep delay-tolerant fixed sleep.
3. Inspect Windows power / sleep / display-off / remote-desktop effects if `sleep`/`camera_start` dominate.
4. Proceed to P1 hardening (≥ half-day soak, log rotation, auto-restart, recovery) only after the cause is understood.
5. Keep AI advisory-only; no automatic attendance/penalty/notification/guardian mutation.

---

## 16. Completion Report

**Files created / modified in this v0.8 work:**

| File | Status | Change summary |
|------|--------|----------------|
| `rtsp-poc/seat1_e2e_test.py` | modified | Added `time.perf_counter()` stage timing. `_make_burst` (real) records `camera_start_wait` / `warmup_duration` / `frame_collect_duration` / `reconnects`. `run_once` times `inference_duration`, `supabase_save_duration` (only when `--save`), `camera_stop_duration` and returns a `perf` sub-dict. `run_duration` times preview capture + cleanup + sleep per tick, computes `total_tick_duration` and `schedule_drift_seconds`, appends a perf sample **every tick (including on exception/preview failure)**, emits the `[perf Seat1]` one-line log, and adds `perf_summary` + `perf_samples` to the returned summary. Added `--perf-log` / `--no-perf-log` (default on) and `perf_log` runner arg. |
| `rtsp-poc/preview_clip_capture.py` | modified | `capture()` times `finalize_clip`; `build_metadata` gains **optional** `transcode_duration_seconds` (additive — omitted when None, so existing preview JSON structure and browser playback are unchanged). |
| `rtsp-poc/test_seat1_e2e_test.py` | modified | +11 v0.8 perf tests (see §17). |
| `rtsp-poc/README.md` | modified | Documented `--perf-log` and the v0.8 "measurement-only" note. |
| `rtsp-poc/REVIEW_Seat1_Repeat_v0.7.md` | modified | §10 P0 item marked "v0.8 계측 구현 완료" with pointer to this file. |
| `rtsp-poc/cto_handoff_v0.8_tick_perf_logging.md` | created | This handoff document. |

**New perf fields (complete list).** Per-tick perf sample:
`tick_index`, `seat_id`, `tick_started_at`, `camera_start_wait`, `warmup_duration`, `frame_collect_duration`, `inference_duration`, `supabase_save_duration`, `camera_stop_duration`, `preview_capture_duration`, `preview_transcode_duration`, `cleanup_duration`, `total_tick_duration`, `sleep_until_next_tick_duration`, `schedule_drift_seconds`, `reconnects`, `saved`, `preview_available`, `preview_status`, `tick_error`, `preview_error`.

`perf_summary`:
`total_perf_samples`, `perf_logging_enabled`, `avg_total_tick_duration`, `max_total_tick_duration`, `avg_schedule_drift_seconds`, `max_schedule_drift_seconds`, `slowest_tick_index`, `slowest_tick_breakdown`.

Preview metadata (additive, optional): `transcode_duration_seconds`.

**v0.7 behavior retained (unchanged):**
- Fixed `sleep(interval)` scheduling and the `run_once → save → preview → cleanup → sleep` tick flow.
- Sequential camera access (judge camera shut down before preview clip capture).
- `ai_rule_decisions` append-only; insert only when `--save`; `--verify-accumulation` read-only.
- Preview `latest.mp4` / `latest.json` as local temporary artifacts; TTL cleanup; browser-compatible playback.
- No automatic mutation of attendance / student state / penalty / notification / guardian contact.
- No video/frame binaries in DB.

**Intentionally NOT changed in this work:**
- Scheduling / cadence (no drift-aware sleep) — measurement only.
- AI models / ROI / classification (still UNKNOWN-dominant; not an accuracy test).
- Multi-seat behavior (Seat1 only).
- Database schema (no migration needed).
- `requirements.txt` (`supabase>=2.0.0` already present from v0.7).

---

## 17. Test Results

**Command executed (this environment, dev container):**
```
python -m pytest rtsp-poc -q
```
**Result: `169 passed` (0 failed, 0 skipped)** — full `rtsp-poc` suite. This is an actual run in the development container, not the field desktop.

Breakdown: v0.7 baseline 158 → **+11 v0.8 perf tests = 169**. New v0.8 tests:
1. perf sample created every tick + `perf_summary` present.
2. `perf_summary` contains all required keys.
3. `supabase_save_duration` recorded only when `--save` (0.0 otherwise).
4. `preview_capture_duration` / `preview_transcode_duration` recorded only when `--preview`; transcode value propagates from preview metadata.
5. `perf_summary` still generated when preview capture fails.
6. perf sample kept when a tick raises (`tick_error=True`).
7. perf sample values are scalar only (no video/frame binaries).
8. `perf_logging_enabled` reflects `--no-perf-log`.
9. `[perf Seat1]` log line format / prefix.
10. `--perf-log` / `--no-perf-log` flag parsing (default on).
11. `--verify-accumulation` runs read-only (no perf loop).

Existing safety regressions kept green: no automatic state change, no video DB storage, no insert without `--save`, `--verify-accumulation` read-only, forbidden-token source scan.

**Not run in this environment (requires field desktop + real RTSP):**
- 60-minute real-camera `--save --preview` perf re-test → **not run** (see §20). The "169 passed" above is unit/integration on fake inputs; **real-field v0.8 validation is pending**.

---

## 18. Git / Commit Readiness

- **Branch:** `feat/v0.7-seat1-repeat`
- **Staged:** nothing staged yet.
- **Committed:** **NOT committed** — working-tree changes only, no new commit created.
- **Pushed:** NOT pushed.

**`git status` (summary):**
```
 M rtsp-poc/README.md
 M rtsp-poc/REVIEW_Seat1_Repeat_v0.7.md
 M rtsp-poc/preview_clip_capture.py
 M rtsp-poc/seat1_e2e_test.py
 M rtsp-poc/test_seat1_e2e_test.py
?? rtsp-poc/cto_handoff_v0.8_tick_perf_logging.md
```

**Commit candidate files:** the six files above (5 modified + 1 new).

**Proposed commit message:**
```
feat(rtsp): add v0.8 tick-delay stage-level perf logging (measure only)

- seat1_e2e_test.py: per-stage tick timing (camera start/warmup/collect,
  inference, save, camera stop, preview capture/transcode, cleanup, sleep),
  schedule_drift, [perf Seat1] one-line log, perf_summary; --perf-log/--no-perf-log
- preview_clip_capture.py: expose optional transcode_duration_seconds
  (additive metadata; existing preview JSON/browser playback unchanged)
- keep fixed sleep(interval) and run→save→preview→cleanup→sleep flow (no scheduling change)
- tests: +11 perf tests (169 passed); safety regressions kept green
- docs: README --perf-log note, v0.7 REVIEW P0 update, cto_handoff_v0.8 file

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## 19. Security / Sensitive Data Diff Check

Checked against `git diff` + working-tree changes + commit-candidate files. Values are never printed here — only presence/absence.

| Item | Result |
|------|--------|
| `.env` value | not included |
| `.env.local` value | not included |
| service role key value | not included (existence-only references) |
| RTSP password | not included |
| `sb_secret_*` | not included |
| `models/*.pt` | not included |
| `mp4` / `images` / `temp` / `previews` files | not included |
| `latest.mp4` / `latest.json` | not included |
| video / image binaries | not included (perf samples are scalar values only) |
| full RTSP URL | not included — only masked `rtsp://admin:****@…` appears |

Scans run: sensitive-file scan over changed/untracked paths (clean), content secret scan for `sb_secret_*` / JWT (`eyJ…`) / `SERVICE_ROLE_KEY=…` / PEM markers over diff + this file (clean), and unmasked-RTSP scan over this work's diff additions (clean).

---

## 20. Field Desktop Next Commands

On the field desktop gateway (PowerShell):

```powershell
cd C:\solomon\study_solomon-main\rtsp-poc
.\.venv\Scripts\Activate.ps1

# 60-minute save + preview re-test with per-stage perf logging (default on)
python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1

# local-only preview bridge (as before)
python preview_bridge_server.py --host 127.0.0.1 --port 8765
```

Read-only accumulation check after the test:

```powershell
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 100
```

After the run, inspect: `[perf Seat1]` lines, `perf_summary`, `slowest_tick_breakdown`, `schedule_drift_seconds`, preview_capture/transcode durations, camera_start/stop durations, and consider Windows power / remote-desktop effects.

---

## 21. CTO Decision Request

- **Commit approval requested: YES**
- **Push approval requested: NO** (push after separate approval)
- **Field re-test approval requested: after commit/push**

**Current recommendation:**
- Approve the commit — unit/integration tests (169 passed) and the security diff check are clean.
- Do **not** claim v0.8 field validation until the 60-minute perf re-test is run on the field desktop (§20).

**GO / NO-GO (unchanged):**

GO:
- Controlled Seat1 field testing.
- Commit after CTO review.
- Field desktop 60-minute perf re-test after commit/push.

NO-GO:
- Production-grade unattended multi-seat operation.
- Strict one-minute cadence claim.
- AI classification accuracy claim.
- Automatic attendance / penalty / notification / guardian mutation.
- Video / frame DB storage.

---

## 22. Commit Completed Report

- **Commit completed: YES**
- **Push completed: NO**
- **Branch:** `feat/v0.7-seat1-repeat`
- **Working tree clean: YES** (at time of commit)
- **Local branch is ahead of `origin/feat/v0.7-seat1-repeat` by 1 commit**
- **New commit short hash:** `753c7a6`
- **New commit full hash:** `753c7a6e4ccfc56eafa17c166642f13e24d24b84`
- **Commit message:**
  ```
  feat(rtsp): add v0.8 tick-delay stage-level perf logging
  ```

**`git log --oneline -5`:**
```
753c7a6 feat(rtsp): add v0.8 tick-delay stage-level perf logging
64f09ca docs(rtsp): add CTO review for v0.7 Seat1 field verification
fc0c8a6 docs(rtsp): document Seat1 gateway verification and v0.7 follow-ups
fadca98 docs(rtsp): document Seat1 gateway verification and v0.7 follow-ups
0ea218a feat(admin-ai): refresh Seat preview status and expiry UX
```

**Files included in commit:**
- `rtsp-poc/seat1_e2e_test.py`
- `rtsp-poc/preview_clip_capture.py`
- `rtsp-poc/test_seat1_e2e_test.py`
- `rtsp-poc/README.md`
- `rtsp-poc/REVIEW_Seat1_Repeat_v0.7.md`
- `rtsp-poc/cto_handoff_v0.8_tick_perf_logging.md`

**Commit diff summary:** 6 files changed, 805 insertions, 10 deletions.

> Note: this §22 report was added to the handoff file **after** commit `753c7a6`, so it is an uncommitted working-tree change and is not yet part of that commit. It will be included in the next commit/push if approved.

**Security check (commit contents):**
- `.env` not included
- `.env.local` not included
- service role key not included
- `sb_secret_*` not included
- RTSP password not included (masked `rtsp://admin:****@…` only)
- `models/*.pt` not included
- `mp4` / `images` / `temp` / `previews` not included
- `latest.mp4` / `latest.json` not included
- video / image binaries not included

**CTO next decision:**
- **Push approval requested: YES**
- **Field desktop 60-minute perf re-test:** after push
- **Production-grade unattended multi-seat operation:** still NO-GO
