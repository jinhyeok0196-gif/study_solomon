"""
Solomon MediaPipe Engine v0.1 - CLI 데모
========================================

BurstPackage 프레임에서 얼굴/손/자세 **원자적 특징(Facts)** 만 추출해 출력한다.
**행동 판별(공부/휴대폰/수면/자리비움)은 절대 하지 않는다** — activity 는 항상 UNKNOWN.

실행 예시:
  python mediapipe_demo.py --fake               # Fake backend(모델 파일 불필요)
  python mediapipe_demo.py --dummy-frames 5     # 합성 프레임 5장, Fake backend
  python mediapipe_demo.py --real --seat 1      # 실제 CameraManager + 실제 모델 파일 필요
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

import numpy as np

from burst_package import BurstPackage
from plugins.mediapipe_engine import MediaPipeEngine
from mediapipe_backend import FakeMediaPipeBackend


def parse_args():
    p = argparse.ArgumentParser(description="Solomon MediaPipe Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--fake", action="store_true",
                      help="Fake backend 사용(기본, 모델 파일 불필요)")
    mode.add_argument("--real", action="store_true",
                      help="실제 MediaPipe backend + CameraManager")
    p.add_argument("--dummy-frames", type=int, default=6,
                   help="합성 프레임 수(Fake 모드)")
    p.add_argument("--seat", type=int, default=1, help="--real 대상 좌석 번호")
    return p.parse_args()


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


class _Item:
    def __init__(self, img, ts):
        self.frame = img
        self.timestamp = ts
        self.frame_index = 0


def build_dummy_burst(n: int) -> BurstPackage:
    rng = np.random.RandomState(0)
    items = []
    for i in range(n):
        # 밝고 디테일 있는 합성 프레임(검증 통과용). 내용 해석은 하지 않는다.
        img = rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)
        items.append(_Item(img, float(i)))
    return BurstPackage(
        burst_uuid="demo", trigger_uuid="demo", trigger_id="demo_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id="Seat1", captured_at=datetime.now(),
        frame_count=len(items), frames=items, metadata={},
    )


def build_real(seat_no: int):
    from camera_manager import CameraManager
    from camera_config import load_camera_configs
    from dotenv import load_dotenv
    import os, time
    load_dotenv()
    here = os.path.dirname(os.path.abspath(__file__))
    cm = CameraManager(load_camera_configs(os.path.join(here, "cameras.yaml")),
                       status_interval=5.0)
    seat = f"Seat{seat_no}"
    cm.start_camera(seat)
    time.sleep(3.0)
    frames = cm.get_recent_frames(seat, seconds=3)
    pkg = BurstPackage(
        burst_uuid="real", trigger_uuid="real", trigger_id="real_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )
    return cm, pkg


def main() -> int:
    args = parse_args()
    setup_logging()

    cm = None
    if args.real:
        eng = MediaPipeEngine()              # real backend (모델 파일 필요)
        cm, pkg = build_real(args.seat)
    else:
        # Fake backend 주입 → mediapipe / 모델 파일 없이 동작
        eng = MediaPipeEngine(backend=FakeMediaPipeBackend())
        pkg = build_dummy_burst(args.dummy_frames)

    eng.initialize()
    res = eng.analyze(pkg)
    mp = eng.last_result

    print("===== MediaPipeResult (원자적 특징만) =====")
    print(f"  seat={pkg.seat_id} frame_count={mp.frame_count} "
          f"analyzed_frames={mp.analyzed_frames} valid_frames={mp.valid_frames}")
    print(f"  face_detected={mp.face_detected} ({mp.face_detection_count}) "
          f"pose_detected={mp.pose_detected} ({mp.pose_detection_count}) "
          f"hands_detected={mp.hands_detected} ({mp.hand_detection_count}) "
          f"max_hands={mp.max_hands}")
    print(f"  quality_score={mp.quality_score}")
    print(f"  head_features={mp.head_features}")
    print(f"  hand_features={mp.hand_features}")
    print(f"  pose_features={mp.pose_features}")
    print("===== AnalysisResult =====")
    print(f"  status={res.status} activity={res.activity} "
          f"confidence(=추출품질)={res.confidence} proc={res.processing_time:.2f}ms")
    print(f"  scores={res.scores}")
    print(f"  detector_status={res.metadata['detector_status']} "
          f"model_paths_loaded={res.metadata['model_paths_loaded']}")

    eng.shutdown()
    if cm is not None and hasattr(cm, "stop_all"):
        cm.stop_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
