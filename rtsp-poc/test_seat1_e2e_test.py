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
    print("\nALL PASS: mask / preflight / single / skipped_engine / no_save / save / "
          "save_fail / duration / no_side_effects / intact / truthy / read_seat_enabled / "
          "preflight_enabled / debug_metrics / debug_metrics(object)")


if __name__ == "__main__":
    main()
