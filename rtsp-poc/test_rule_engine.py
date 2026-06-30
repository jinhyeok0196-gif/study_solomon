"""
Rule Engine v0.1 테스트.

SeatFacts(합성) → RuleEngine.decide() → RuleDecision 검증.

검증:
  - 공부 후보 → STUDYING
  - 휴대폰 후보 → PHONE
  - 자리비움 후보 → ABSENT
  - 수면 후보 → SLEEPING (보수 정책)
  - 품질 낮음 → UNKNOWN / LOW_CONFIDENCE
  - seat_facts None → SKIPPED
  - 충돌 신호 → UNKNOWN
  - RuleDecision 필드 생성
  - evidence / reasons / rule_hits 기록
  - 파워냅 activity 가 표준 activity 에 없음
  - config 임계값 사용(임계 낮추면 판정 바뀜)
  - 기존 FactsFusionEngine 테스트가 깨지지 않음
"""
import uuid
from datetime import datetime

import activity_labels as A
from seat_facts import SeatFacts
from rule_decision import RuleDecision
from rule_engine import RuleEngine


# ---- 합성 SeatFacts 빌더 --------------------------------------------------
def _facts(human, objects, quality, vision=None, seat="Seat1"):
    now = datetime.now()
    return SeatFacts(
        facts_uuid=uuid.uuid4().hex, burst_uuid="b1", seat_id=seat,
        period_id="P0", period_name="0교시", captured_at=now, generated_at=now,
        vision=vision or {"valid_frames": 5, "resolution": "320x240"},
        human=human, objects=objects, quality=quality,
        source_results=["o", "m", "y"], metadata={})


def studying_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.8, "hands_detected": True,
               "hands_visible_ratio": 0.7, "pose_detected": True, "pose_visible_ratio": 0.9},
        objects={"phone_detected": False, "book_detected": True, "book_detection_count": 3,
                 "laptop_detected": False, "tablet_detected": False,
                 "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.9, "object_quality": 0.7,
                 "overall_quality": 0.8667, "usable_for_rule_engine": True})


def phone_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.6, "hands_detected": True,
               "hands_visible_ratio": 0.8, "pose_detected": True, "pose_visible_ratio": 0.8},
        objects={"phone_detected": True, "phone_detection_count": 3, "book_detected": False,
                 "laptop_detected": False, "tablet_detected": False,
                 "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.8, "object_quality": 0.85,
                 "overall_quality": 0.8833, "usable_for_rule_engine": True})


def absent_facts():
    return _facts(
        human={"face_detected": False, "face_visible_ratio": 0.0, "hands_detected": False,
               "hands_visible_ratio": 0.0, "pose_detected": False, "pose_visible_ratio": 0.0},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": False, "max_person_count": 0},
        quality={"vision_quality": 1.0, "human_quality": 0.0, "object_quality": 0.0,
                 "overall_quality": 0.3333, "usable_for_rule_engine": True},
        vision={"valid_frames": 5})


def sleeping_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.1, "hands_detected": False,
               "hands_visible_ratio": 0.05, "pose_detected": True, "pose_visible_ratio": 0.7},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.6, "object_quality": 0.2,
                 "overall_quality": 0.6, "usable_for_rule_engine": True})


def low_quality_facts():
    return _facts(
        human={"face_detected": False, "hands_detected": False, "pose_detected": False},
        objects={"phone_detected": False, "person_detected": False},
        quality={"vision_quality": 0.0, "human_quality": 0.1, "object_quality": 0.1,
                 "overall_quality": 0.0667, "usable_for_rule_engine": False})


def conflict_facts():
    # phone 과 studying 이 둘 다 강하게 발동(confidence 가 매우 가까움) → 충돌
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.6, "hands_detected": True,
               "hands_visible_ratio": 0.9, "pose_detected": True, "pose_visible_ratio": 0.8},
        objects={"phone_detected": True, "book_detected": True, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.8, "object_quality": 0.8,
                 "overall_quality": 0.8667, "usable_for_rule_engine": True})


def make_engine(config=None):
    eng = RuleEngine(config=config)
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_studying():
    d = make_engine().decide(studying_facts())
    assert d.activity == A.STUDYING, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert d.confidence >= 0.6
    assert any("학습 도구" in r or "책" in r for r in d.reasons)
    assert d.severity == A.SEVERITY_INFO
    print("PASS studying: 학습도구+사람/손 → STUDYING")


def test_phone():
    d = make_engine().decide(phone_facts())
    assert d.activity == A.PHONE, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert d.confidence >= 0.65
    assert any("휴대폰" in r for r in d.reasons)
    assert d.severity == A.SEVERITY_WARNING
    print("PASS phone: 휴대폰+손+책없음 → PHONE")


