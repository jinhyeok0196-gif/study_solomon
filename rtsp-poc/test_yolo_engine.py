"""
YOLO Object Engine v0.1 테스트.

**실제 YOLO 모델 파일 / ultralytics 라이브러리 없이** Fake Backend 로 통과한다.

검증:
  - YOLOEngine 초기화(Fake backend 주입)
  - Fake BurstPackage 분석 → ObjectDetectionResult / AnalysisResult 생성
  - activity 가 항상 UNKNOWN
  - phone/book/laptop/tablet/person detected 가 metadata 에 반영
  - empty/dark/corrupt 프레임만 있으면 SKIPPED
  - backend 예외 발생 시 FAILED
  - 샘플링/상한(sample_every_n_frames / max_analyzed_frames)
  - object_label_mapper 라벨 정규화
  - bbox 원본/정규화 좌표 보관
  - engine_registry 에서 yolo 생성 가능(ultralytics import 없이)
  - 기존 dummy / opencv / mediapipe 엔진 등록이 깨지지 않음
"""
from datetime import datetime

import numpy as np

from analysis_result import (
    ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_SKIPPED, STATUS_FAILED,
)
from object_detection_result import ObjectDetectionResult
from object_label_mapper import ObjectLabelMapper, UNKNOWN_OBJECT
from burst_package import BurstPackage
from yolo_backend import FakeYOLOBackend
from plugins.yolo_engine import YOLOEngine


# ---- 합성 프레임 / 도우미 -------------------------------------------------
def normal_frame(seed=0):
    rng = np.random.RandomState(seed)
    return rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)

def dark_frame():
    return np.full((240, 320, 3), 2, dtype=np.uint8)

def corrupt_frame():
    return np.zeros((240,), dtype=np.uint8)        # 1D → corrupt


def fake_item(img, ts=0.0):
    class _It:
        pass
    it = _It(); it.frame = img; it.timestamp = ts; it.frame_index = 0
    return it


def burst(frames, seat="Seat1"):
    return BurstPackage(
        burst_uuid="b1", trigger_uuid="t1", trigger_id="2026-06-30_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime(2026, 6, 30, 9, 5),
        frame_count=len(frames), frames=frames, metadata={},
    )


def make_engine(backend=None, **kw):
    eng = YOLOEngine(backend=backend or FakeYOLOBackend(),
                     config={"runtime": {"sample_every_n_frames": 1,
                                         "max_analyzed_frames": 100}}, **kw)
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_init_and_analyze():
    eng = make_engine()
    assert eng.health()["ready"] is True
    res = eng.analyze(burst([fake_item(normal_frame(1)), fake_item(normal_frame(2))]))

    assert isinstance(eng.last_result, ObjectDetectionResult)
    assert res.status == STATUS_SUCCESS
    assert res.activity == ACTIVITY_UNKNOWN, "YOLO 는 행동 판별 안 함"
    odr = eng.last_result
    assert odr.valid_frames == 2 and odr.analyzed_frames == 2
    assert odr.phone_detected and odr.book_detected and odr.laptop_detected
    assert odr.tablet_detected and odr.person_detected
    # 2프레임 × 6객체 = 12 검출 인스턴스, 프레임당 사람 2명
    assert len(odr.detected_objects) == 12
    assert odr.max_person_count == 2
    assert odr.phone_detection_count == 2          # 2프레임 모두 등장
    assert odr.object_counts["person"] == 4        # 2프레임 × 2명
    print("PASS init/analyze: ObjectDetectionResult/AnalysisResult, activity=UNKNOWN")


def test_metadata_has_detections():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(normal_frame(3))]))
    summ = res.metadata["object_detection_result"]
    assert summ["phone_detected"] and summ["book_detected"] and summ["laptop_detected"]
    assert summ["tablet_detected"] and summ["person_detected"]
    assert res.metadata["engine"] == "yolo"
    assert res.metadata["max_person_count"] == 2
    assert res.metadata["detected_objects_count"] == 6
    assert set(res.scores) == {"quality_score", "phone_score", "book_score",
                               "laptop_score", "tablet_score", "person_score"}
    # confidence 는 검출 품질 점수(= quality_score = 평균 신뢰도)
    assert res.confidence == res.scores["quality_score"]
    assert res.scores["phone_score"] == 0.87       # Fake phone conf
    print("PASS metadata: phone/book/laptop/tablet/person detected 가 metadata 에 반영")


def test_bbox_coords():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(normal_frame(4))]))
    o = eng.last_result.detected_objects[0]
    assert o["label"] == "phone" and o["source_label"] == "cell phone"
    assert o["bbox_xyxy"] == [10, 10, 80, 160]
    # 320x240 정규화
    assert o["bbox_normalized"][0] == round(10 / 320, 4)
    assert o["bbox_normalized"][3] == round(160 / 240, 4)
    assert o["class_id"] == 67
    print("PASS bbox: 원본/정규화 좌표 + 정규화 라벨 보관")


