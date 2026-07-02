"""
Seat1 Real Camera E2E Test v0.1 — 테스트(실제 RTSP 불필요, fake 기반).

검증:
  - mask_rtsp: RTSP 비밀번호 마스킹
  - preflight: env/모델 없음에도 안전하게 WARN, service role key 값 비출력
  - --single(fake): 파이프라인 순서(engines→fusion→rule), 결과 요약 생성
  - 일부 engine SKIPPED 여도 pipeline 계속 진행
  - --save 없으면 저장 안 함 / --save 있을 때만 repository.save_decision 호출
  - 저장 실패 시 saved False + errors 기록
  - duration interval 최소값 보정(30초)
  - seat1_e2e_test.py 소스에 update/delete/이미지·영상 저장/학생도메인 코드 없음
  - 기존 RuleEngine/Fusion/Storage 모듈 미파손
"""
import os

import seat1_e2e_test as e2e
from ai_decision_repository import FakeAIDecisionRepository


# ---- 마스킹 ---------------------------------------------------------------
def test_mask_rtsp():
    assert e2e.mask_rtsp("rtsp://admin:secret123@10.0.0.1:554/stream2") \
        == "rtsp://admin:****@10.0.0.1:554/stream2"
    assert "secret123" not in e2e.mask_rtsp("rtsp://admin:secret123@10.0.0.1:554/s")
    assert e2e.mask_rtsp("") == "(none)"
    assert e2e.mask_rtsp(None) == "(none)"
    print("PASS mask_rtsp: 비밀번호 마스킹")


# ---- preflight ------------------------------------------------------------
def test_preflight_safe_and_no_secret():
    sentinel = "SUPER_SECRET_SERVICE_ROLE_VALUE_XYZ"
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = sentinel
    os.environ.setdefault("SUPABASE_URL", "https://x.supabase.co")
    rows = e2e.preflight("Seat1", save=True, fake=True)
    assert isinstance(rows, list) and rows
    # service role key 값이 어떤 메시지에도 출력되지 않아야 한다
    for _level, msg in rows:
        assert sentinel not in msg, "service role key 값이 노출됨"
    # 존재 여부만 OK 로 표시
    assert any("SERVICE_ROLE_KEY 존재" in m for _l, m in rows)
    print("PASS preflight: 안전 점검 + service role key 값 비노출")


# ---- single ---------------------------------------------------------------
def test_single_fake_pipeline_order():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"], fake=True)
    r = runner.run_once()
    assert r["mode"] == "fake" and r["seat_id"] == "Seat1"
    assert r["frame_count"] > 0
    # 엔진 상태 기록 + fusion + rule 결과
    assert set(r["engine_statuses"]) == {"opencv", "mediapipe", "yolo"}
    assert r["fusion_status"] in ("SUCCESS", "PARTIAL")
    assert r["activity"] == "STUDYING"        # fake: 책+사람 시나리오
    assert r["status"] == "SUCCESS"
    assert r["reasons"] and r["decision_uuid"]
    assert r["saved"] is False                # --save 없음
    print("PASS single: engines→fusion→rule 순서 + 요약 생성")


def test_skipped_engine_continues():
    # 알 수 없는 엔진은 SKIPPED, 나머지로 파이프라인 계속
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "bogus", "yolo"], fake=True)
    r = runner.run_once()
    assert r["engine_statuses"]["bogus"] == "SKIPPED"
    assert r["engine_statuses"]["opencv"] == "SUCCESS"
    assert r["decision_uuid"]                  # 계속 진행되어 결정 생성
    print("PASS skipped_engine: 일부 SKIPPED 여도 파이프라인 계속")


# ---- save gating ----------------------------------------------------------
def test_no_save_when_flag_off():
    repo = FakeAIDecisionRepository()
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, save=False, repository=repo)
    r = runner.run_once()
    assert r["saved"] is False
    assert repo.health()["count"] == 0         # 저장 호출 안 됨
    print("PASS no_save: --save 없으면 저장 안 함")


def test_save_when_flag_on():
    repo = FakeAIDecisionRepository()
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, save=True, repository=repo)
    r = runner.run_once()
    assert r["saved"] is True
    assert repo.health()["count"] == 1         # insert 1회
    print("PASS save: --save 있을 때만 repository.save_decision 호출")


def test_save_failure_graceful():
    repo = FakeAIDecisionRepository(fail=True)
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, save=True, repository=repo)
    r = runner.run_once()
    assert r["saved"] is False and r["errors"]
    print("PASS save_fail: 저장 실패 → saved False + errors")


# ---- duration -------------------------------------------------------------
def test_duration_interval_min():
    repo = FakeAIDecisionRepository()
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, save=True, repository=repo)
    # 아주 짧은 시간 + 너무 짧은 interval → 30초로 보정, sleep 없이 1회만
    summary = runner.run_duration(minutes=0.02, interval=5)
    assert summary["interval_seconds"] == e2e.MIN_INTERVAL_SECONDS
    assert summary["total_runs"] >= 1
    assert "activity_counts" in summary and "saved" in summary
    print("PASS duration: interval 최소 30초 보정 + summary 생성")


