"""
YOLO Object → FactsFusion → RuleEngine 흐름 테스트 (v0.3).

**실제 YOLO 모델 / ultralytics 없이** FakeYOLOBackend 로 통과한다(합성 프레임).
목표: YOLO object fact 가 FactsFusionEngine 을 거쳐 SeatFacts.objects 로 들어가고,
RuleEngine 이 UNKNOWN 이 아니라 STUDYING / PHONE / ABSENT **후보**를 낼 수 있는지 검증.

⚠️ 이 테스트는 판정 후보 생성까지만 확인한다.
   학생 상태/출결/벌점/알림 자동 변경은 절대 하지 않는다(그런 코드 자체가 없음).

시나리오(v0.4):
  A. person + phone           → PHONE
  B. person + laptop          → STUDYING (휴대폰 없음)
  C. person + book            → STUDYING (휴대폰 없음)
  D. no person + no objects   → ABSENT
  E. no person + phone        → UNKNOWN (object-only, ABSENT 확정 금지)
  F. no person + laptop       → UNKNOWN (object-only, ABSENT 확정 금지)
  G. person + unknown_object  → UNKNOWN (학습도구 아님)
  (참고) opencv 단독            → UNKNOWN (탐지 엔진 부재)
"""
import os
from datetime import datetime

import numpy as np

from analysis_result import AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS
from burst_package import BurstPackage
from yolo_backend import FakeYOLOBackend
from plugins.yolo_engine import YOLOEngine
from facts_fusion_engine import FactsFusionEngine
from rule_engine import RuleEngine
import seat1_e2e_test as e2e


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
_UNKNOWN_OBJ = {"source_label": "traffic light", "confidence": 0.5, "bbox_xyxy": [5, 5, 20, 40], "class_id": 9}


# ---- 시나리오 A: person + phone → PHONE -----------------------------------
def test_scenario_A_person_phone_phone():
    d, sf = _decide([_PERSON, _PHONE])
    assert sf.objects.get("phone_detected") is True        # cell phone → phone 정규화
    assert sf.objects.get("person_detected") is True
    assert d.activity == "PHONE"
    assert d.status == "SUCCESS" and d.confidence > 0
    print("PASS 시나리오 A: person+phone → PHONE")


# ---- 시나리오 B: person + laptop → STUDYING -------------------------------
def test_scenario_B_person_laptop_studying():
    d, sf = _decide([_PERSON, _LAPTOP])
    assert sf.objects.get("laptop_detected") is True
    assert sf.objects.get("phone_detected") is False
    assert d.activity == "STUDYING"
    print("PASS 시나리오 B: person+laptop(휴대폰 없음) → STUDYING")


# ---- 시나리오 C: person + book → STUDYING ---------------------------------
def test_scenario_C_person_book_studying():
    d, sf = _decide([_PERSON, _BOOK])
    assert sf.objects.get("book_detected") is True
    assert d.activity == "STUDYING"
    assert d.status == "SUCCESS" and d.confidence > 0
    print("PASS 시나리오 C: person+book(휴대폰 없음) → STUDYING")


# ---- 시나리오 D: no person + no objects → ABSENT --------------------------
def test_scenario_D_no_person_no_objects_absent():
    d, sf = _decide([])                                    # YOLO 실행됐으나 검출 0
    assert sf.objects.get("person_detected") is False
    assert d.activity == "ABSENT"
    assert d.status == "SUCCESS"
    print("PASS 시나리오 D: 사람X + 객체X → ABSENT")


# ---- 시나리오 E: no person + phone → UNKNOWN(object-only, ABSENT 금지) -----
def test_scenario_E_no_person_phone_not_absent():
    d, sf = _decide([_PHONE])
    assert sf.objects.get("phone_detected") is True
    assert sf.objects.get("person_detected") is False
    assert d.activity == "UNKNOWN", d.activity               # 절대 ABSENT 아님
    assert d.activity != "ABSENT"
    assert any("object-only" in r or "사람 미검출" in r for r in d.reasons)
    print("PASS 시나리오 E: 사람X + 휴대폰 → UNKNOWN(자리비움 확정 금지)")


# ---- 시나리오 F: no person + laptop → UNKNOWN(object-only, ABSENT 금지) ----
def test_scenario_F_no_person_laptop_not_absent():
    d, sf = _decide([_LAPTOP])
    assert sf.objects.get("laptop_detected") is True
    assert sf.objects.get("person_detected") is False
    assert d.activity == "UNKNOWN", d.activity
    assert d.activity != "ABSENT"
    print("PASS 시나리오 F: 사람X + 노트북 → UNKNOWN(자리비움 확정 금지)")


