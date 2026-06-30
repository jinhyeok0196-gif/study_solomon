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
    print("\nALL PASS: mask / preflight / single / skipped_engine / no_save / save / "
          "save_fail / duration / no_side_effects / intact")


if __name__ == "__main__":
    main()