# ---- 부수효과/소스 스캔 ----------------------------------------------------
def test_camera_seconds_option():
    # --camera-seconds 가 runner 로 전달되고 최소 1초로 보정된다
    r1 = e2e.Seat1E2ERunner(seat="Seat1", camera_seconds=15.0)
    assert r1.camera_seconds == 15.0
    r2 = e2e.Seat1E2ERunner(seat="Seat1", camera_seconds=0.3)
    assert r2.camera_seconds == 1.0      # 최소 1초로 보정
    # CLI 파서에도 노출
    args = e2e.parse_args(["--single", "--camera-seconds", "12"])
    assert args.camera_seconds == 12.0
    print("PASS camera_seconds: --camera-seconds 옵션 전달 + 최소 1초 보정")


def test_no_side_effects_in_source():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "seat1_e2e_test.py"), "r", encoding="utf-8") as f:
        src = f.read().lower()
    # 학생 상태/알림/벌점/출결 + 이미지·영상 저장 + 쓰기(update/delete)
    forbidden = ["penalty_record", "penalty_points", "attendance_record", "power_nap_log",
                 "notification", "membership_status",
                 "imwrite", "imsave", "videowriter", ".update(", ".delete(", ".upload("]
    for tok in forbidden:
        assert tok not in src, f"seat1_e2e_test.py 에 금지 토큰 '{tok}'"
    # 저장은 save_decision(insert) 만 사용
    assert "save_decision" in src
    print("PASS no_side_effects: update/delete/이미지저장/학생도메인 코드 없음")


def test_existing_modules_intact():
    from rule_engine import RuleEngine
    from facts_fusion_engine import FactsFusionEngine
    from ai_decision_storage_pipeline import AIDecisionStoragePipeline
    RuleEngine().initialize()
    FactsFusionEngine().initialize()
    AIDecisionStoragePipeline(save_enabled=False)
    print("PASS intact: RuleEngine/Fusion/Storage 동작 유지")


# ---- preflight cameras.yaml enabled 파싱 ----------------------------------
def test_truthy_string_bool():
    assert e2e._truthy(True) is True
    assert e2e._truthy(False) is False
    assert e2e._truthy("true") is True
    assert e2e._truthy("false") is False        # 문자열 "false" 는 반드시 False
    assert e2e._truthy("True") is True
    assert e2e._truthy("yes") is True
    assert e2e._truthy(0) is False
    assert e2e._truthy(1) is True
    assert e2e._truthy(None) is False
    print("PASS truthy: 문자열/불리언 혼동 방어")


def test_read_seat_enabled_list_form():
    here = os.path.dirname(os.path.abspath(__file__))
    cam = os.path.join(here, "cameras.yaml")   # 실제 list 형식 (Seat1=true, 나머지 false)
    enabled, note = e2e.read_seat_enabled(cam, "Seat1")
    assert enabled is True and note == ""       # 회귀 방지: 리스트 형식에서 true 인식
    enabled2, _ = e2e.read_seat_enabled(cam, "Seat2")
    assert enabled2 is False                     # 실제 false 좌석
    enabled3, note3 = e2e.read_seat_enabled(cam, "Seat99")
    assert enabled3 is None and "항목 없음" in note3
    enabled4, note4 = e2e.read_seat_enabled(os.path.join(here, "no_such.yaml"), "Seat1")
    assert enabled4 is None and note4 == "파일 없음"
    print("PASS read_seat_enabled: list 형식 Seat1=true OK / 없음·실패 구분")


def test_preflight_reports_enabled_ok():
    rows = e2e.preflight("Seat1", save=False, fake=True)
    msgs = [m for _l, m in rows]
    # Seat1 은 enabled=true → OK 로 표시(더 이상 enabled=false 오표시 없음)
    assert any(lvl == "OK" and "cameras.yaml Seat1 enabled=true" in m for lvl, m in rows), msgs
    assert not any("cameras.yaml Seat1 enabled=false" in m for m in msgs)
    print("PASS preflight_enabled: Seat1 enabled=true → OK")


# ---- debug metrics --------------------------------------------------------
_ALLOWED_DEBUG_KEYS = {
    "reason_code", "no_fact_reason", "roi_id", "roi_name", "selected_roi", "roi_applied",
    "brightness", "edge_score", "blur_score", "contrast", "motion_score",
    "frame_quality", "overall_quality", "usable_for_rule_engine",
    "frames_received", "frames_analyzed", "usable_frame_count",
    "discarded_frames", "discard_reasons", "analysis_window_seconds",
    "fact_count", "human_fact_count", "object_fact_count",
    "present_sources", "missing_sources",
    # v0.3 YOLO(object) 세부
    "yolo_requested", "yolo_status", "yolo_model_available", "yolo_model_file",
    "detected_object_count", "detected_labels", "normalized_labels",
    "person_count", "phone_count", "book_count", "laptop_count", "tablet_count",
    "top_object_confidence", "missing_detection_reason",
}


def test_debug_metrics_opencv_only_no_detection_engine():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True, debug_metrics=True)
    r = runner.run_once()
    dbg = r["debug_metrics"]
    assert dbg is not None
    # 키가 허용된 수치/텍스트 메트릭만(이미지/프레임 키 없음)
    assert set(dbg).issubset(_ALLOWED_DEBUG_KEYS), set(dbg) - _ALLOWED_DEBUG_KEYS
    # opencv 만 → 사람/객체 fact 0 → 탐지 엔진 미실행으로 구분
    assert dbg["reason_code"] == "NO_DETECTION_ENGINE"
    assert dbg["human_fact_count"] == 0 and dbg["object_fact_count"] == 0
    assert dbg["frames_received"] > 0 and dbg["frames_analyzed"] > 0   # 카메라/프레임 성공
    assert dbg["present_sources"] == ["opencv"]
    print("PASS debug_metrics: opencv-only → NO_DETECTION_ENGINE(카메라 성공/신호 부족)")


