"""
Solomon AI Decision Stabilizer v0.1 - CLI 데모
==============================================

Fake RuleDecision(또는 row dict) 목록을 만들어 DecisionStabilizer 를 돌리고
좌석별 **안정화된 AI 후보**(StabilizedDecision)를 출력한다.

⚠️ 결과는 "안정화된 AI 후보" 일 뿐 실제 학생 상태가 아니다.
   학생 상태 변경/출결/벌점/알림은 하지 않는다.

실행 예시:
  python stabilizer_demo.py --phone
  python stabilizer_demo.py --studying
  python stabilizer_demo.py --absent
  python stabilizer_demo.py --sleeping
  python stabilizer_demo.py --conflict
  python stabilizer_demo.py --insufficient
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime, timedelta

import activity_labels as A
from rule_decision import RuleDecision
from decision_stabilizer import DecisionStabilizer


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def _decision(activity, confidence, minutes_ago, status=A.STATUS_SUCCESS, seat="Seat1"):
    """fake RuleDecision (decided_at 은 base 시각에서 minutes_ago 전)."""
    base = datetime(2026, 6, 30, 9, 30)
    return RuleDecision(
        decision_uuid=uuid.uuid4().hex[:8], facts_uuid="f", burst_uuid="b",
        seat_id=seat, period_id="P0", period_name="0교시",
        decided_at=base - timedelta(minutes=minutes_ago),
        activity=activity, confidence=confidence, status=status,
        severity=A.ACTIVITY_SEVERITY.get(activity, A.SEVERITY_INFO),
        reasons=[f"{activity} 후보"], evidence={}, rule_hits=[], quality={}, metadata={})


def scenario(kind):
    # (minutes_ago 큰 것이 오래된 것) — 최신순은 stabilizer 가 정렬
    if kind == "phone":
        return [_decision(A.PHONE, 0.8, 0), _decision(A.PHONE, 0.78, 1),
                _decision(A.STUDYING, 0.7, 2), _decision(A.PHONE, 0.82, 3),
                _decision(A.STUDYING, 0.6, 4)]
    if kind == "studying":
        return [_decision(A.STUDYING, 0.9, 0), _decision(A.STUDYING, 0.85, 1),
                _decision(A.STUDYING, 0.88, 2), _decision(A.PHONE, 0.66, 3),
                _decision(A.STUDYING, 0.8, 4)]
    if kind == "absent":
        return [_decision(A.ABSENT, 0.7, 0), _decision(A.UNKNOWN, 0.0, 1, A.STATUS_LOW_CONFIDENCE),
                _decision(A.ABSENT, 0.7, 2), _decision(A.UNKNOWN, 0.0, 3, A.STATUS_LOW_CONFIDENCE),
                _decision(A.UNKNOWN, 0.0, 4, A.STATUS_LOW_CONFIDENCE)]
    if kind == "sleeping":
        return [_decision(A.SLEEPING, 0.7, 0), _decision(A.SLEEPING, 0.72, 1),
                _decision(A.SLEEPING, 0.68, 2), _decision(A.STUDYING, 0.6, 3),
                _decision(A.SLEEPING, 0.7, 4)]
    if kind == "conflict":
        return [_decision(A.PHONE, 0.75, 0), _decision(A.STUDYING, 0.76, 1),
                _decision(A.PHONE, 0.74, 2), _decision(A.STUDYING, 0.77, 3)]
    if kind == "insufficient":
        return [_decision(A.PHONE, 0.8, 0)]
    return []


def parse_args():
    p = argparse.ArgumentParser(description="Solomon AI Decision Stabilizer v0.1 데모")
    m = p.add_mutually_exclusive_group()
    for k in ("phone", "studying", "absent", "sleeping", "conflict", "insufficient"):
        m.add_argument(f"--{k}", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    setup_logging()
    kind = next((k for k in ("phone", "studying", "absent", "sleeping", "conflict", "insufficient")
                 if getattr(args, k)), "phone")

    eng = DecisionStabilizer()
    eng.initialize()
    sd = eng.stabilize(scenario(kind))

    print(f"===== StabilizedDecision ({kind}) =====")
    print(f"  seat={sd.seat_id} activity={sd.activity} confidence={sd.confidence} "
          f"status={sd.status} severity={sd.severity}")
    print(f"  decision_count={sd.decision_count} window_size={sd.window_size}")
    print(f"  activity_counts={sd.activity_counts}")
    print(f"  confidence_by_activity={sd.confidence_by_activity}")
    print(f"  reasons={sd.reasons}")
    print(f"  source_decision_uuids={sd.source_decision_uuids}")
    print(f"  evidence={sd.evidence}")
    eng.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
