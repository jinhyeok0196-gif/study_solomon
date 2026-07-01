"""
YOLO Object → FactsFusion → RuleEngine 흐름 테스트 (v0.3).

**실제 YOLO 모델 / ultralytics 없이** FakeYOLOBackend 로 통과한다(합성 프레임).
목표: YOLO object fact 가 FactsFusionEngine 을 거쳐 SeatFacts.objects 로 들어가고,
RuleEngine 이 UNKNOWN 이 아니라 STUDYING / PHONE / ABSENT **후보**를 낼 수 있는지 검증.

⚠️ 이 테스트는 판정 후보 생성까지만 확인한다.
   학생 상태/출결/벌점/알림 자동 변경은 절대 하지 않는다(그런 코드 자체가 없음).

시나리오:
  A. person + book       → STUDYING 후보
  B. person + cell phone  → PHONE 후보
  C. 검출 없음(사람 없음)   → ABSENT 후보
  D. opencv 단독(YOLO 없음) → objects 비어 UNKNOWN (구조적, NO_DETECTION_ENGINE)
"""
from datetime import datetime

import numpy as np

from analysis_result import AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS
from burst_package import BurstPackage
from yolo_backend import FakeYOLOBackend
from plugins.yolo_engine import YOLOEngine
from facts_fusion_engine import FactsFusionEngine
from rule_engine import RuleEngine


# ---- 합성 입력 도우미 -----------------------------------------------------
def _frame(seed=1):
    return np.random.RandomState(seed).randint(40, 220, (240, 320, 3), dtype=np.uint8)


def _item(img, ts=0.0):
    class _It:
        pass
    it = _It(); it.frame = img; it.timestamp = ts; it.frame_index = 0
    return it


def _burst(seat="Seat1"):
    frames = [_item(_frame(1))]
    return BurstPackage(
        burst_uuid="b1", trigger_uuid="t1", trigger_id="e2e", trigger_type="e2e_single_check",
        period_id="P0", period_name="0교시", seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )


def _opencv_result(burst):
    """opencv 품질 fact(성공) 합성 — 프레임/품질은 정상."""
    now = datetime.now()
    return AnalysisResult(
        analysis_uuid="a-opencv", burst_uuid=burst.burst_uuid, seat_id=burst.seat_id,
        started_at=now, finished_at=now, processing_time=1.0, confidence=0.0,
        status=STATUS_SUCCESS, activity=ACTIVITY_UNKNOWN,
        scores={"blur_score": 120.0, "brightness": 118.0, "contrast": 45.0, "sharpness": 30.0},
        metadata={"engine": "opencv",
                  "vision": {"vision_uuid": "v", "frame_count": 1, "valid_frames": 1,
                             "roi_applied": True, "resolution": "320x240"},
                  "discarded_frames": 0, "discard_reasons": {}},
    )


def _yolo_result(burst, detections):
    eng = YOLOEngine(backend=FakeYOLOBackend(detections=detections),
                     config={"runtime": {"sample_every_n_frames": 1, "max_analyzed_frames": 100}})
    eng.initialize()
    res = eng.analyze(burst)
    eng.shutdown()
    return res


def _decide(detections=None, with_yolo=True):
    """opencv(+옵션 yolo) → fusion → rule. RuleDecision 과 SeatFacts 반환."""
    b = _burst()
    results = [_opencv_result(b)]
    if with_yolo:
        results.append(_yolo_result(b, detections or []))
    fusion = FactsFusionEngine(); fusion.initialize()
    fr = fusion.fuse(results, context={"seat_id": "Seat1", "burst_uuid": "b1"})
    rule = RuleEngine(); rule.initialize()
    return rule.decide(fr.seat_facts), fr.seat_facts


_PERSON = {"source_label": "person", "confidence": 0.90, "bbox_xyxy": [0, 0, 160, 240], "class_id": 0}
_BOOK = {"source_label": "book", "confidence": 0.74, "bbox_xyxy": [100, 120, 200, 230], "class_id": 73}
_PHONE = {"source_label": "cell phone", "confidence": 0.87, "bbox_xyxy": [10, 10, 80, 160], "class_id": 67}
_LAPTOP = {"source_label": "laptop", "confidence": 0.66, "bbox_xyxy": [40, 30, 300, 220], "class_id": 63}


# ---- 시나리오 A: person + book → STUDYING --------------------------------
def test_scenario_A_person_book_studying():
    d, sf = _decide([_PERSON, _BOOK])
    assert sf.objects.get("book_detected") is True         # objects fact 로 흘러감
    assert sf.objects.get("person_detected") is True
    assert d.activity == "STUDYING"
    assert d.status == "SUCCESS" and d.confidence > 0
    print("PASS 시나리오 A: person+book → STUDYING 후보")


def test_scenario_A_person_laptop_studying():
    d, sf = _decide([_PERSON, _LAPTOP])
    assert sf.objects.get("laptop_detected") is True
    assert d.activity == "STUDYING"
    print("PASS 시나리오 A': person+laptop → STUDYING 후보")


# ---- 시나리오 B: person + cell phone → PHONE ------------------------------
def test_scenario_B_person_phone_phone():
    d, sf = _decide([_PERSON, _PHONE])
    assert sf.objects.get("phone_detected") is True        # cell phone → phone 정규화
    assert d.activity == "PHONE"
    assert d.status == "SUCCESS" and d.confidence > 0
    print("PASS 시나리오 B: person+cell phone → PHONE 후보")


# ---- 시나리오 C: 검출 없음(사람 없음) → ABSENT ----------------------------
def test_scenario_C_no_person_absent():
    d, sf = _decide([])                                    # YOLO 실행됐으나 검출 0
    assert sf.objects.get("person_detected") is False
    assert d.activity == "ABSENT"
    assert d.status == "SUCCESS"
    print("PASS 시나리오 C: 사람 없음 → ABSENT 후보")


# ---- 시나리오 D: opencv 단독(YOLO 없음) → UNKNOWN -------------------------
def test_scenario_D_opencv_only_unknown():
    d, sf = _decide(with_yolo=False)
    assert not sf.objects                                  # objects fact 자체가 비어있음
    assert d.activity == "UNKNOWN"
    assert any("human/objects" in r for r in d.reasons)
    print("PASS 시나리오 D: opencv 단독 → UNKNOWN(구조적, 탐지 엔진 부재)")


# ---- objects fact 가 fusion 을 통해 실제로 전달되는지(회귀 방지) ----------
def test_objects_fact_reaches_seatfacts():
    d, sf = _decide([_PERSON, _BOOK, _PHONE])
    obj = sf.objects
    assert obj and obj.get("status") == "SUCCESS"
    # object_counts 에 표준 라벨이 정규화되어 담긴다
    assert obj["object_counts"].get("person", 0) >= 1
    assert obj["object_counts"].get("book", 0) >= 1
    assert obj["object_counts"].get("phone", 0) >= 1
    assert obj.get("max_detection_confidence", 0) > 0
    print("PASS 전달: YOLO objects fact → FactsFusion → SeatFacts.objects")


def main():
    test_scenario_A_person_book_studying()
    test_scenario_A_person_laptop_studying()
    test_scenario_B_person_phone_phone()
    test_scenario_C_no_person_absent()
    test_scenario_D_opencv_only_unknown()
    test_objects_fact_reaches_seatfacts()
    print("\nALL PASS: 시나리오 A / A' / B / C / D + objects fact 전달")


if __name__ == "__main__":
    main()