def test_absent():
    d = make_engine().decide(absent_facts())
    assert d.activity == A.ABSENT, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert any("검출되지 않음" in r for r in d.reasons)
    print("PASS absent: 사람/얼굴/자세/손 모두 미검출 → ABSENT")


def test_sleeping():
    d = make_engine().decide(sleeping_facts())
    # v0.1 보수 정책: SLEEPING 또는 (애매하면)UNKNOWN 허용
    assert d.activity in (A.SLEEPING, A.UNKNOWN), d.activity
    if d.activity == A.SLEEPING:
        assert d.confidence <= 0.75, "수면 confidence 상한(보수)"
    print(f"PASS sleeping: 자세O/손·얼굴 가시성 낮음 → {d.activity}(보수)")


def test_low_quality_unknown():
    d = make_engine().decide(low_quality_facts())
    assert d.activity == A.UNKNOWN
    assert d.status == A.STATUS_LOW_CONFIDENCE
    assert d.confidence == 0.0
    print("PASS low_quality: 품질 낮음 → UNKNOWN/LOW_CONFIDENCE")


def test_none_skipped():
    d = make_engine().decide(None)
    assert d.activity == A.UNKNOWN
    assert d.status == A.STATUS_SKIPPED
    assert isinstance(d, RuleDecision)
    print("PASS none: seat_facts None → SKIPPED")


def test_conflict_unknown():
    d = make_engine().decide(conflict_facts())
    assert d.activity == A.UNKNOWN, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert any("충돌" in r for r in d.reasons)
    print("PASS conflict: phone vs studying 충돌 → UNKNOWN")


def test_decision_fields_and_records():
    d = make_engine().decide(studying_facts())
    # 필드 존재
    assert d.decision_uuid and d.facts_uuid and d.seat_id == "Seat1"
    assert d.period_id == "P0" and d.decided_at is not None
    # evidence 필수 키
    for k in ("overall_quality", "face_detected", "phone_detected",
              "hands_visible_ratio", "max_person_count"):
        assert k in d.evidence, k
    # reasons / rule_hits / quality 기록
    assert d.reasons and isinstance(d.rule_hits, list) and d.rule_hits
    assert d.quality.get("overall_quality") == 0.8667
    assert any(h["rule"] == "studying_rule" and h["fired"] for h in d.rule_hits)
    print("PASS fields: decision 필드 + evidence/reasons/rule_hits/quality 기록")


def test_no_powernap_activity():
    # 파워냅은 AI activity 가 아니다(수동 상태). 표준 activity 에 없어야 한다.
    for forbidden in ("POWERNAP", "POWER_NAP", "NAP", "파워냅"):
        assert forbidden not in A.ACTIVITIES
    assert set(A.ACTIVITIES) == {A.STUDYING, A.PHONE, A.SLEEPING, A.ABSENT, A.UNKNOWN}
    print("PASS no_powernap: 파워냅 activity 없음(수동 상태로 유지)")


def test_config_thresholds_used():
    # 임계값을 도달 불가(>1.0)로 높이면 STUDYING 후보도 확정 안 됨 → UNKNOWN
    cfg = {"thresholds": {"min_overall_quality": 0.3, "studying_confidence": 1.01,
                          "phone_confidence": 1.01, "absent_confidence": 1.01,
                          "sleeping_confidence": 1.01, "conflict_margin": 0.15,
                          "sleeping_confidence_cap": 0.75}}
    d = make_engine(config=cfg).decide(studying_facts())
    assert d.activity == A.UNKNOWN, d.activity
    # rule 은 평가됐지만(fired=False) 확정 안 됨
    assert any(h["rule"] == "studying_rule" for h in d.rule_hits)
    print("PASS config: 임계값을 config 에서 읽어 판정에 반영")


def test_fusion_engine_intact():
    # 기존 FactsFusionEngine 테스트가 깨지지 않는지(임포트/기본 동작) 확인
    from facts_fusion_engine import FactsFusionEngine
    from fusion_result import FUSION_SKIPPED
    fe = FactsFusionEngine(); fe.initialize()
    fr = fe.fuse([])
    assert fr.status == FUSION_SKIPPED
    print("PASS intact: FactsFusionEngine 동작 유지")


def main():
    test_studying()
    test_phone()
    test_absent()
    test_sleeping()
    test_low_quality_unknown()
    test_none_skipped()
    test_conflict_unknown()
    test_decision_fields_and_records()
    test_no_powernap_activity()
    test_config_thresholds_used()
    test_fusion_engine_intact()
    print("\nALL PASS: studying / phone / absent / sleeping / low_quality / none / "
          "conflict / fields / no_powernap / config / intact")


if __name__ == "__main__":
    main()
