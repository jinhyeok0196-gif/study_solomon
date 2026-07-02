# CTO Review — v0.7 Seat1 Real RTSP Field Verification

> Solomon Study Cafe — AI Learning Management MVP
> Standalone review document. Copy-paste ready for CTO / external technical reviewer.
>
> **AI decisions are an advisory signal only. STABLE is not a final adjudication.**
> Student state / attendance / penalty / notification / guardian contact are **not** mutated automatically.

- Date: 2026-07-02
- Branch: `feat/v0.7-seat1-repeat`
- Seat under test: Seat1 (TP-Link VIGI substream `stream2`)
- RTSP (masked, masking-only allowed): `rtsp://admin:****@192.168.219.50:554/stream2`
- Engineering detail (progress/checklist): `rtsp-poc/REVIEW_Seat1_Repeat_v0.7.md`
- Commits / test counts: see §17 Appendix

---

## 1. Executive Summary

Seat1 real RTSP 60-minute save + preview field verification passed.

This is not a failure — as an **MVP technical verification it is a success**. It confirms the field structure works end-to-end. It does **not** yet make this a "production, always-on product": tick-delay behavior, long-duration operation, multi-seat expansion, and automated recovery are not yet verified.

Mandatory conclusions:

1. **Seat1 v0.7 field verification is approved for continued controlled testing.**
2. The test validates **real-field loop survivability, RTSP access, append-only Supabase insert, local preview generation, and browser-compatible preview playback.**
3. This approval **does not cover strict one-minute scheduling accuracy, AI classification accuracy, multi-seat operation, unattended production operation, or automated attendance/penalty mutation.**
4. **AI decisions remain advisory only and do not automatically mutate attendance, student state, penalty, notification, or guardian-contact flows.**
5. **No video/frame binaries are persisted to the database; latest.mp4/latest.json are local temporary preview artifacts.**

한국어 결론:

> "Seat1 v0.7 현장 검증은 제한된 현장 테스트 지속을 승인한다. 이번 검증은 실제 현장 환경에서 RTSP 접근, 반복 루프 생존성, Supabase append-only 저장, 로컬 preview 생성, 브라우저 재생 구조가 동작함을 확인한 것이다. 다만 1분 주기 정확도, AI 판정 정확도, 다좌석 운영, 무인 상시 운영, 출결/벌점 자동 변경은 승인 범위에 포함하지 않는다."

---

## 2. CTO Decision

- **GO** — Continue **controlled Seat1 field testing** (dashboard preview observation, append-only accumulation checks, instrumentation and operational hardening).
- **NO-GO** — **Do not run production-grade unattended multi-seat operation** yet. Do not enable automatic attendance / penalty / notification / guardian-contact mutation. Do not claim production readiness, strict one-minute cadence, or AI classification accuracy from this test.
- **Precondition for operational hardening:** add per-stage tick duration logging (§11) before diagnosing/curing the scheduling delay.

(Full actionable GO / NO-GO lists in §13.)

---

## 3. Scope

On the field desktop gateway with the real Seat1 camera, v0.7 STAGE 2 field verification covers:

- Repeated per-tick judgment loop over one RTSP camera (`seat1_e2e_test.py`); judging engine and clip capture accessed **sequentially, never concurrently** (camera shut down before clip capture).
- `--save` path: append-only insert of RuleDecision **metadata** into Supabase `ai_rule_decisions`.
- `--preview` path: 5-second local clip regeneration (`latest.mp4` / `latest.json`), H.264, browser-playable.
- `--verify-accumulation` path: read-only accumulation check by seat.
- Loop survivability across a 60-minute continuous run under real RTSP conditions.
- Browser playback of the preview in the admin dashboard via the local preview bridge.

---

## 4. Explicit Non-goals / Not Validated