def test_debug_metrics_determined_when_all_engines():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, debug_metrics=True)
    r = runner.run_once()
    dbg = r["debug_metrics"]
    assert dbg["reason_code"] == "DETERMINED"       # STUDYING 판정됨
    assert dbg["fact_count"] > 0
    print("PASS debug_metrics: 전체 엔진 → DETERMINED")


def test_debug_metrics_off_by_default():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True)
    r = runner.run_once()
    assert r["debug_metrics"] is None               # 기본 꺼짐(부하/노이즈 방지)
    args = e2e.parse_args(["--single", "--debug-metrics"])
    assert args.debug_metrics is True               # CLI 노출
    print("PASS debug_metrics: 기본 꺼짐 + --debug-metrics 노출")


def test_debug_metrics_object_fields_with_yolo():
    # opencv,yolo fake(책+사람) → object 세부 메트릭이 채워지고 STUDYING 판정
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "yolo"],
                                fake=True, debug_metrics=True)
    r = runner.run_once()
    dbg = r["debug_metrics"]
    assert set(dbg).issubset(_ALLOWED_DEBUG_KEYS), set(dbg) - _ALLOWED_DEBUG_KEYS
    assert r["activity"] == "STUDYING"
    assert dbg["reason_code"] == "DETERMINED"
    assert dbg["yolo_requested"] is True and dbg["yolo_status"] == "SUCCESS"
    assert dbg["object_fact_count"] > 0
    assert dbg["book_count"] >= 1 and dbg["person_count"] >= 1
    assert "book" in dbg["detected_labels"] and "person" in dbg["detected_labels"]
    assert dbg["top_object_confidence"] and dbg["top_object_confidence"] > 0
    # 검출됐으므로 missing 사유 없음
    assert dbg["missing_detection_reason"] is None
    print("PASS debug_metrics(object): yolo 세부 메트릭 + STUDYING")


def test_debug_metrics_yolo_status_notrequested_opencv_only():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True, debug_metrics=True)
    dbg = runner.run_once()["debug_metrics"]
    assert dbg["yolo_requested"] is False
    assert dbg["yolo_status"] == "NOT_REQUESTED"
    assert dbg["detected_object_count"] == 0
    assert isinstance(dbg["yolo_model_available"], bool)   # 존재 여부 bool(값/경로 비노출)
    assert dbg["missing_detection_reason"]                 # opencv 단독 사유 표기
    print("PASS debug_metrics(object): opencv 단독 → yolo NOT_REQUESTED")


# ==========================================================================
# v0.7 — 반복 안정화(--preview / --forever / tick 격리 / --verify-accumulation)
# ==========================================================================
import pytest

_NOOP_SLEEP = lambda _s: None  # noqa: E731 (테스트 전용 sleep 대체 — 무한 실행 방지)


class _FakeCapturer:
    """preview_clip_capture.PreviewClipCapturer 대체(테스트용). 실카메라/파일 없음."""

    def __init__(self, statuses=None, raise_on=None):
        self.captures = 0
        self.cleanups = 0
        self._statuses = list(statuses) if statuses else None
        self._raise_on = set(raise_on or ())

    def capture(self):
        self.captures += 1
        if self.captures in self._raise_on:
            raise RuntimeError("capture boom")
        if self._statuses:
            status = self._statuses.pop(0) if self._statuses else "available"
        else:
            status = "available"
        return {"status": status, "expires_at": "2026-07-02T00:00:00"}

    def cleanup_expired(self):
        self.cleanups += 1
        return 0


def _stub_run_once(activity="STUDYING", saved=False):
    return {"activity": activity, "confidence": 0.9, "saved": saved, "errors": []}


# ---- --forever / --duration 0 : 테스트는 반드시 max_ticks 로 상한 --------
def test_forever_bounded_by_max_ticks():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    runner.run_once = lambda: _stub_run_once()          # 실카메라 없이
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["forever"] is True
    assert summary["total_runs"] == 3                    # max_ticks 상한에서 정지
    assert summary["interrupted"] is False
    print("PASS forever_bounded: --forever 는 테스트에서 max_ticks 로 상한")


def test_duration_zero_is_forever_in_main(monkeypatch):
    # --duration 0 이 무기한(forever) 경로로 들어가는지 확인(실행은 stub 로 상한)
    captured = {}

    def fake_run_duration(self, minutes, interval, *, forever=False, **kw):
        captured["minutes"] = minutes
        captured["forever"] = forever
        return {"total_runs": 0, "saved": 0, "activity_counts": {}, "interval_seconds": interval,
                "forever": forever, "interrupted": False, "tick_errors": 0,
                "preview_errors": 0, "previews_generated": 0, "cleanup_removed": 0, "runs": []}

    monkeypatch.setattr(e2e.Seat1E2ERunner, "run_duration", fake_run_duration)
    rc = e2e.main(["--duration", "0", "--fake"])
    assert rc == 0 and captured["forever"] is True
    print("PASS duration_zero: --duration 0 → forever 경로")


