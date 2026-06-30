"""
AI Decision Stabilizer v0.1 테스트.

최근 RuleDecision/ row dict 묶음 → DecisionStabilizer → StabilizedDecision 검증.

검증:
  - PHONE 3/5 → STABLE PHONE
  - STUDYING 4/5 → STABLE STUDYING
  - ABSENT 2/5(+UNKNOWN 다수) → 보수적(UNSTABLE/UNKNOWN)
  - SLEEPING 3/5 → STABLE + severity WATCH 이하
  - 입력 0개 → INSUFFICIENT_DATA / UNKNOWN
  - 입력 2개 미만 → INSUFFICIENT_DATA / UNKNOWN
  - PHONE/STUDYING 충돌 → CONFLICTED / UNKNOWN
  - LOW_CONFIDENCE 다수 → LOW_CONFIDENCE / UNKNOWN
  - 오래된 decision 제외
  - 최신 decision 가중치 적용
  - RuleDecision 객체 입력 / Supabase row dict 입력 둘 다 처리
  - source_decision_uuids / evidence 기록
  - 학생 상태 변경/알림/벌점/출결 코드 없음(소스 스캔)
  - 기존 RuleEngine / Storage 테스트 미파손
"""
import os
import uuid
from datetime import datetime, timedelta

import activity_labels as A
from rule_decision import RuleDecision
from stabilized_decision import (
    StabilizedDecision, STAB_STABLE, STAB_UNSTABLE, STAB_INSUFFICIENT,
    STAB_LOW_CONFIDENCE, STAB_CONFLICTED,
)
from decision_stabilizer import DecisionStabilizer

BASE = datetime(2026, 6, 30, 9, 30)


def dec(activity, confidence, minutes_ago, status=A.STATUS_SUCCESS, seat="Seat1"):
    return RuleDecision(
        decision_uuid=uuid.uuid4().hex[:8], facts_uuid="f", burst_uuid="b",
        seat_id=seat, period_id="P0", period_name="0교시",
        decided_at=BASE - timedelta(minutes=minutes_ago),
        activity=activity, confidence=confidence, status=status,
        severity=A.SEVERITY_INFO, reasons=[], evidence={}, rule_hits=[], quality={}, metadata={})


def row(activity, confidence, minutes_ago, status=A.STATUS_SUCCESS, seat="Seat1"):
    """Supabase ai_rule_decisions row dict 형태(decided_at = ISO 문자열)."""
    return {
        "id": uuid.uuid4().hex, "decision_uuid": uuid.uuid4().hex[:8],
        "seat_id": seat, "activity": activity, "confidence": confidence,
        "status": status, "severity": "INFO",
        "decided_at": (BASE - timedelta(minutes=minutes_ago)).isoformat(),
    }


def make(config=None):
    eng = DecisionStabilizer(config=config)
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_phone_stable():
    eng = make()
    sd = eng.stabilize([dec(A.PHONE, 0.8, 0), dec(A.PHONE, 0.78, 1), dec(A.STUDYING, 0.6, 2),
                        dec(A.PHONE, 0.82, 3), dec(A.STUDYING, 0.6, 4)])
    assert sd.status == STAB_STABLE and sd.activity == A.PHONE, (sd.status, sd.activity)
    assert sd.activity_counts.get(A.PHONE) == 3
    assert sd.severity == A.SEVERITY_WARNING
    assert any("PHONE 3회" in r for r in sd.reasons)
    print("PASS phone_stable: PHONE 3/5 → STABLE PHONE")


def test_studying_stable():
    eng = make()
    sd = eng.stabilize([dec(A.STUDYING, 0.9, 0), dec(A.STUDYING, 0.85, 1), dec(A.STUDYING, 0.88, 2),
                        dec(A.PHONE, 0.66, 3), dec(A.STUDYING, 0.8, 4)])
    assert sd.status == STAB_STABLE and sd.activity == A.STUDYING
    assert sd.activity_counts.get(A.STUDYING) == 4
    print("PASS studying_stable: STUDYING 4/5 → STABLE STUDYING")