- **Strict one-minute scheduling accuracy** — NOT validated (see §11).
- **AI classification accuracy** — NOT validated. This is **not** an AI accuracy test. `activity_counts` being predominantly `UNKNOWN` is **not a failure** for this verification's purpose; YOLO/MediaPipe models are not deployed in the field (preflight WARN, non-blocking for preview/loop verification). Real AI accuracy verification will first require **model deployment, ROI configuration, and ground-truth labeling.**
- **Multi-seat operation (Seat2–Seat8)** — NOT validated (Seat1 only).
- **Unattended production operation** — NOT validated (longest continuous run is 60 minutes; no automated recovery verification).
- **Automatic mutation** of attendance / student state / penalty / notification / guardian contact — never performed; AI output is advisory only. **STABLE is not a final adjudication.**
- **Video/frame binaries in DB** — never stored; DB holds decision metadata only.
- **Event Evidence Clip** and **Solomon Focus Certificate** — out of v0.7 scope (long-term follow-ups; see §15).

What this verification's purpose actually is: real RTSP loop survivability · DB append insert path · preview clip generation · browser-compatible playback · read-only accumulation verification.

---

## 5. Test Environment

- Reference machine: **field desktop gateway PC** (always-on), path `C:\solomon\study_solomon-main`. Laptop is dev/aux only, not the operational machine.
- `.env` present (local only, never committed); RTSP URL present and shown masked in logs.
- `cameras.yaml`: Seat1 `enabled=true`.
- Runtime confirmed at preflight: CameraManager importable, OpenCV engine ready, RuleEngine ready, FactsFusionEngine ready.
- Supabase: `SUPABASE_URL` present; `SUPABASE_SERVICE_ROLE_KEY` **present (existence confirmed only; value never displayed or committed)**.
- `supabase` Python package: **initially missing** → first `--verify-accumulation` failed with `ModuleNotFoundError: No module named 'supabase'`; resolved via `pip install supabase`. **Now reflected in `requirements.txt` (`supabase>=2.0.0`).**
- Model warnings (non-blocking for v0.7 preview/loop verification): MediaPipe model absent (WARN), YOLO model absent (WARN).
- Preview transcoding: ffmpeg present (H.264), `transcode=success`.

---

## 6. Commands Executed

```bash
# Preflight (field readiness)
python seat1_e2e_test.py --preflight --seat Seat1

# (A) 10-minute NO-SAVE preview test — must not write DB
python seat1_e2e_test.py --duration 10 --interval 60 --preview --seat Seat1

# supabase package was missing → installed before save/verify path
python -m pip install supabase
python -c "import supabase; print('supabase ok')"

# (B) Baseline accumulation check (read-only)
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 50

# (C) 10-minute SAVE + preview test
python seat1_e2e_test.py --duration 10 --interval 60 --save --preview --seat Seat1

# (D) Accumulation check after 10-min save (read-only)
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 50

# (E) 60-minute SAVE + preview stability test
python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1

# (F) Final accumulation check after 60-min test (read-only)
python seat1_e2e_test.py --verify-accumulation --seat Seat1 --limit 100
```

---

## 7. Results Summary

| # | Test | Command flags | total_runs | saved | previews_generated | tick_errors | preview_errors | interrupted | cleanup_removed |
|---|------|---------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| A | 10-min no-save preview | `--duration 10 --interval 60 --preview` | 4 | **0** | 4 | 0 | 0 | False | 0 |
| C | 10-min save + preview | `--duration 10 --interval 60 --save --preview` | 8 | **8** | 8 | 0 | 0 | False | 0 |
| E | 60-min save + preview | `--duration 60 --interval 60 --save --preview` | **32** | **32** | **32** | **0** | **0** | **False** | 0 |

- Test E `activity_counts`: `{'UNKNOWN': 32}` (expected — models not deployed; not an accuracy test, see §4).
- Supabase `POST HTTP/2 201 Created` repeated; each preview `status=available`, `codec=h264`, `browser_compatible=True`, `transcode=success`.

Accumulation checks (`--verify-accumulation`, read-only, `HTTP/2 200 OK`):