# ---- tick 예외 격리(run_once/preview/cleanup) -----------------------------
def test_tick_exception_isolated_continues():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    calls = {"n": 0}

    def flaky_run_once():
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("tick2 boom")            # 2번째 tick 만 실패
        return _stub_run_once()

    runner.run_once = flaky_run_once
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["total_runs"] == 2                    # 성공 tick 만 기록
    assert summary["tick_errors"] == 1                   # 실패 tick 격리
    print("PASS tick_isolated: tick 예외가 루프 전체를 중단시키지 않음")


def test_preview_capture_failure_counts_not_fatal():
    cap = _FakeCapturer(statuses=["available", "error", "unavailable"])
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True, preview=True, preview_capturer=cap)
    runner.run_once = lambda: _stub_run_once()
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["total_runs"] == 3                    # 루프는 계속
    assert summary["previews_generated"] == 1            # available 1건
    assert summary["preview_errors"] == 2                # error/unavailable 2건
    assert cap.cleanups == 3                             # 매 tick cleanup 시도
    print("PASS preview_fail: preview 실패는 preview_errors 로 기록, 루프 지속")


def test_preview_capture_exception_isolated():
    cap = _FakeCapturer(raise_on={2})                   # 2번째 capture 는 예외
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True, preview=True, preview_capturer=cap)
    runner.run_once = lambda: _stub_run_once()
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["total_runs"] == 3
    assert summary["preview_errors"] == 1               # 예외도 preview_errors
    assert summary["previews_generated"] == 2
    print("PASS preview_exc: preview capture 예외도 격리 + 카운트")


# ---- 카메라 순차 접근(run_once 종료 후 capture) ---------------------------
def test_preview_is_sequential_after_run_once():
    events = []

    class OrderedCap:
        def capture(self):
            events.append("capture"); return {"status": "available"}

        def cleanup_expired(self):
            events.append("cleanup"); return 0

    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True, preview=True,
                                preview_capturer=OrderedCap())

    def rec_run_once():
        events.append("run"); return _stub_run_once()

    runner.run_once = rec_run_once
    runner.run_duration(0.0, 30, forever=True, max_ticks=2, sleep_fn=_NOOP_SLEEP)
    # tick 마다 run → capture → cleanup 순서(동시 오픈 없음, 순차 접근)
    assert events == ["run", "capture", "cleanup", "run", "capture", "cleanup"]
    print("PASS preview_sequential: run_once 종료 후 capture(카메라 순차)")


# ---- --preview 만 있고 --save 없으면 DB insert 0건 -------------------------
def test_preview_without_save_no_insert():
    repo = FakeAIDecisionRepository()
    cap = _FakeCapturer()
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, save=False, repository=repo,
                                preview=True, preview_capturer=cap)
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["saved"] == 0
    assert repo.health()["count"] == 0                  # insert 절대 없음
    assert cap.captures == 3                             # 클립은 매 tick 생성
    print("PASS preview_no_save: --preview 만 → DB insert 0건")


def test_save_with_preview_inserts_each_tick():
    repo = FakeAIDecisionRepository()
    cap = _FakeCapturer()
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, save=True, repository=repo,
                                preview=True, preview_capturer=cap)
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=2, sleep_fn=_NOOP_SLEEP)
    assert summary["saved"] == 2 and repo.health()["count"] == 2   # append-only 누적
    print("PASS save_preview: --save 동반 시 tick 마다 insert 누적")


# ---- KeyboardInterrupt → 요약 후 정상 종료 --------------------------------
def test_keyboard_interrupt_graceful_summary():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    calls = {"n": 0}

    def ki_run_once():
        calls["n"] += 1
        if calls["n"] == 2:
            raise KeyboardInterrupt()
        return _stub_run_once()

    runner.run_once = ki_run_once
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=10, sleep_fn=_NOOP_SLEEP)
    assert summary["interrupted"] is True               # 정상 종료 플래그
    assert summary["total_runs"] == 1                   # 1번째만 완료
    print("PASS keyboard_interrupt: 요약 출력 후 정상 종료")


# ---- TTL 보정 max(120, interval+30) --------------------------------------
def test_preview_ttl_boot():
    r = e2e.Seat1E2ERunner(seat="Seat1", preview=True, preview_seconds=5)
    assert r._build_capturer(interval=60).ttl_seconds == 120.0     # max(120, 90)
    assert r._build_capturer(interval=200).ttl_seconds == 230.0    # max(120, 230)
    r2 = e2e.Seat1E2ERunner(seat="Seat1", preview=True, preview_ttl=999)
    assert r2._build_capturer(interval=60).ttl_seconds == 999.0    # 명시 TTL 우선
    print("PASS preview_ttl: TTL=max(120, interval+30), 명시값 우선")


# ---- --verify-accumulation 읽기 전용 --------------------------------------
class _ReadOnlyStubRepo:
    def __init__(self, rows):
        self.rows = rows
        self.saved = 0

    def get_recent_by_seat(self, seat_id, limit=20):
        return [r for r in self.rows if r.get("seat_id") == seat_id][:limit]

    def save_decision(self, decision):                  # 호출되면 안 됨
        self.saved += 1
        return {"saved": True}


