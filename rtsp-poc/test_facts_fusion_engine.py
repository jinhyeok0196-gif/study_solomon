"""
Facts Fusion Engine v0.1 테스트.

**cv2 / mediapipe / ultralytics 없이** 합성 AnalysisResult 로 통과한다.

**원칙: Facts Fusion 은 행동 판별을 하지 않는다.** SeatFacts 는 "관측된 사실 모음" 일 뿐이고,
이 테스트들은 통합/상태/품질/일관성만 검증한다(공부/휴대폰/수면/자리비움 판별 검증은 없다).

검증:
  - OpenCV + MediaPipe + YOLO 모두 SUCCESS → FusionResult SUCCESS
  - YOLO 누락 → PARTIAL (+ missing_sources)
  - MediaPipe FAILED → PARTIAL (+ errors), 정책 확인
  - 모든 source FAILED → FAILED
  - 입력 없음 → SKIPPED
  - unknown engine → metadata.unknown_sources 기록
  - SeatFacts 필드/섹션 생성
  - quality score 계산(vision/human/object/overall)
  - usable_for_rule_engine 임계(0.3) 계산
  - 행동 판별(activity) 없음(SeatFacts 에 activity 키 자체가 없음)
  - SeatFacts 기본 필드(facts_uuid/burst_uuid/seat_id/generated_at/captured_at/period_*)
  - source_results 에 3 엔진 analysis_uuid 모두 포함
  - metadata.source_statuses 에 opencv/mediapipe/yolo 상태 기록
  - seat_id 불일치 → FAILED + errors
  - burst_uuid 불일치 → FAILED + errors
  - 중복 source(YOLO 2개) → 최신 1개 사용 + duplicate_sources 기록
  - unknown source 만 → SKIPPED
  - 기존 dummy/opencv/mediapipe/yolo 엔진 등록이 깨지지 않음
"""
import uuid
from datetime import datetime

from analysis_result import (
    AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_FAILED, STATUS_SKIPPED,
)
from seat_facts import SeatFacts
from fusion_result import (
    FUSION_SUCCESS, FUSION_PARTIAL, FUSION_FAILED, FUSION_SKIPPED,
)
from facts_fusion_engine import FactsFusionEngine


# ---- 합성 AnalysisResult 빌더 ---------------------------------------------
def _ar(engine, status=STATUS_SUCCESS, scores=None, metadata=None,
        seat="Seat1", burst="b1"):
    now = datetime.now()
    md = {"engine": engine}
    md.update(metadata or {})
    return AnalysisResult(
        analysis_uuid=uuid.uuid4().hex, burst_uuid=burst, seat_id=seat,
        started_at=now, finished_at=now, processing_time=1.0,
        confidence=0.0, status=status, activity=ACTIVITY_UNKNOWN,
        scores=scores or {}, metadata=md,
    )


def opencv_ar(status=STATUS_SUCCESS, seat="Seat1", burst="b1"):
    return _ar("opencv", status, seat=seat, burst=burst,
               scores={"blur_score": 120.5, "brightness": 118.3,
                       "contrast": 45.2, "sharpness": 30.1},
               metadata={"vision": {"vision_uuid": "v1", "frame_count": 6,
                                    "valid_frames": 5, "roi_applied": False,
                                    "resolution": "320x240"},
                         "discarded_frames": 1, "discard_reasons": {"too_dark": 1}})


def mediapipe_ar(status=STATUS_SUCCESS, quality=0.8, seat="Seat1", burst="b1"):
    return _ar("mediapipe", status, seat=seat, burst=burst,
               scores={"quality_score": quality, "face_visible_ratio": 1.0,
                       "hands_visible_ratio": 1.0, "pose_visible_ratio": 1.0},
               metadata={"mediapipe_result": {"face_detected": True,
                                              "pose_detected": True,
                                              "hands_detected": True},
                         "head_features": {"approximate_head_center": [0.5, 0.45]},
                         "hand_features": {"left_hand_detected": True,
                                           "right_hand_detected": True},
                         "pose_features": {"shoulder_visible": True,
                                           "upper_body_visible": True},
                         "errors": []})


def yolo_ar(status=STATUS_SUCCESS, quality=0.75, seat="Seat1", burst="b1"):
    return _ar("yolo", status, seat=seat, burst=burst,
               scores={"quality_score": quality, "phone_score": 0.87,
                       "book_score": 0.74, "laptop_score": 0.66,
                       "tablet_score": 0.55, "person_score": 0.9},
               metadata={"object_detection_result": {
                             "phone_detected": True, "phone_detection_count": 3,
                             "book_detected": True, "book_detection_count": 3,
                             "laptop_detected": True, "laptop_detection_count": 3,
                             "tablet_detected": True, "tablet_detection_count": 3,
                             "person_detected": True, "person_detection_count": 3,
                             "avg_detection_confidence": 0.7533,
                             "max_detection_confidence": 0.9},
                         "object_counts": {"phone": 3, "person": 6},
                         "max_person_count": 2, "detected_objects_count": 18,
                         "errors": []})


