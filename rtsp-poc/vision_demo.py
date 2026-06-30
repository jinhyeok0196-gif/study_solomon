"""
OpenCV Vision Engine v0.1 - CLI 데모
===================================

Dummy BurstPackage(합성 프레임) 또는 실제 CameraManager 의 프레임을
OpenCVEngine 으로 전처리·품질검사하고 결과를 출력한다. **AI 판별 없음.**

실행 예시:
  python vision_demo.py --dummy --frames 6
  python vision_demo.py --real --seat 1            # cameras.yaml + 실제 카메라 필요
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

import numpy as np

from burst_package import BurstPackage
from plugins.opencv_engine import OpenCVEngine

log = logging.getLogger("vision_demo")


def parse_args():
    p = argparse.ArgumentParser(description="Solomon OpenCV Vision Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--dummy", action="store_true", help="합성 프레임 사용(기본)")
    mode.add_argument("--real", action="store_true", help="실제 CameraManager 사용")
    p.add_argument("--frames", type=int, default=6, help="--dummy 합성 프레임 수")
    p.add_argument("--seat", type=int, default=1, help="--real 대상 좌석 번호")
    return p.parse_args()


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def _frame(kind, seed=0):
    rng = np.random.RandomState(seed)
    if kind == "normal":
        return rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)
    if kind == "dark":
        return np.full((240, 320, 3), 5, dtype=np.uint8)
    if kind == "blur":
        return np.full((240, 320, 3), 128, dtype=np.uint8)
    return None  # corrupt/empty


class _Item:
    def __init__(self, img, ts):
        self.frame = img
        self.timestamp = ts
        self.frame_index = 0


def build_dummy(n):
    kinds = ["normal", "normal", "dark", "blur", "normal", None]
    items = []
    for i in range(n):
        k = kinds[i % len(kinds)]
        items.append(_Item(_frame(k, i) if k else None, float(i)))
    return BurstPackage(
        burst_uuid="demo", trigger_uuid="demo", trigger_id="demo_P0_x",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id="Seat1", captured_at=datetime.now(),
        frame_count=len(items), frames=items, metadata={},
    )


def build_real(seat_no):
    from camera_manager import CameraManager
    from camera_config import load_camera_configs
    from dotenv import load_dotenv
    import os, time
    load_dotenv()
    here = os.path.dirname(os.path.abspath(__file__))
    cm = CameraManager(load_camera_configs(os.path.join(here, "cameras.yaml")), status_interval=5.0)
    seat = f"Seat{seat_no}"
    cm.start_camera(seat)
    time.sleep(3.0)  # 프레임 수집 대기
    frames = cm.get_recent_frames(seat, seconds=3)
    pkg = BurstPackage(
        burst_uuid="real", trigger_uuid="real", trigger_id="real_P0_x",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )
    return cm, pkg


def main() -> int:
    args = parse_args()
    setup_logging()

    eng = OpenCVEngine()
    eng.initialize()

    cm = None
    if args.real:
        cm, pkg = build_real(args.seat)
    else:
        pkg = build_dummy(args.frames)

    res = eng.analyze(pkg)
    vr = eng.last_vision

    print("===== VisionResult =====")
    print(f"  seat={pkg.seat_id} frames={vr.frame_count} valid={vr.valid_frames} "
          f"roi_applied={vr.roi_applied} resolution={vr.metadata.get('resolution')}")
    print(f"  blur={vr.blur_score} brightness={vr.brightness} "
          f"contrast={vr.contrast} sharpness={vr.sharpness}")
    print(f"  discard_reasons={vr.metadata['discard_reasons']}")
    print("===== AnalysisResult =====")
    print(f"  status={res.status} activity={res.activity} conf={res.confidence} "
          f"proc={res.processing_time:.2f}ms discarded={res.metadata['discarded_frames']}")
    print(f"  scores={res.scores}")

    if cm is not None and hasattr(cm, "stop_all"):
        cm.stop_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
