"""
Solomon Facts Fusion Engine v0.1 - CLI 데모
===========================================

OpenCV / MediaPipe / YOLO 의 AnalysisResult 를 만들어 FactsFusionEngine 으로 합치고
**SeatFacts** 를 출력한다. **행동 판별은 절대 하지 않는다** — 관측된 사실만 합친다.

MediaPipe/YOLO 결과는 실제 엔진(Fake backend)으로 생성하고, OpenCV 결과는 (cv2 미설치 환경
대비) 실제 OpenCVEngine 의 출력 스키마와 동일한 합성 AnalysisResult 로 만든다.

실행 예시:
  python fusion_demo.py --all                # 세 엔진 결과 모두 → SUCCESS
  python fusion_demo.py --missing-yolo       # YOLO 누락 → PARTIAL
  python fusion_demo.py --failed-mediapipe   # MediaPipe FAILED → PARTIAL
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime

import numpy as np

from analysis_result import (
    AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS,
)
from burst_package import BurstPackage
from plugins.mediapipe_engine import MediaPipeEngine
from mediapipe_backend import FakeMediaPipeBackend
from plugins.yolo_engine import YOLOEngine
from yolo_backend import FakeYOLOBackend
from facts_fusion_engine import FactsFusionEngine


def parse_args():
    p = argparse.ArgumentParser(description="Solomon Facts Fusion Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="세 엔진 결과 모두(기본)")
    mode.add_argument("--missing-yolo", action="store_true", help="YOLO 결과 누락")
    mode.add_argument("--failed-mediapipe", action="store_true", help="MediaPipe FAILED")
    return p.parse_args()


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


class _Item:
    def __init__(self, img, ts):
        self.frame = img; self.timestamp = ts; self.frame_index = 0


def _burst(seat="Seat1"):
    rng = np.random.RandomState(0)
    frames = [_Item(rng.randint(40, 220, (240, 320, 3), dtype=np.uint8), float(i))
              for i in range(6)]
    return BurstPackage(
        burst_uuid="demo-burst", trigger_uuid="demo", trigger_id="demo_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )


def opencv_result(seat="Seat1") -> AnalysisResult:
    """실제 OpenCVEngine.analyze() 출력 스키마와 동일한 합성 결과."""
    now = datetime.now()
    return AnalysisResult(
        analysis_uuid=uuid.uuid4().hex, burst_uuid="demo-burst", seat_id=seat,
        started_at=now, finished_at=now, processing_time=1.2,
        confidence=0.0, status=STATUS_SUCCESS, activity=ACTIVITY_UNKNOWN,
        scores={"blur_score": 120.5, "brightness": 118.3,
                "contrast": 45.2, "sharpness": 30.1},
        metadata={
            "engine": "opencv",
            "vision": {"vision_uuid": uuid.uuid4().hex, "frame_count": 6,
                       "valid_frames": 5, "roi_applied": False, "resolution": "320x240"},
            "discarded_frames": 1, "discard_reasons": {"too_dark": 1},
        },
    )


def mediapipe_result(burst, fail=False) -> AnalysisResult:
    backend = FakeMediaPipeBackend(fail=fail)
    eng = MediaPipeEngine(backend=backend)
    eng.initialize()
    return eng.analyze(burst)


def yolo_result(burst) -> AnalysisResult:
    eng = YOLOEngine(backend=FakeYOLOBackend())
    eng.initialize()
    return eng.analyze(burst)


def main() -> int:
    args = parse_args()
    setup_logging()
    burst = _burst()

    results = [opencv_result()]
    if args.failed_mediapipe:
        results.append(mediapipe_result(burst, fail=True))
        results.append(yolo_result(burst))
    elif args.missing_yolo:
        results.append(mediapipe_result(burst))
    else:  # --all (기본)
        results.append(mediapipe_result(burst))
        results.append(yolo_result(burst))

    fusion = FactsFusionEngine()
    fusion.initialize()
    fr = fusion.fuse(results, context={
        "seat_id": "Seat1", "burst_uuid": "demo-burst",
        "period_id": "P0", "period_name": "0교시", "captured_at": burst.captured_at,
    })

    print("===== FusionResult =====")
    print(f"  status={fr.status} seat={fr.seat_id} burst={fr.burst_uuid}")
    print(f"  missing_sources={fr.missing_sources} errors={fr.errors}")
    sf = fr.seat_facts
    if sf is None:
        print("  seat_facts=None (생성 불가)")
        return 0
    q = sf.quality
    print("===== SeatFacts =====")
    print(f"  source_results={sf.source_results}")
    print(f"  quality: vision={q['vision_quality']} human={q['human_quality']} "
          f"object={q['object_quality']} overall={q['overall_quality']} "
          f"usable_for_rule_engine={q['usable_for_rule_engine']}")
    print(f"  vision={sf.vision}")
    print(f"  human={sf.human}")
    print(f"  objects={sf.objects}")
    fusion.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
