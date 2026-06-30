"""
Solomon Rule Engine v0.1 - CLI 데모
===================================

Fake SeatFacts 를 만들어 RuleEngine.decide() 결과(RuleDecision)를 출력한다.
**저장/표시/학생 상태 변경/알림은 하지 않는다** — 판정 결과 생성까지만.

실행 예시:
  python rule_demo.py --studying
  python rule_demo.py --phone
  python rule_demo.py --absent
  python rule_demo.py --sleeping
  python rule_demo.py --unknown
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime

from seat_facts import SeatFacts
from rule_engine import RuleEngine


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def _facts(human, objects, quality, vision=None, seat="Seat1") -> SeatFacts:
    now = datetime.now()
    return SeatFacts(
        facts_uuid=uuid.uuid4().hex, burst_uuid="demo-burst", seat_id=seat,
        period_id="P0", period_name="0교시", captured_at=now, generated_at=now,
        vision=vision or {"valid_frames": 5, "resolution": "320x240"},
        human=human, objects=objects, quality=quality,
        source_results=["o", "m", "y"], metadata={},
    )


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
        vision={"valid_frames": 5, "resolution": "320x240"})


def sleeping_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.1, "hands_detected": False,
               "hands_visible_ratio": 0.05, "pose_detected": True, "pose_visible_ratio": 0.7},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.6, "object_quality": 0.2,
                 "overall_quality": 0.6, "usable_for_rule_engine": True})


def unknown_facts():
    return _facts(
        human={"face_detected": False, "hands_detected": False, "pose_detected": False},
        objects={"phone_detected": False, "person_detected": False},
        quality={"vision_quality": 0.0, "human_quality": 0.1, "object_quality": 0.1,
                 "overall_quality": 0.0667, "usable_for_rule_engine": False})


def parse_args():
    p = argparse.ArgumentParser(description="Solomon Rule Engine v0.1 데모")
    m = p.add_mutually_exclusive_group()
    m.add_argument("--studying", action="store_true")
    m.add_argument("--phone", action="store_true")
    m.add_argument("--absent", action="store_true")
    m.add_argument("--sleeping", action="store_true")
    m.add_argument("--unknown", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    setup_logging()

    if args.phone:
        sf = phone_facts()
    elif args.absent:
        sf = absent_facts()
    elif args.sleeping:
        sf = sleeping_facts()
    elif args.unknown:
        sf = unknown_facts()
    else:  # --studying (기본)
        sf = studying_facts()

    eng = RuleEngine()
    eng.initialize()
    d = eng.decide(sf)

    print("===== RuleDecision =====")
    print(f"  seat={d.seat_id} activity={d.activity} confidence={d.confidence} "
          f"status={d.status} severity={d.severity}")
    print(f"  reasons={d.reasons}")
    print(f"  rule_hits={d.rule_hits}")
    print(f"  evidence={d.evidence}")
    eng.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