def test_verify_accumulation_read_only():
    rows = [
        {"seat_id": "Seat1", "activity": "PHONE", "decided_at": "2026-07-02T09:00:00"},
        {"seat_id": "Seat1", "activity": "UNKNOWN", "decided_at": "2026-07-02T09:01:00"},
        {"seat_id": "Seat1", "activity": "ABSENT", "decided_at": "2026-07-02T09:02:00"},
        {"seat_id": "Seat1", "activity": "PHONE", "decided_at": "2026-07-02T09:03:00"},
    ]
    stub = _ReadOnlyStubRepo(rows)
    result = e2e.verify_accumulation("Seat1", limit=50, repository=stub)
    assert stub.saved == 0                              # write 절대 없음
    assert result["total_rows"] == 4
    assert result["activity_counts"] == {"PHONE": 2, "UNKNOWN": 1, "ABSENT": 1}
    assert result["earliest_decided_at"] == "2026-07-02T09:00:00"
    assert result["latest_decided_at"] == "2026-07-02T09:03:00"
    print("PASS verify_accumulation: 읽기 전용 집계(PHONE/UNKNOWN/ABSENT)")


def test_verify_accumulation_rejects_save_and_preview():
    # main() 에서 --verify-accumulation + --save/--preview 는 명확히 에러(rc=2)
    assert e2e.main(["--verify-accumulation", "--save", "--fake"]) == 2
    assert e2e.main(["--verify-accumulation", "--preview", "--fake"]) == 2
    print("PASS verify_guard: --verify-accumulation 은 --save/--preview 와 배타(rc=2)")


# ---- CLI 파서/배타 옵션 ---------------------------------------------------
def test_parse_new_options():
    a = e2e.parse_args(["--forever", "--preview", "--preview-seconds", "7",
                        "--preview-ttl", "300", "--interval", "90"])
    assert a.forever and a.preview and a.preview_seconds == 7.0
    assert a.preview_ttl == 300.0 and a.interval == 90.0
    b = e2e.parse_args(["--verify-accumulation", "--limit", "10"])
    assert b.verify_accumulation is True and b.limit == 10
    print("PASS parse_new: --forever/--preview*/--verify-accumulation/--limit 파싱")


def test_mode_group_mutually_exclusive():
    # --forever 와 --duration 동시 지정은 argparse 가 차단
    with pytest.raises(SystemExit):
        e2e.parse_args(["--forever", "--duration", "5"])
    with pytest.raises(SystemExit):
        e2e.parse_args(["--verify-accumulation", "--single"])
    print("PASS mode_group: 반복/검증 모드 상호 배타")


def test_no_side_effects_in_source_still_clean():
    # v0.7 추가 코드에도 금지 토큰이 없어야 한다(회귀)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "seat1_e2e_test.py"), "r", encoding="utf-8") as f:
        src = f.read().lower()
    for tok in [".update(", ".delete(", ".upload(", "imwrite", "videowriter"]:
        assert tok not in src, f"seat1_e2e_test.py 에 금지 토큰 '{tok}'"
    print("PASS no_side_effects_v07: v0.7 코드에도 update/delete/영상저장 없음")


# ==========================================================================
# v0.8 — tick 단계별 duration 계측(perf logging). 동작 구조 변경 없음(관찰만).
# ==========================================================================
class _SlowRepo(FakeAIDecisionRepository):
    """save_decision 이 약간 걸리게 해 supabase_save_duration 계측을 검증(가짜 DB)."""

    def save_decision(self, decision):
        import time as _t
        _t.sleep(0.02)
        return super().save_decision(decision)


class _TranscodeCapturer:
    """preview meta 의 transcode_duration_seconds 가 perf sample 로 전파되는지 검증."""

    def __init__(self, capture_sleep=0.0, transcode=0.0):
        self.capture_sleep = capture_sleep
        self.transcode = transcode

    def capture(self):
        import time as _t
        if self.capture_sleep:
            _t.sleep(self.capture_sleep)
        return {"status": "available", "transcode_duration_seconds": self.transcode}

    def cleanup_expired(self):
        return 0


def test_perf_sample_per_tick_and_summary_present():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    runner.run_once = lambda: _stub_run_once()
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert len(summary["perf_samples"]) == 3               # tick 마다 perf sample
    assert summary["perf_summary"]["total_perf_samples"] == 3
    for i, s in enumerate(summary["perf_samples"], 1):
        assert s["tick_index"] == i and s["seat_id"] == "Seat1"
    print("PASS perf_sample: tick 마다 perf sample 생성")


def test_perf_summary_keys_in_duration_summary():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    runner.run_once = lambda: _stub_run_once()
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=1, sleep_fn=_NOOP_SLEEP)
    assert "perf_summary" in summary
    ps = summary["perf_summary"]
    for k in ("avg_total_tick_duration", "max_total_tick_duration",
              "avg_schedule_drift_seconds", "max_schedule_drift_seconds",
              "slowest_tick_index", "slowest_tick_breakdown",
              "total_perf_samples", "perf_logging_enabled"):
        assert k in ps, k
    print("PASS perf_summary_keys: 종료 summary 에 perf_summary 필드 포함")


def test_save_duration_only_when_save():
    r_off = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True, save=False,
                               repository=FakeAIDecisionRepository())
    assert r_off.run_once()["perf"]["supabase_save_duration"] == 0.0     # 저장 안 함 → 0
    r_on = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True, save=True,
                              repository=_SlowRepo())
    assert r_on.run_once()["perf"]["supabase_save_duration"] > 0.0        # 저장 경로만 계측
    print("PASS perf_save_duration: --save 일 때만 save 소요시간 기록")