def test_absent_conservative():
    eng = make()
    sd = eng.stabilize([dec(A.ABSENT, 0.7, 0), dec(A.UNKNOWN, 0.0, 1, A.STATUS_LOW_CONFIDENCE),
                        dec(A.ABSENT, 0.7, 2), dec(A.UNKNOWN, 0.0, 3, A.STATUS_LOW_CONFIDENCE),
                        dec(A.UNKNOWN, 0.0, 4, A.STATUS_LOW_CONFIDENCE)])
    # 자리비움은 보수적 → 우세 비율 낮아 STABLE 아님
    assert sd.status in (STAB_UNSTABLE, STAB_LOW_CONFIDENCE)
    assert sd.activity == A.UNKNOWN
    print(f"PASS absent_conservative: ABSENT 2/5 → {sd.status}(보수)")


def test_sleeping_watch_severity():
    eng = make()
    sd = eng.stabilize([dec(A.SLEEPING, 0.7, 0), dec(A.SLEEPING, 0.72, 1), dec(A.SLEEPING, 0.68, 2),
                        dec(A.STUDYING, 0.6, 3), dec(A.SLEEPING, 0.7, 4)])
    assert sd.activity == A.SLEEPING and sd.status == STAB_STABLE
    assert sd.severity in (A.SEVERITY_INFO, A.SEVERITY_WATCH), "수면은 WATCH 이하"
    print("PASS sleeping_watch: SLEEPING STABLE → severity WATCH 이하")


def test_empty_insufficient():
    sd = make().stabilize([])
    assert sd.status == STAB_INSUFFICIENT and sd.activity == A.UNKNOWN
    assert sd.decision_count == 0
    print("PASS empty: 입력 0개 → INSUFFICIENT_DATA")


def test_too_few_insufficient():
    sd = make().stabilize([dec(A.PHONE, 0.8, 0), dec(A.PHONE, 0.8, 1)])  # 2개 < min 3
    assert sd.status == STAB_INSUFFICIENT and sd.activity == A.UNKNOWN
    print("PASS too_few: 입력 2개 < 최소 3 → INSUFFICIENT_DATA")


def test_conflict():
    eng = make()
    # 4개 교대(PHONE 2 / STUDYING 2): 가중치 합이 매우 가까움 → 충돌
    sd = eng.stabilize([dec(A.PHONE, 0.75, 0), dec(A.STUDYING, 0.76, 1),
                        dec(A.PHONE, 0.74, 2), dec(A.STUDYING, 0.77, 3)])
    assert sd.status == STAB_CONFLICTED and sd.activity == A.UNKNOWN
    assert any("충돌" in r for r in sd.reasons)
    assert sd.evidence["conflict_detected"] is True
    print("PASS conflict: PHONE/STUDYING 충돌 → CONFLICTED UNKNOWN")


def test_low_confidence_majority():
    eng = make()
    # PHONE 다수지만 평균 신뢰도 낮음 → LOW_CONFIDENCE
    sd = eng.stabilize([dec(A.PHONE, 0.2, 0), dec(A.PHONE, 0.25, 1), dec(A.PHONE, 0.3, 2),
                        dec(A.PHONE, 0.2, 3), dec(A.STUDYING, 0.2, 4)])
    assert sd.status == STAB_LOW_CONFIDENCE and sd.activity == A.UNKNOWN
    print("PASS low_conf: 평균 신뢰도 낮음 → LOW_CONFIDENCE UNKNOWN")


def test_old_decisions_excluded():
    eng = make()  # max_age_minutes=15
    # 최근 3개 PHONE + 오래된 2개 STUDYING(20~30분 전) → 오래된 것 제외, PHONE 3개만
    sd = eng.stabilize([dec(A.PHONE, 0.8, 0), dec(A.PHONE, 0.8, 1), dec(A.PHONE, 0.8, 2),
                        dec(A.STUDYING, 0.8, 20), dec(A.STUDYING, 0.8, 30)])
    assert sd.evidence["aged_out"] == 2
    assert sd.decision_count == 3
    assert sd.status == STAB_STABLE and sd.activity == A.PHONE
    print("PASS old_excluded: 오래된 판정 제외(aged_out=2)")


