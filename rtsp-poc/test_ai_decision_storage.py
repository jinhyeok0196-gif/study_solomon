"""
AI Decision Storage v0.1 테스트.

**실제 Supabase 연결 없이** FakeAIDecisionRepository 로 통과한다.

검증:
  - serialize_decision 정상 변환(datetime→ISO, JSON 필드)
  - 필수값 누락 시 DecisionValidationError
  - FakeAIDecisionRepository.save_decision 저장
  - Storage Pipeline process 성공(saved=True)
  - 저장 실패 시 success=False
  - save 비활성(save_enabled=False) 시 판정만(saved=False, success=True)
  - get_latest_by_seat / get_recent_by_seat
  - 저장 모듈에 학생 상태 변경/알림/벌점/출결 코드가 없음(소스 스캔)
  - 기존 RuleEngine / FactsFusionEngine 테스트가 깨지지 않음
"""
import os
import uuid
from datetime import datetime

import activity_labels as A
from rule_decision import RuleDecision
from decision_serializer import serialize_decision, DecisionValidationError, REQUIRED_FIELDS
from ai_decision_repository import FakeAIDecisionRepository, RepositoryError
from ai_decision_storage_pipeline import AIDecisionStoragePipeline


# ---- 도우미 ---------------------------------------------------------------
def _decision(seat="Seat1", activity=A.STUDYING, status=A.STATUS_SUCCESS,
              severity=A.SEVERITY_INFO, decided_at=None, **over):
    base = dict(
        decision_uuid=uuid.uuid4().hex, facts_uuid="f1", burst_uuid="b1",
        seat_id=seat, period_id="P0", period_name="0교시",
        decided_at=decided_at or datetime(2026, 6, 30, 9, 0),
        activity=activity, confidence=0.9, status=status, severity=severity,
        reasons=["책 또는 학습 도구가 검출됨"],
        evidence={"overall_quality": 0.8667, "phone_detected": False},
        rule_hits=[{"rule": "studying_rule", "fired": True, "confidence": 1.0}],
        quality={"overall_quality": 0.8667, "usable_for_rule_engine": True},
        metadata={"engine": "rule_engine", "version": "rule-engine-v0.1"})
    base.update(over)
    return RuleDecision(**base)


class _StubSeatFacts:
    """RuleEngine.decide() 가 받는 최소 SeatFacts 스텁(공부 후보)."""
    facts_uuid = "f1"; burst_uuid = "b1"; seat_id = "Seat1"
    period_id = "P0"; period_name = "0교시"
    quality = {"vision_quality": 1.0, "human_quality": 0.9, "object_quality": 0.7,
               "overall_quality": 0.8667, "usable_for_rule_engine": True}
    human = {"face_detected": True, "hands_detected": True, "hands_visible_ratio": 0.7,
             "pose_detected": True}
    objects = {"book_detected": True, "phone_detected": False, "person_detected": True,
               "max_person_count": 1}
    vision = {"valid_frames": 5}


# ---- 테스트 ---------------------------------------------------------------
def test_serialize_ok():
    row = serialize_decision(_decision())
    assert row["decision_uuid"] and row["seat_id"] == "Seat1"
    assert row["activity"] == A.STUDYING and row["status"] == A.STATUS_SUCCESS
    assert row["decided_at"] == "2026-06-30T09:00:00"   # ISO 문자열
    assert isinstance(row["reasons"], list) and isinstance(row["evidence"], dict)
    assert isinstance(row["rule_hits"], list) and isinstance(row["quality"], dict)
    assert row["confidence"] == 0.9
    print("PASS serialize: datetime→ISO + JSON 필드 정상")


def test_serialize_missing_required():
    for field in ("decision_uuid", "seat_id", "activity", "status", "severity"):
        bad = _decision(**{field: ""})
        try:
            serialize_decision(bad)
            assert False, f"{field} 누락인데 예외가 안 났다"
        except DecisionValidationError as e:
            assert field in str(e)
    # decided_at None (직접 None 으로 세팅)
    bad_dt = _decision()
    bad_dt.decided_at = None
    try:
        serialize_decision(bad_dt)
        assert False, "decided_at None 인데 예외가 안 났다"
    except DecisionValidationError:
        pass
    assert set(REQUIRED_FIELDS) == {"decision_uuid", "seat_id", "activity",
                                    "status", "severity", "decided_at"}
    print("PASS serialize_missing: 필수값 누락 → DecisionValidationError")