def test_preview_duration_only_when_preview():
    r_off = e2e.Seat1E2ERunner(seat="Seat1", fake=True, preview=False)
    r_off.run_once = lambda: _stub_run_once()
    s_off = r_off.run_duration(0.0, 30, forever=True, max_ticks=1, sleep_fn=_NOOP_SLEEP)
    assert s_off["perf_samples"][0]["preview_capture_duration"] == 0.0    # preview 없음 → 0
    assert s_off["perf_samples"][0]["preview_transcode_duration"] == 0.0
    cap = _TranscodeCapturer(capture_sleep=0.02, transcode=1.234)
    r_on = e2e.Seat1E2ERunner(seat="Seat1", fake=True, preview=True, preview_capturer=cap)
    r_on.run_once = lambda: _stub_run_once()
    sample = r_on.run_duration(0.0, 30, forever=True, max_ticks=1,
                               sleep_fn=_NOOP_SLEEP)["perf_samples"][0]
    assert sample["preview_capture_duration"] > 0.0
    assert sample["preview_transcode_duration"] == 1.234                  # 메타에서 전파
    print("PASS perf_preview_duration: --preview 일 때만 capture/transcode 소요시간 기록")


def test_perf_summary_generated_even_on_preview_failure():
    cap = _FakeCapturer(statuses=["error", "unavailable", "error"])
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True, preview=True, preview_capturer=cap)
    runner.run_once = lambda: _stub_run_once()
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["perf_summary"]["total_perf_samples"] == 3             # 실패에도 요약 생성
    assert summary["preview_errors"] == 3
    assert all(s["preview_error"] is True for s in summary["perf_samples"])
    print("PASS perf_preview_fail: preview 실패에도 perf_summary 생성")


def test_perf_sample_kept_on_tick_exception():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return _stub_run_once()

    runner.run_once = flaky
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=3, sleep_fn=_NOOP_SLEEP)
    assert summary["perf_summary"]["total_perf_samples"] == 3             # 예외 tick 도 sample 남김
    failed = [s for s in summary["perf_samples"] if s["tick_error"]]
    assert len(failed) == 1 and failed[0]["tick_index"] == 2
    print("PASS perf_tick_exc: tick 예외에도 perf sample 남음(tick_error=True)")


def test_perf_sample_values_are_scalar_no_binary():
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)
    runner.run_once = lambda: _stub_run_once()
    summary = runner.run_duration(0.0, 30, forever=True, max_ticks=2, sleep_fn=_NOOP_SLEEP)
    for s in summary["perf_samples"]:
        for k, v in s.items():
            assert isinstance(v, (int, float, str, bool, type(None))), (k, type(v))
    print("PASS perf_scalar: perf sample 은 수치/문자/불리언만(영상/바이너리 없음)")


def test_perf_logging_enabled_reflects_flag():
    r = e2e.Seat1E2ERunner(seat="Seat1", fake=True, perf_log=False)
    r.run_once = lambda: _stub_run_once()
    s = r.run_duration(0.0, 30, forever=True, max_ticks=1, sleep_fn=_NOOP_SLEEP)
    assert s["perf_summary"]["perf_logging_enabled"] is False
    print("PASS perf_enabled_flag: perf_summary.perf_logging_enabled 가 --no-perf-log 반영")


def test_perf_log_line_format_and_prefix():
    sample = {"tick_index": 7, "seat_id": "Seat1", "total_tick_duration": 84.2,
              "schedule_drift_seconds": 24.2, "camera_start_wait": 1.1, "warmup_duration": 3.0,
              "frame_collect_duration": 5.0, "inference_duration": 0.2,
              "supabase_save_duration": 0.4, "camera_stop_duration": 0.8,
              "preview_capture_duration": 7.1, "preview_transcode_duration": 2.3,
              "cleanup_duration": 0.0, "sleep_until_next_tick_duration": 0.0,
              "reconnects": 0, "saved": True, "preview_status": "available",
              "tick_error": False, "preview_error": False}
    line = e2e._format_perf_line(sample)
    assert line.startswith("[perf Seat1] tick=7")
    assert "total=84.2s" in line and "drift=24.2s" in line
    assert "preview_capture=7.1s" in line and "transcode=2.3s" in line
    assert "saved=True" in line and "preview=available" in line and "errors=0" in line
    print("PASS perf_line: [perf Seat1] 한 줄 요약 형식/접두사")


def test_parse_perf_log_flag():
    assert e2e.parse_args(["--duration", "1"]).perf_log is True           # 기본 켜짐
    assert e2e.parse_args(["--duration", "1", "--no-perf-log"]).perf_log is False
    assert e2e.parse_args(["--duration", "1", "--perf-log"]).perf_log is True
    print("PASS parse_perf_log: --perf-log/--no-perf-log 파싱(기본 켜짐)")


# ==========================================================================
# v0.8 P1 — drift-aware scheduler. 주입 가능한 단조 시계로 결정론적 검증.
#   sleep_fn 은 fake clock 을 전진시켜 실제 타임라인을 시뮬레이션(무한 실행 없음).
# ==========================================================================
class _FakeClock:
    """monotonic_fn/sleep_fn 주입용 결정론 시계. run_once 가 work 만큼 전진시킨다."""

    def __init__(self):
        self.t = 0.0

    def monotonic(self):
        return self.t

    def sleep(self, secs):          # sleep_fn: 실제 sleep 대신 시계만 전진
        self.t += float(secs)

    def advance(self, secs):        # run_once 작업시간 시뮬레이션
        self.t += float(secs)