# ---- 시나리오 G: person + unknown_object only → UNKNOWN -------------------
def test_scenario_G_person_unknown_object_unknown():
    d, sf = _decide([_PERSON, _UNKNOWN_OBJ])
    assert sf.objects.get("person_detected") is True
    assert sf.objects.get("book_detected") is False
    assert sf.objects.get("laptop_detected") is False
    assert d.activity == "UNKNOWN", d.activity              # unknown_object 만 → STUDYING 확정 안 함
    print("PASS 시나리오 G: person + unknown_object → UNKNOWN")


# ---- (참고) opencv 단독(YOLO 없음) → UNKNOWN(구조적) ----------------------
def test_opencv_only_unknown():
    d, sf = _decide(with_yolo=False)
    assert not sf.objects
    assert d.activity == "UNKNOWN"
    assert any("human/objects" in r for r in d.reasons)
    print("PASS opencv 단독 → UNKNOWN(탐지 엔진 부재)")


# ---- objects fact 가 fusion 을 통해 실제로 전달되는지(회귀 방지) ----------
def test_objects_fact_reaches_seatfacts():
    d, sf = _decide([_PERSON, _BOOK, _PHONE])
    obj = sf.objects
    assert obj and obj.get("status") == "SUCCESS"
    assert obj["object_counts"].get("person", 0) >= 1
    assert obj["object_counts"].get("book", 0) >= 1
    assert obj["object_counts"].get("phone", 0) >= 1
    assert obj.get("max_detection_confidence", 0) > 0
    # person+phone+book: 휴대폰이 있으므로 STUDYING 은 절대 아님(오탐 방지). PHONE 또는 UNKNOWN.
    assert d.activity != "STUDYING", d.activity
    print("PASS 전달: YOLO objects fact → FactsFusion → SeatFacts.objects")


# ---- debug metrics: object-only → reason_code=OBJECT_WITHOUT_PERSON --------
def _fusion_and_decision(detections):
    b = _burst()
    y = _yolo_result(b, detections)
    fusion = FactsFusionEngine(); fusion.initialize()
    fr = fusion.fuse([_opencv_result(b), y], context={"seat_id": "Seat1", "burst_uuid": "b1"})
    rule = RuleEngine(); rule.initialize()
    d = rule.decide(fr.seat_facts)
    return b, fr, d


def test_debug_reason_code_object_without_person():
    b, fr, d = _fusion_and_decision([_PHONE])          # 사람 없음 + 휴대폰
    here = os.path.dirname(os.path.abspath(e2e.__file__))
    dbg = e2e.build_debug_metrics(here, "Seat1", ["opencv", "yolo"], True, 10.0, b, fr, d,
                                  engine_statuses={"opencv": "SUCCESS", "yolo": "SUCCESS"})
    assert d.activity == "UNKNOWN"
    assert dbg["reason_code"] == "OBJECT_WITHOUT_PERSON", dbg["reason_code"]
    assert dbg["person_count"] == 0 and dbg["phone_count"] >= 1
    assert "phone" in dbg["detected_labels"]
    print("PASS debug: object-only(phone) → reason_code=OBJECT_WITHOUT_PERSON")


def test_debug_reason_code_determined_person_book():
    b, fr, d = _fusion_and_decision([_PERSON, _BOOK])   # person+book → STUDYING
    here = os.path.dirname(os.path.abspath(e2e.__file__))
    dbg = e2e.build_debug_metrics(here, "Seat1", ["opencv", "yolo"], True, 10.0, b, fr, d,
                                  engine_statuses={"opencv": "SUCCESS", "yolo": "SUCCESS"})
    assert d.activity == "STUDYING"
    assert dbg["reason_code"] == "DETERMINED"
    assert dbg["person_count"] >= 1 and "book" in dbg["detected_labels"]
    print("PASS debug: person+book → DETERMINED(STUDYING)")


def main():
    test_scenario_A_person_phone_phone()
    test_scenario_B_person_laptop_studying()
    test_scenario_C_person_book_studying()
    test_scenario_D_no_person_no_objects_absent()
    test_scenario_E_no_person_phone_not_absent()
    test_scenario_F_no_person_laptop_not_absent()
    test_scenario_G_person_unknown_object_unknown()
    test_opencv_only_unknown()
    test_objects_fact_reaches_seatfacts()
    test_debug_reason_code_object_without_person()
    test_debug_reason_code_determined_person_book()
    print("\nALL PASS: 시나리오 A/B/C/D/E/F/G + opencv-only + objects fact 전달 + "
          "debug reason_code(object-only/determined)")


if __name__ == "__main__":
    main()