def test_fake_repo_save():
    repo = FakeAIDecisionRepository(); repo.initialize()
    res = repo.save_decision(_decision())
    assert res["saved"] is True and res["decision_uuid"]
    assert repo.health()["count"] == 1
    print("PASS repo_save: FakeAIDecisionRepository.save_decision 저장")


def test_pipeline_process_success():
    repo = FakeAIDecisionRepository()
    pipe = AIDecisionStoragePipeline(repository=repo, save_enabled=True)
    pipe.initialize()
    res = pipe.process(_StubSeatFacts())
    assert res["success"] is True and res["saved"] is True
    assert res["activity"] == A.STUDYING
    assert repo.health()["count"] == 1
    print("PASS pipeline_success: process → 판정+저장 성공")


def test_pipeline_save_failure():
    repo = FakeAIDecisionRepository(fail=True)
    pipe = AIDecisionStoragePipeline(repository=repo, save_enabled=True)
    pipe.initialize()
    res = pipe.process(_StubSeatFacts())
    assert res["success"] is False and res["saved"] is False
    assert res["error"] and "RepositoryError" in res["error"]
    print("PASS pipeline_fail: 저장 실패 → success=False")


def test_pipeline_save_disabled():
    repo = FakeAIDecisionRepository()
    pipe = AIDecisionStoragePipeline(repository=repo, save_enabled=False)
    pipe.initialize()
    res = pipe.process(_StubSeatFacts())
    assert res["success"] is True and res["saved"] is False
    assert repo.health()["count"] == 0          # 저장 안 함
    print("PASS pipeline_disabled: save_enabled=False → 판정만(저장 생략)")


def test_get_latest_and_recent():
    repo = FakeAIDecisionRepository(); repo.initialize()
    repo.save_decision(_decision(seat="Seat1", decided_at=datetime(2026, 6, 30, 9, 0)))
    repo.save_decision(_decision(seat="Seat1", activity=A.PHONE,
                                 severity=A.SEVERITY_WARNING,
                                 decided_at=datetime(2026, 6, 30, 9, 30)))
    repo.save_decision(_decision(seat="Seat2", decided_at=datetime(2026, 6, 30, 9, 10)))
    latest = repo.get_latest_by_seat("Seat1")
    assert latest["activity"] == A.PHONE        # 더 최근(9:30)
    recent = repo.get_recent_by_seat("Seat1", limit=10)
    assert len(recent) == 2 and recent[0]["decided_at"] >= recent[1]["decided_at"]
    assert repo.get_latest_by_seat("SeatX") is None
    print("PASS get: get_latest_by_seat / get_recent_by_seat")


def test_no_student_state_or_side_effects():
    # 저장 모듈 소스에 학생 상태 변경/알림/벌점/출결 관련 코드가 없어야 한다.
    here = os.path.dirname(os.path.abspath(__file__))
    files = ["ai_decision_repository.py", "ai_decision_storage_pipeline.py",
             "decision_serializer.py", "supabase_client.py"]
    forbidden = ["attendance", "penalty", "notification", "membership",
                 "absence", "power_nap", "student_profiles", "warning_record"]
    for fn in files:
        with open(os.path.join(here, fn), "r", encoding="utf-8") as f:
            src = f.read().lower()
        for tok in forbidden:
            assert tok not in src, f"{fn} 에 금지 토큰 '{tok}' 발견"
    print("PASS no_side_effects: 학생상태/알림/벌점/출결 코드 없음")


def test_existing_engines_intact():
    from rule_engine import RuleEngine
    from facts_fusion_engine import FactsFusionEngine
    from fusion_result import FUSION_SKIPPED
    re = RuleEngine(); re.initialize()
    d = re.decide(None)
    assert d.status == A.STATUS_SKIPPED
    fe = FactsFusionEngine(); fe.initialize()
    assert fe.fuse([]).status == FUSION_SKIPPED
    print("PASS intact: RuleEngine / FactsFusionEngine 동작 유지")


def main():
    test_serialize_ok()
    test_serialize_missing_required()
    test_fake_repo_save()
    test_pipeline_process_success()
    test_pipeline_save_failure()
    test_pipeline_save_disabled()
    test_get_latest_and_recent()
    test_no_student_state_or_side_effects()
    test_existing_engines_intact()
    print("\nALL PASS: serialize / serialize_missing / repo_save / pipeline_success / "
          "pipeline_fail / pipeline_disabled / get / no_side_effects / intact")


if __name__ == "__main__":
    main()