def make_engine():
    eng = FactsFusionEngine()
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_all_success():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar()])
    assert fr.status == FUSION_SUCCESS
    assert fr.missing_sources == [] and fr.errors == []
    sf = fr.seat_facts
    assert isinstance(sf, SeatFacts)
    # 세 섹션 모두 채워짐
    assert sf.vision["blur_score"] == 120.5
    assert sf.human["face_detected"] is True
    assert sf.human["approximate_head_center"] == [0.5, 0.45]
    assert sf.objects["phone_detected"] is True
    assert sf.objects["max_person_count"] == 2
    assert len(sf.source_results) == 3
    print("PASS all_success: 세 엔진 모두 SUCCESS → SUCCESS, SeatFacts 3섹션")


def test_quality_and_usable():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(quality=0.8), yolo_ar(quality=0.75)])
    q = fr.seat_facts.quality
    assert q["vision_quality"] == 1.0      # opencv SUCCESS
    assert q["human_quality"] == 0.8
    assert q["object_quality"] == 0.75
    assert q["overall_quality"] == round((1.0 + 0.8 + 0.75) / 3, 4)
    assert q["usable_for_rule_engine"] is True
    print("PASS quality: vision/human/object/overall + usable_for_rule_engine")


def test_usable_threshold_false():
    eng = make_engine()
    # opencv SKIPPED(0.0) + 낮은 품질 → overall < 0.3
    fr = eng.fuse([opencv_ar(STATUS_SKIPPED),
                   mediapipe_ar(quality=0.1), yolo_ar(quality=0.1)])
    q = fr.seat_facts.quality
    assert q["vision_quality"] == 0.0
    assert q["overall_quality"] < 0.3
    assert q["usable_for_rule_engine"] is False
    assert fr.status == FUSION_PARTIAL     # opencv SKIPPED → all_success 아님
    print("PASS threshold: overall<0.3 → usable_for_rule_engine False")


def test_missing_yolo_partial():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar()])
    assert fr.status == FUSION_PARTIAL
    assert fr.missing_sources == ["yolo"]
    assert fr.seat_facts.objects == {}     # YOLO 누락 → 빈 섹션
    assert fr.seat_facts.quality["object_quality"] is None
    print("PASS missing_yolo: YOLO 누락 → PARTIAL + missing_sources")


def test_failed_mediapipe_partial():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(STATUS_FAILED), yolo_ar()])
    assert fr.status == FUSION_PARTIAL
    assert any("mediapipe" in e for e in fr.errors)
    assert fr.seat_facts.quality["human_quality"] == 0.0   # FAILED → 0.0
    # 나머지 섹션은 정상
    assert fr.seat_facts.vision["blur_score"] == 120.5
    assert fr.seat_facts.objects["phone_detected"] is True
    print("PASS failed_mediapipe: 일부 FAILED → PARTIAL + errors")


def test_all_failed():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(STATUS_FAILED), mediapipe_ar(STATUS_FAILED),
                   yolo_ar(STATUS_FAILED)])
    assert fr.status == FUSION_FAILED
    assert fr.seat_facts is None
    assert len(fr.errors) >= 1
    print("PASS all_failed: 모든 source FAILED → FAILED")


def test_empty_skipped():
    eng = make_engine()
    fr = eng.fuse([])
    assert fr.status == FUSION_SKIPPED
    assert fr.seat_facts is None
    assert set(fr.missing_sources) == {"opencv", "mediapipe", "yolo"}
    print("PASS empty: 입력 없음 → SKIPPED")


def test_unknown_engine_recorded():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar(),
                   _ar("some_future_engine")])
    assert "some_future_engine" in fr.metadata["unknown_sources"]
    assert fr.status == FUSION_SUCCESS     # 알려진 3개가 모두 SUCCESS
    print("PASS unknown: 알 수 없는 engine → metadata.unknown_sources")


def test_no_activity_in_facts():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar()])
    sf = fr.seat_facts
    # SeatFacts 어디에도 행동 판별(activity) 키가 없어야 한다
    for section in (sf.vision, sf.human, sf.objects, sf.quality):
        assert "activity" not in section
    assert not hasattr(sf, "activity")
    print("PASS no_activity: SeatFacts 에 행동 판별 없음")


def test_seat_facts_basic_fields():
    eng = make_engine()
    captured = datetime(2026, 6, 30, 9, 5)
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar()], context={
        "period_id": "P0", "period_name": "0교시", "captured_at": captured})
    sf = fr.seat_facts
    assert sf.facts_uuid                       # 존재(빈 문자열 아님)
    assert sf.burst_uuid == "b1"
    assert sf.seat_id == "Seat1"
    assert sf.generated_at is not None
    assert sf.captured_at == captured
    assert sf.period_id == "P0" and sf.period_name == "0교시"
    print("PASS basic_fields: facts_uuid/burst_uuid/seat_id/generated_at/captured_at/period_*")