def test_empty_frames_skipped():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(None), fake_item(dark_frame()),
                             fake_item(corrupt_frame())]))
    assert res.status == STATUS_SKIPPED
    assert eng.last_result.valid_frames == 0
    assert res.metadata["skipped_frames"] == 3
    reasons = res.metadata["discard_reasons"]
    assert reasons.get("empty") and reasons.get("too_dark") and reasons.get("corrupt")
    print("PASS skipped: 분석 가능한 프레임 없음 → SKIPPED")


def test_backend_failure_failed():
    eng = make_engine(backend=FakeYOLOBackend(fail=True))
    res = eng.analyze(burst([fake_item(normal_frame(5))]))
    assert res.status == STATUS_FAILED
    assert res.activity == ACTIVITY_UNKNOWN
    assert res.metadata["errors"], "예외 메시지가 errors 에 기록돼야 함"
    print("PASS failed: backend 예외 → FAILED")


def test_sampling_and_cap():
    eng = YOLOEngine(backend=FakeYOLOBackend(),
                     config={"runtime": {"sample_every_n_frames": 2,
                                         "max_analyzed_frames": 3}})
    eng.initialize()
    frames = [fake_item(normal_frame(i)) for i in range(10)]
    res = eng.analyze(burst(frames))
    odr = eng.last_result
    assert odr.frame_count == 10
    # 10프레임 → step2 = 5장 → cap3 = 3장 분석
    assert odr.analyzed_frames == 3 and odr.valid_frames == 3
    print("PASS sampling: sample_every_n_frames + max_analyzed_frames 적용")


def test_label_mapper():
    m = ObjectLabelMapper()
    assert m.normalize("cell phone") == "phone"
    assert m.normalize("Mobile Phone") == "phone"
    assert m.normalize("laptop") == "laptop"
    assert m.normalize("book") == "book"
    assert m.normalize("person") == "person"
    assert m.normalize("ipad") == "tablet"
    assert m.normalize("traffic light") == UNKNOWN_OBJECT
    # config target_objects 우선
    m2 = ObjectLabelMapper({"phone": {"labels": ["smartphone"]}})
    assert m2.normalize("smartphone") == "phone"
    assert m2.normalize("cell phone") == UNKNOWN_OBJECT  # 커스텀 맵엔 없음
    print("PASS label_mapper: 원본→표준 정규화 + config 우선")


def test_unknown_object_normalized():
    # phone 매핑이 없는 backend 검출 → unknown_object 로 정규화(표준 카운트엔 미반영)
    eng = YOLOEngine(
        backend=FakeYOLOBackend(detections=[
            {"source_label": "traffic light", "confidence": 0.5,
             "bbox_xyxy": [0, 0, 10, 10], "class_id": 9}]),
        config={"runtime": {"sample_every_n_frames": 1, "max_analyzed_frames": 100}})
    eng.initialize()
    eng.analyze(burst([fake_item(normal_frame(6))]))
    odr = eng.last_result
    assert odr.phone_detected is False and odr.person_detected is False
    assert odr.object_counts.get("unknown_object") == 1
    assert odr.detected_objects[0]["label"] == "unknown_object"
    print("PASS unknown: 미매핑 라벨 → unknown_object")


def test_registry_creates_yolo():
    import engine_registry as reg
    assert "yolo" in reg.available_engines()
    eng = reg.create_engine("yolo", backend=FakeYOLOBackend())
    eng.initialize()
    assert eng.name == "yolo"
    res = eng.analyze(burst([fake_item(normal_frame(8))]))
    assert res.activity == ACTIVITY_UNKNOWN
    print("PASS registry: create_engine('yolo') 동작")


def test_existing_engines_intact():
    import engine_registry as reg
    for name in ("dummy", "opencv", "mediapipe", "yolo"):
        assert name in reg.available_engines(), name
    d = reg.create_engine("dummy")
    d.initialize()
    res = d.analyze(burst([fake_item(normal_frame(9))]))
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    print("PASS intact: dummy/opencv/mediapipe/yolo 등록 유지(dummy 동작)")


def main():
    test_init_and_analyze()
    test_metadata_has_detections()
    test_bbox_coords()
    test_empty_frames_skipped()
    test_backend_failure_failed()
    test_sampling_and_cap()
    test_label_mapper()
    test_unknown_object_normalized()
    test_registry_creates_yolo()
    test_existing_engines_intact()
    print("\nALL PASS: init / metadata / bbox / skipped / failed / sampling / "
          "label_mapper / unknown / registry / intact")


if __name__ == "__main__":
    main()
