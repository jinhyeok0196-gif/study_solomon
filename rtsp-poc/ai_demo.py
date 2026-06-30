"""
AI Engine Core v0.1 - CLI 데모
==============================

Dummy BurstPackage 를 여러 개 만들어 AIManager(DummyAIEngine)로 분석하고
AnalysisResult 를 출력한다. **실제 AI 분석은 없다.**

실행 예시:
  python ai_demo.py --dummy --burst-count 5
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime

from ai_manager import AIManager
from burst_package import BurstPackage

log = logging.getLogger("ai_demo")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon AI Engine Core v0.1 데모")
    p.add_argument("--dummy", action="store_true", help="DummyAIEngine 사용(현재 유일)")
    p.add_argument("--burst-count", type=int, default=3, help="생성할 Dummy BurstPackage 수")
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def make_dummy_burst(i: int) -> BurstPackage:
    seat = f"Seat{i % 8 + 1}"
    now = datetime.now()
    return BurstPackage(
        burst_uuid=uuid.uuid4().hex,
        trigger_uuid=uuid.uuid4().hex,
        trigger_id=f"{now.date().isoformat()}_P0_start_attendance_check",
        trigger_type="start_attendance_check",
        period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=now, frame_count=5,
        frames=[f"{seat}-frame{j}" for j in range(5)],
        metadata={"demo": True},
    )


def main() -> int:
    args = parse_args()
    setup_logging()

    # 현재 등록 엔진은 dummy 뿐. --dummy 가 없어도 dummy 로 동작.
    mgr = AIManager(engine_name="dummy")
    log.info("AIManager health: %s", mgr.health())

    print(f"===== AnalysisResult x {args.burst_count} =====")
    for i in range(args.burst_count):
        burst = make_dummy_burst(i)
        res = mgr.analyze(burst)
        print(f"  seat={res.seat_id} status={res.status} activity={res.activity} "
              f"conf={res.confidence} proc={res.processing_time:.3f}ms "
              f"analysis_uuid={res.analysis_uuid[:8]} burst_uuid={res.burst_uuid[:8]} "
              f"meta={res.metadata}")

    print("----- 최종 health -----")
    print(f"  {mgr.health()}")
    mgr.unload_engine()
    return 0


if __name__ == "__main__":
    sys.exit(main())