| Point | When | limit | total_rows | activity_counts |
|-------|------|:---:|:---:|---|
| B | baseline (before save) | 50 | 12 | UNKNOWN 9, ABSENT 1, PHONE 1, STUDYING 1 |
| D | after 10-min save | 50 | **20** | UNKNOWN 17, ABSENT 1, PHONE 1, STUDYING 1 |
| F | after 60-min save | 100 | **52** | UNKNOWN 49, ABSENT 1, PHONE 1, STUDYING 1 |

**Accumulation reconciliation (DB consistency):** 12 → 20 → 52. `12 + 8 (test C) = 20`; `20 + 32 (test E) = 52`. Monotonic and exact.

---

## 8. Data Persistence Verification

- Writes occur **only** under `--save` (single source gate `if self.save:` → `repo.save_decision`). No-save run (Test A) produced `saved=0` and no insert.
- Insert path is **append-only**: `POST … 201 Created` per tick; no update/delete. Confirmed by monotonic `total_rows` (12 → 20 → 52) matching insert counts exactly.
- `--verify-accumulation` is **read-only**: `get_recent_by_seat` only, `HTTP 200`, no writes; rejects `--save`/`--preview` combination (exit code 2).
- **No video/frame binaries in the database.** DB stores decision metadata only.

---

## 9. Preview / Video Handling Verification

- Per tick (Test E: 32/32), `latest.mp4` / `latest.json` regenerated: `status=available`, `codec=h264`, `browser_compatible=True`, `transcode=success`.
- Judging camera (CameraManager) and clip capture (cv2) accessed **sequentially** — `run_once()` shuts the camera down before clip capture; no concurrent open of the same RTSP source.
- Browser playback of `latest.mp4` succeeded in the admin dashboard via the local preview bridge (`127.0.0.1:8765`, local-only).
- `latest.mp4` / `latest.json` are **local temporary preview artifacts** (per-seat overwrite + TTL cleanup); `cleanup_removed=0` because new clips regenerated within TTL. No unbounded disk growth observed within the 60-minute window.

---

## 10. Safety and Product Constraints (all upheld)

- AI judgment is an **advisory signal**, not an automatic state change. **STABLE is not a final adjudication.**
- Student state / attendance / penalty / notification / guardian contact: **not mutated automatically** (source-level forbidden-token scan enforced in py/tsx).
- `ai_rule_decisions` is **append-only**; insert occurs **only** with `--save`; `--verify-accumulation` is **read-only**.
- **No video/frame binaries persisted to DB.** `latest.mp4` / `latest.json` are **local temporary preview artifacts only**.

Security / sensitive-data principles (re-stated):
- **RTSP URL: masking only** — full credentials never written to docs/logs.
- **Service-role key: existence mentioned only, value NEVER displayed.**
- **Never commit:** `.env`, `.env.local`, service-role key, `sb_secret_*`, RTSP password, `models/*.pt`, `mp4/images/temp/previews`.
- **Preview bridge is `127.0.0.1` local-only; no external exposure.**
- **Video/frame binaries are never stored in the DB.**

---

## 11. Known Observations: Tick Delay

**Observed:**
- 60-minute test: `total_runs = 32` (not exactly 60 ticks in 60 minutes).
- Delay gaps observed, e.g. `17:12:55 → 17:18:51` and `17:27:52 → 17:39:57`.

**Impact:**
- Strict one-minute cadence **not validated**.
- However, the loop **did not crash**.
- `saved 32/32` succeeded.
- `previews 32/32` succeeded.
- `tick_errors = 0`, `preview_errors = 0`, `interrupted = False`.

**Root cause:**
- **The root cause of the observed scheduling delay was not determined in this test.**
- Candidate causes include process scheduling, sleep/drift behavior, blocking I/O, preview transcoding, RTSP/OpenCV open/close latency, Windows power/background scheduling, or remote-desktop environment effects.
- We do **not** attribute this to RTSP dropouts — logs showed a repeated `reconnects=0` flow.