def _clocked_runner(clock, work):
    """run_once 가 매 tick clock 을 work 초 전진시키는 runner(실카메라/DB 없음)."""
    runner = e2e.Seat1E2ERunner(seat="Seat1", fake=True)

    def _run_once():
        clock.advance(work)         # tick_start_mono → tick_end_mono 사이에서 호출됨
        return _stub_run_once()

    runner.run_once = _run_once
    return runner


def test_drift_aware_sleep_subtracts_work_time():
    # 작업(work) < interval → sleep ≈ interval - work, late ≈ 0, overrun False
    clock = _FakeClock()
    interval, work = 60.0, 19.5
    runner = _clocked_runner(clock, work)
    summary = runner.run_duration(0.0, interval, forever=True, max_ticks=4,
                                  sleep_fn=clock.sleep, monotonic_fn=clock.monotonic)
    samples = summary["perf_samples"]
    # 마지막 tick 은 max_ticks 도달로 sleep 안 함(0). 그 외 tick 은 interval-work 만큼 sleep.
    for s in samples[:-1]:
        assert abs(s["sleep_until_next_tick_duration"] - (interval - work)) < 1e-6, s
    assert samples[-1]["sleep_until_next_tick_duration"] == 0.0
    for s in samples:
        assert s["tick_started_late_by_seconds"] < 1e-6                 # grid 정시 시작
        assert s["scheduler_overrun"] is False
        assert s["schedule_drift_seconds"] == 0.0
    print("PASS drift_sleep: 작업<interval → sleep≈interval-work, drift 0, 정시 시작")


def test_drift_aware_no_accumulation_across_ticks():
    # fixed sleep 였다면 tick 시작이 (n-1)*(interval+work) 로 누적 지연.
    # drift-aware 는 tick n 이 정확히 (n-1)*interval 에 시작해야 한다(누적 없음, late≈0).
    clock = _FakeClock()
    interval, work = 60.0, 19.5
    max_ticks = 5
    runner = _clocked_runner(clock, work)
    summary = runner.run_duration(0.0, interval, forever=True, max_ticks=max_ticks,
                                  sleep_fn=clock.sleep, monotonic_fn=clock.monotonic)
    for s in summary["perf_samples"]:
        assert s["tick_started_late_by_seconds"] < 1e-6                 # 모든 tick 정시 시작
    # N tick = (N-1) sleep + N work. 마지막 tick 후 sleep 없음 → t=(N-1)*interval+work.
    assert abs(clock.t - ((max_ticks - 1) * interval + work)) < 1e-6, clock.t
    # fixed-sleep(cycle=interval+work) 였다면 t=N*work+(N-1)*interval 로 더 컸다.
    assert clock.t < max_ticks * work + (max_ticks - 1) * interval
    print("PASS drift_no_accum: tick 시작이 grid 에 정렬(작업시간 누적 없음)")


def test_drift_aware_overrun_zero_sleep_and_records_drift():
    # 작업 > interval → sleep=0, overrun True. 고정 grid 라 overrun 은 tick 마다 누적된다.
    #   tick n: drift = n*(work-interval), late = (n-1)*(work-interval).
    clock = _FakeClock()
    interval, work = 60.0, 75.0
    over = work - interval                                             # 15.0
    runner = _clocked_runner(clock, work)
    summary = runner.run_duration(0.0, interval, forever=True, max_ticks=3,
                                  sleep_fn=clock.sleep, monotonic_fn=clock.monotonic)
    for i, s in enumerate(summary["perf_samples"]):
        n = i + 1
        assert s["sleep_until_next_tick_duration"] == 0.0              # negative sleep 아님
        assert s["scheduler_overrun"] is True
        assert abs(s["schedule_drift_seconds"] - n * over) < 1e-6, s
        assert abs(s["tick_started_late_by_seconds"] - (n - 1) * over) < 1e-6, s
    assert summary["perf_summary"]["scheduler_overrun_count"] == 3
    print("PASS drift_overrun: 작업>interval → sleep 0, overrun/late 누적 기록")


def test_drift_aware_duration_mode_no_fixed_sleep_accumulation():
    # duration 모드에서 fixed sleep(작업+interval) 로 누적 지연되지 않는지.
    clock = _FakeClock()
    interval, work = 30.0, 5.0
    runner = _clocked_runner(clock, work)
    # deadline = 1.5분 = 90초. grid(0,30,60,90) 기준 tick 이 4회 실행돼야 한다.
    summary = runner.run_duration(1.5, interval, sleep_fn=clock.sleep,
                                  monotonic_fn=clock.monotonic)
    # fixed-sleep(cycle=interval+work=35) 였다면 90초에 3회. drift-aware(cycle=interval)는 더 많음.
    assert summary["total_runs"] >= 4, summary["total_runs"]
    for s in summary["perf_samples"]:
        assert s["tick_started_late_by_seconds"] < 1e-6               # 정시 시작(누적 없음)
    print("PASS drift_duration: duration 모드도 작업시간 누적 지연 없음")


def test_scheduler_perf_fields_present_in_samples_and_summary():
    clock = _FakeClock()
    runner = _clocked_runner(clock, 5.0)
    summary = runner.run_duration(0.0, 60.0, forever=True, max_ticks=2,
                                  sleep_fn=clock.sleep, monotonic_fn=clock.monotonic)
    for s in summary["perf_samples"]:
        for k in ("scheduled_tick_start_at", "actual_tick_start_at",
                  "next_scheduled_tick_start_at", "tick_started_late_by_seconds",
                  "total_tick_duration", "sleep_until_next_tick_duration",
                  "schedule_drift_seconds", "scheduler_overrun"):
            assert k in s, k
    ps = summary["perf_summary"]
    for k in ("avg_tick_started_late_by_seconds", "max_tick_started_late_by_seconds",
              "scheduler_overrun_count"):
        assert k in ps, k
    print("PASS scheduler_fields: sample/summary 에 scheduler perf 필드 포함")