def test_latest_weight_applied():
    eng = make()
    # 원시 count 는 PHONE 2 / STUDYING 2 (동률)지만, 최신 가중(1.2) + STUDYING 전부
    # LOW_CONFIDENCE(가중 0.5) → PHONE 가중합이 우세해 STABLE PHONE.
    sd = eng.stabilize([dec(A.PHONE, 0.9, 0), dec(A.STUDYING, 0.6, 1, A.STATUS_LOW_CONFIDENCE),
                        dec(A.STUDYING, 0.6, 2, A.STATUS_LOW_CONFIDENCE), dec(A.PHONE, 0.9, 3)])
    assert sd.evidence["latest_activity"] == A.PHONE
    assert sd.status == STAB_STABLE and sd.activity == A.PHONE, (sd.status, sd.activity)
    print("PASS latest_weight: 최신+신뢰가중으로 동률을 깨고 STABLE PHONE")


def test_row_dict_input():
    eng = make()
    sd = eng.stabilize([row(A.PHONE, 0.8, 0), row(A.PHONE, 0.78, 1), row(A.STUDYING, 0.6, 2),
                        row(A.PHONE, 0.82, 3), row(A.STUDYING, 0.6, 4)])
    assert sd.status == STAB_STABLE and sd.activity == A.PHONE
    assert len(sd.source_decision_uuids) == 5
    print("PASS row_dict: Supabase row dict 입력 처리")


def test_stabilize_by_seat_and_records():
    eng = make()
    out = eng.stabilize_by_seat({
        "Seat1": [dec(A.PHONE, 0.8, 0, seat="Seat1"), dec(A.PHONE, 0.8, 1, seat="Seat1"),
                  dec(A.PHONE, 0.8, 2, seat="Seat1")],
        "Seat2": [dec(A.STUDYING, 0.9, 0, seat="Seat2"), dec(A.STUDYING, 0.9, 1, seat="Seat2"),
                  dec(A.STUDYING, 0.9, 2, seat="Seat2")],
    })
    assert out["Seat1"].activity == A.PHONE and out["Seat1"].seat_id == "Seat1"
    assert out["Seat2"].activity == A.STUDYING
    sd = out["Seat1"]
    assert isinstance(sd, StabilizedDecision)
    for k in ("total_decisions", "valid_decisions", "activity_counts", "source_decision_uuids"):
        assert k in sd.evidence, k
    assert sd.source_decision_uuids and sd.confidence_by_activity
    print("PASS by_seat: stabilize_by_seat + evidence/source 기록")


def test_no_side_effects():
    here = os.path.dirname(os.path.abspath(__file__))
    files = ["decision_stabilizer.py", "stabilized_decision.py",
             "ai_decision_stabilizer_repository.py"]
    # 학생 도메인 "코드" 토큰(영문 식별자) — 한글 disclaimer 주석과 충돌하지 않게,
    # 그리고 weight 이름 low_confidence_penalty 와도 충돌하지 않게 구체적으로.
    forbidden = ["penalty_record", "penalty_points", "attendance_record", "power_nap_log",
                 "notification", "membership_status", "student_profiles",
                 ".insert(", ".update(", ".delete("]
    for fn in files:
        with open(os.path.join(here, fn), "r", encoding="utf-8") as f:
            src = f.read().lower()
        for tok in forbidden:
            assert tok not in src, f"{fn} 에 금지 토큰 '{tok}'"
    print("PASS no_side_effects: 학생상태/알림/벌점/출결/쓰기 코드 없음")


def test_existing_modules_intact():
    from rule_engine import RuleEngine
    from ai_decision_storage_pipeline import AIDecisionStoragePipeline
    re = RuleEngine(); re.initialize()
    assert re.decide(None).status == A.STATUS_SKIPPED
    AIDecisionStoragePipeline(save_enabled=False)  # import/생성 OK
    print("PASS intact: RuleEngine / Storage 동작 유지")


def main():
    test_phone_stable()
    test_studying_stable()
    test_absent_conservative()
    test_sleeping_watch_severity()
    test_empty_insufficient()
    test_too_few_insufficient()
    test_conflict()
    test_low_confidence_majority()
    test_old_decisions_excluded()
    test_latest_weight_applied()
    test_row_dict_input()
    test_stabilize_by_seat_and_records()
    test_no_side_effects()
    test_existing_modules_intact()
    print("\nALL PASS: phone / studying / absent / sleeping / empty / too_few / conflict / "
          "low_conf / old_excluded / latest_weight / row_dict / by_seat / no_side_effects / intact")


if __name__ == "__main__":
    main()