**Required next step — add stage-level duration logging per tick:**
`camera_start_wait`, `warmup_duration`, `frame_collect_duration`, `inference_duration`, `supabase_save_duration`, `camera_stop_duration`, `preview_capture_duration`, `preview_transcode_duration`, `total_tick_duration`, `sleep_until_next_tick_duration`, `schedule_drift_seconds`.

---

## 12. Risk Assessment

- **Scheduling drift:** effective cadence deviated from 1 minute (32 ticks / 60 min). No downstream logic currently depends on 1-minute density (advisory only), but this must not be claimed as accurate.
- **Delay root cause unknown:** without per-stage instrumentation (§11) the cause cannot be isolated.
- **AI accuracy unexercised:** models absent → activity dominated by `UNKNOWN`. Structural verification only; classification quality is unverified.
- **Duration ceiling of evidence:** longest continuous run verified is 60 minutes. Unattended all-day behavior (disk/memory/log growth, RTSP open/close accumulation) not yet evidenced.
- **Single seat:** only Seat1 verified; multi-seat sequential load unproven.
- **Recovery unverified:** automated restart / failure-recovery behavior not tested.
- **Save-path dependency:** `supabase` was missing on first field run; now in `requirements.txt`, must be reproduced on redeploy.
- **Local preview exposure:** bridge must remain `127.0.0.1`-only; accidental external exposure would be a risk.

---

## 13. Go / No-Go Decision

**GO — approved to continue:**
- Continue controlled Seat1 field testing.
- Continue dashboard preview observation.
- Continue append-only `ai_rule_decisions` accumulation checks.
- Continue instrumentation and operational hardening.

**NO-GO — not approved / do not claim:**
- Do not claim production readiness.
- Do not run unattended multi-seat production operation yet.
- Do not enable automatic attendance, penalty, notification, or guardian-contact mutation.
- Do not claim strict 60 ticks / 60 minutes scheduling accuracy.
- Do not claim AI classification accuracy based on this test.
- Do not store video/frame binaries in DB.

---

## 14. Required Follow-up Work

**P0 (before operational hardening):**
- Add per-stage tick duration logging (§11 field list).
- Confirm `supabase` reflected in `requirements.txt` — **done (`supabase>=2.0.0`)**; verify `pip install -r requirements.txt` reproduces the field environment on redeploy.
- Confirm admin read migration applied on the remote (`20260709000000_ai_rule_decisions_admin_read.sql`, read-only RLS + realtime).
- Codify preview-bridge `127.0.0.1` local-only security principle (no external exposure).
- Inspect Windows power / sleep / display-off / remote-desktop effects on the loop.

**P1:**
- ≥ 8-hour long-duration soak test.
- Log rotation policy.
- Task Scheduler / service auto-restart procedure.
- Post-failure recovery procedure documentation.
- Preview-bridge and loop process operational model.

**P2:**
- Seat2–Seat8 RTSP / ROI verification.
- Multi-seat sequential-processing load test.
- YOLO / MediaPipe model deployment.
- Ground-truth labeling for AI accuracy testing.
- Event Evidence Clip separated to v0.8 / v0.9+.

---

## 15. Next Milestones

- **v0.8 (proposed):** tick-delay instrumentation + scheduling decision; ≥ half-day soak test; log rotation; preview-bridge always-on operational procedure; Windows power/remote-desktop hardening.
- **v0.9 (proposed):** YOLO/MediaPipe model deployment → real AI accuracy testing (ROI + ground-truth labeling); Seat2–Seat8 per-camera RTSP/ROI verification and multi-seat sequential operation.
- **Later (out of core scope):** Event Evidence Clip (metadata-only, file clips, admin-review-gated, appeal-capable); Solomon Focus Certificate (learning-process certificate) — long-term vision.
- Throughout: AI remains advisory; no automatic student-state / attendance / penalty / notification / guardian-contact mutation.

---