def test_source_results_contains_all_uuids():
    eng = make_engine()
    o, m, y = opencv_ar(), mediapipe_ar(), yolo_ar()
    fr = eng.fuse([o, m, y])
    src = fr.seat_facts.source_results
    assert o.analysis_uuid in src
    assert m.analysis_uuid in src
    assert y.analysis_uuid in src
    assert len(src) == 3
    print("PASS source_results: opencv/mediapipe/yolo analysis_uuid 모두 포함")


def test_source_statuses_metadata():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(STATUS_SUCCESS),
                   mediapipe_ar(STATUS_FAILED),
                   yolo_ar(STATUS_SKIPPED)])
    # FusionResult.metadata 와 SeatFacts.metadata 양쪽에 기록
    for md in (fr.metadata, fr.seat_facts.metadata):
        ss = md["source_statuses"]
        assert ss["opencv"] == STATUS_SUCCESS
        assert ss["mediapipe"] == STATUS_FAILED
        assert ss["yolo"] == STATUS_SKIPPED
    assert fr.status == FUSION_PARTIAL         # 1개만 FAILED → PARTIAL
    print("PASS source_statuses: opencv/mediapipe/yolo SUCCESS/FAILED/SKIPPED 기록")


def test_seat_id_mismatch_failed():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(seat="Seat1"),
                   mediapipe_ar(seat="Seat2"),   # 다른 좌석 혼입
                   yolo_ar(seat="Seat1")])
    assert fr.status == FUSION_FAILED
    assert fr.seat_facts is None
    assert any("seat_id mismatch" in e for e in fr.errors)
    assert fr.metadata.get("consistency_error") is True
    print("PASS seat_mismatch: 다른 seat_id 혼입 → FAILED + errors")


def test_burst_uuid_mismatch_failed():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(burst="b1"),
                   mediapipe_ar(burst="b1"),
                   yolo_ar(burst="b2")])         # 다른 Burst 혼입
    assert fr.status == FUSION_FAILED
    assert fr.seat_facts is None
    assert any("burst_uuid mismatch" in e for e in fr.errors)
    print("PASS burst_mismatch: 다른 burst_uuid 혼입 → FAILED + errors")


def test_duplicate_source_latest_used():
    eng = make_engine()
    y_old = yolo_ar(quality=0.30)
    y_new = yolo_ar(quality=0.90)               # 같은 engine='yolo' 2번째
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), y_old, y_new])
    # 정책: 최신(마지막) 1개만 사용 + 중복 사실 기록
    assert "yolo" in fr.metadata["duplicate_sources"]
    assert y_new.analysis_uuid in fr.seat_facts.source_results
    assert y_old.analysis_uuid not in fr.seat_facts.source_results
    assert fr.seat_facts.quality["object_quality"] == 0.90   # 최신 값 반영
    assert fr.status == FUSION_SUCCESS          # 중복은 치명적 아님
    print("PASS duplicate: YOLO 2개 → 최신 1개 사용 + duplicate_sources 기록")


def test_unknown_only_skipped():
    eng = make_engine()
    fr = eng.fuse([_ar("future_engine_a"), _ar("future_engine_b")])
    assert fr.status == FUSION_SKIPPED          # 알려진 source 0개
    assert fr.seat_facts is None
    assert "future_engine_a" in fr.metadata["unknown_sources"]
    assert "future_engine_b" in fr.metadata["unknown_sources"]
    assert set(fr.missing_sources) == {"opencv", "mediapipe", "yolo"}
    print("PASS unknown_only: unknown source 만 → SKIPPED")


def test_existing_engines_intact():
    import engine_registry as reg
    for name in ("dummy", "opencv", "mediapipe", "yolo"):
        assert name in reg.available_engines(), name
    d = reg.create_engine("dummy")
    d.initialize()
    from burst_package import BurstPackage
    b = BurstPackage(burst_uuid="b", trigger_uuid="t", trigger_id="x",
                     trigger_type="mid_study_check", period_id="P0", period_name="0",
                     seat_id="Seat1", captured_at=datetime.now(),
                     frame_count=0, frames=[], metadata={})
    res = d.analyze(b)
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    print("PASS intact: dummy/opencv/mediapipe/yolo 등록 유지(dummy 동작)")


def main():
    test_all_success()
    test_quality_and_usable()
    test_usable_threshold_false()
    test_missing_yolo_partial()
    test_failed_mediapipe_partial()
    test_all_failed()
    test_empty_skipped()
    test_unknown_engine_recorded()
    test_no_activity_in_facts()
    test_seat_facts_basic_fields()
    test_source_results_contains_all_uuids()
    test_source_statuses_metadata()
    test_seat_id_mismatch_failed()
    test_burst_uuid_mismatch_failed()
    test_duplicate_source_latest_used()
    test_unknown_only_skipped()
    test_existing_engines_intact()
    print("\nALL PASS: all_success / quality / threshold / missing_yolo / "
          "failed_mediapipe / all_failed / empty / unknown / no_activity / "
          "basic_fields / source_results / source_statuses / seat_mismatch / "
          "burst_mismatch / duplicate / unknown_only / intact")


if __name__ == "__main__":
    main()