def test_drift_aware_save_gating_and_read_only_verify():
    # drift-aware 루프에서도 --save 일 때만 insert(append-only), verify 는 read-only 유지.
    c1 = _FakeClock()
    repo_off = FakeAIDecisionRepository()
    r_off = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True,
                               save=False, repository=repo_off)
    r_off.run_duration(0.0, 60.0, forever=True, max_ticks=3,
                       sleep_fn=c1.sleep, monotonic_fn=c1.monotonic)
    assert repo_off.health()["count"] == 0                            # --save 없음 → insert 0

    c2 = _FakeClock()
    repo_on = FakeAIDecisionRepository()
    r_on = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True,
                              save=True, repository=repo_on)
    r_on.run_duration(0.0, 60.0, forever=True, max_ticks=3,
                      sleep_fn=c2.sleep, monotonic_fn=c2.monotonic)
    assert repo_on.health()["count"] == 3                             # tick 마다 insert 만

    # verify_accumulation 은 select 만(insert/update/delete 없음) → count 불변
    before = repo_on.health()["count"]
    e2e.verify_accumulation("Seat1", limit=50, repository=repo_on)
    assert repo_on.health()["count"] == before                        # read-only
    print("PASS drift_gating: --save 만 insert, verify read-only(누적 없음)")


def test_verify_accumulation_does_not_run_perf_loop(monkeypatch):
    called = {"run": False}

    def boom_run_duration(self, *a, **k):
        called["run"] = True
        raise AssertionError("verify-accumulation 이 perf loop 를 돌리면 안 됨")

    monkeypatch.setattr(e2e.Seat1E2ERunner, "run_duration", boom_run_duration)
    monkeypatch.setattr(e2e, "verify_accumulation",
                        lambda seat, limit, repository=None: {
                            "seat_id": seat, "total_rows": 0, "activity_counts": {},
                            "earliest_decided_at": None, "latest_decided_at": None})
    rc = e2e.main(["--verify-accumulation", "--seat", "Seat1", "--fake"])
    assert rc == 0 and called["run"] is False
    print("PASS verify_no_perf_loop: --verify-accumulation 은 read-only(perf loop 없음)")


def main():
    test_mask_rtsp()
    test_preflight_safe_and_no_secret()
    test_single_fake_pipeline_order()
    test_skipped_engine_continues()
    test_no_save_when_flag_off()
    test_save_when_flag_on()
    test_save_failure_graceful()
    test_duration_interval_min()
    test_camera_seconds_option()
    test_no_side_effects_in_source()
    test_existing_modules_intact()
    test_truthy_string_bool()
    test_read_seat_enabled_list_form()
    test_preflight_reports_enabled_ok()
    test_debug_metrics_opencv_only_no_detection_engine()
    test_debug_metrics_determined_when_all_engines()
    test_debug_metrics_off_by_default()
    test_debug_metrics_object_fields_with_yolo()
    test_debug_metrics_yolo_status_notrequested_opencv_only()
    # v0.7 (monkeypatch fixture 필요한 test_duration_zero_is_forever_in_main 은 pytest 로만 실행)
    test_forever_bounded_by_max_ticks()
    test_tick_exception_isolated_continues()
    test_preview_capture_failure_counts_not_fatal()
    test_preview_capture_exception_isolated()
    test_preview_is_sequential_after_run_once()
    test_preview_without_save_no_insert()
    test_save_with_preview_inserts_each_tick()
    test_keyboard_interrupt_graceful_summary()
    test_preview_ttl_boot()
    test_verify_accumulation_read_only()
    test_verify_accumulation_rejects_save_and_preview()
    test_parse_new_options()
    test_mode_group_mutually_exclusive()
    test_no_side_effects_in_source_still_clean()
    # v0.8 perf(계측) — monkeypatch fixture 필요한 test 는 pytest 로만 실행
    test_perf_sample_per_tick_and_summary_present()
    test_perf_summary_keys_in_duration_summary()
    test_save_duration_only_when_save()
    test_preview_duration_only_when_preview()
    test_perf_summary_generated_even_on_preview_failure()
    test_perf_sample_kept_on_tick_exception()
    test_perf_sample_values_are_scalar_no_binary()
    test_perf_logging_enabled_reflects_flag()
    test_perf_log_line_format_and_prefix()
    test_parse_perf_log_flag()
    # v0.8 P1 — drift-aware scheduler
    test_drift_aware_sleep_subtracts_work_time()
    test_drift_aware_no_accumulation_across_ticks()
    test_drift_aware_overrun_zero_sleep_and_records_drift()
    test_drift_aware_duration_mode_no_fixed_sleep_accumulation()
    test_scheduler_perf_fields_present_in_samples_and_summary()
    test_drift_aware_save_gating_and_read_only_verify()
    print("\nALL PASS: mask / preflight / single / skipped_engine / no_save / save / "
          "save_fail / duration / no_side_effects / intact / truthy / read_seat_enabled / "
          "preflight_enabled / debug_metrics / debug_metrics(object) / "
          "v0.7(forever/tick격리/preview/verify-accumulation)")


if __name__ == "__main__":
    main()