## 16. Final CTO Checklist

The following checklist is intentionally left unchecked for CTO/manual reviewer sign-off.

아래 체크리스트는 CTO/검토자의 수동 승인용으로 의도적으로 미체크 상태로 둔다.

- [ ] Accept: Seat1 60-min save+preview passed **32/32 inserts and 32/32 previews** under real RTSP.
- [ ] Accept: verification covers **loop survivability, RTSP access, append-only insert path, local browser-compatible preview** — **not** strict one-minute scheduling accuracy, **not** AI classification accuracy.
- [ ] Accept: AI stays advisory; no auto-mutation of attendance / student state / penalty / notification / guardian contact; STABLE is not final.
- [ ] Accept: no video/frame binaries in DB; `latest.mp4`/`latest.json` are local temporary preview artifacts.
- [ ] Accept: `ai_rule_decisions` append-only; insert only under `--save`; `--verify-accumulation` read-only.
- [ ] Accept **GO**: continue controlled Seat1 field testing (§13 GO).
- [ ] Accept **NO-GO**: no unattended multi-seat production; no automated attendance/penalty/notification/guardian mutation; no production-readiness / cadence / AI-accuracy claims (§13 NO-GO).
- [ ] Confirm P0: per-stage duration logging planned (§11); `supabase` in `requirements.txt` reproduced on redeploy; admin read migration applied on remote; preview-bridge local-only codified; Windows power/remote-desktop effects inspected (§14 P0).
- [ ] Approve/hold: proceed to P1 (≥8h soak, log rotation, auto-restart, recovery) and P2 (Seat2–Seat8, models, ground-truth labeling) planning (§14).

---

## 17. Appendix: Evidence Logs / Commits / Test Counts

**Evidence logs (summary):**
- Preflight: `.env` present · RTSP URL present & masked · Seat1 `enabled=true` · CameraManager import OK · OpenCV/Rule/FactsFusion engines ready · `SUPABASE_URL` present · `SUPABASE_SERVICE_ROLE_KEY` present (existence only) · MediaPipe/YOLO model WARN (non-blocking).
- supabase package: first `--verify-accumulation` failed (`ModuleNotFoundError`, `RuntimeError: supabase 파이썬 패키지가 필요합니다`); `.env`/service-role fine (`SUPABASE_URL True`, `SERVICE_ROLE True`); fixed via `pip install supabase` → `supabase ok`.
- Test A: `total_runs=4, saved=0, previews_generated=4, preview_errors=0`, `{UNKNOWN:4}`; browser preview active; `latest.mp4` H.264 played; no `--save` → no DB write.
- Test C: `saved=8`, `POST HTTP/2 201` ×8, Tick 1–8 `saved=True preview=available`.
- Test E: `total_runs=32, saved=32, previews_generated=32, tick_errors=0, preview_errors=0, interrupted=False, cleanup_removed=0`; `POST HTTP/2 201` ×32; each preview `status=available, codec=h264, browser_compatible=True, transcode=success`.
- Accumulation B/D/F: `HTTP/2 200 OK`, read-only, `total_rows` 12 → 20 → 52.

**Commits:**
- `f218c8f` — feat(rtsp): Seat1 repeat loop preview + accumulation verification (Python).
- `0ea218a` — feat(admin-ai): refresh Seat preview status and expiry UX (Frontend).
- `fc0c8a6` — docs(rtsp): Seat1 gateway verification + v0.7 follow-ups.

**Test counts (referenced from prior verified runs, not re-run in this field test):**
- Python: `pytest test_seat1_e2e_test.py` → 34 passed; full regression → 158 passed.
- Frontend: `npm run test -- admin-ai-decisions` → 51 passed.
- Build: `npm run build` (incl. `tsc --noEmit`) → OK.

**Dependencies:** `rtsp-poc/requirements.txt` includes `supabase>=2.0.0` (required for `--save` / `--verify-accumulation`). Model binaries (`models/*.pt`) are never committed.
