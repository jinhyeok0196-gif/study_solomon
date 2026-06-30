"""
CameraManager v0.1 - 실행 엔트리포인트
======================================

cameras.yaml 의 Seat1~Seat8 설정으로 CameraManager 를 띄운다.

실행 예시:
  python manage.py --single-seat 1                 # Seat1 1대만
  python manage.py --all                           # enabled=true 인 전체
  python manage.py --all --headless --duration 600 # 서버 10분
  python manage.py --single-seat 1 --health-interval 5

종료: 일반 모드 q, headless 모드 Ctrl+C, 또는 --duration 도달.
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import sys
import time

# camera_core(→camera_manager) 를 cv2 보다 먼저 import 해야 FFmpeg 옵션(env)이 적용된다.
from camera_manager import CameraManager
from camera_config import load_camera_configs, normalize_seat_id
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

log = logging.getLogger("manage")

WINDOW_NAME = "Solomon CameraManager v0.1"
DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cameras.yaml")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon CameraManager v0.1 (8대 카메라 관리)")
    target = p.add_mutually_exclusive_group()
    target.add_argument("--single-seat", type=int, metavar="N",
                        help="해당 좌석 1대만 실행 (예: --single-seat 1)")
    target.add_argument("--all", action="store_true",
                        help="enabled=true 인 모든 좌석 실행")
    p.add_argument("--headless", action="store_true", help="영상 창 없이 로그만 출력")
    p.add_argument("--duration", type=float, default=0.0, help="N초 후 자동 종료(0=무한)")
    p.add_argument("--health-interval", type=float, default=5.0,
                   help="get_all_health() 출력 주기(초), 기본 5")
    p.add_argument("--config", default=DEFAULT_CONFIG, help="카메라 설정 파일 경로")
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def print_health(mgr: CameraManager) -> None:
    log.info("===== HEALTH (%d seats) =====", len(mgr.seat_ids))
    for h in mgr.get_all_health():
        age = f"{h['last_frame_age']:.1f}s" if h["last_frame_age"] is not None else "N/A"
        log.info("  %-6s [%s] enabled=%s running=%s connected=%s fps=%.1f res=%s "
                 "frames=%d last=%s reconnects=%d buf=%d",
                 h["seat_id"], h["name"], h["enabled"], h["running"], h["connected"],
                 h["fps"], h["resolution"], h["frames_received"], age,
                 h["reconnects"], h["buffer_len"])


def make_thumb(frame, seat: str, cell=(320, 180)):
    w, h = cell
    if frame is None:
        thumb = np.zeros((h, w, 3), dtype=np.uint8)
        cv2.putText(thumb, f"{seat}: no frame", (10, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (90, 90, 90), 1, cv2.LINE_AA)
    else:
        thumb = cv2.resize(frame, (w, h))
        cv2.putText(thumb, seat, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (0, 255, 0), 2, cv2.LINE_AA)
    return thumb


def build_montage(items, cell=(320, 180)):
    """[(seat, frame|None), ...] 를 격자(montage)로 합친다."""
    n = max(1, len(items))
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    w, h = cell
    canvas = np.zeros((rows * h, cols * w, 3), dtype=np.uint8)
    for i, (seat, frame) in enumerate(items):
        r, c = divmod(i, cols)
        canvas[r * h:(r + 1) * h, c * w:(c + 1) * w] = make_thumb(frame, seat, cell)
    return canvas


def main() -> int:
    args = parse_args()
    setup_logging()
    load_dotenv()

    try:
        configs = load_camera_configs(args.config)
    except Exception as exc:
        log.error("설정 로드 실패: %s", exc)
        return 1

    mgr = CameraManager(configs, status_interval=args.health_interval)

    # 실행 대상 선택
    if args.single_seat is not None:
        mgr.start_camera(normalize_seat_id(args.single_seat))
    elif args.all:
        mgr.start_all()
    else:
        log.error("실행 대상을 지정하세요: --single-seat N 또는 --all")
        return 1

    if not any(mgr.get_camera(s) for s in mgr.seat_ids):
        log.error("실행된 카메라가 없습니다. cameras.yaml 의 enabled / .env 의 RTSP URL 을 확인하세요.")
        mgr.stop_all()
        return 1

    if not args.headless:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

    start = time.time()
    last_health = 0.0
    exit_code = 0
    try:
        while True:
            now = time.time()
            if args.duration and (now - start) >= args.duration:
                log.info("지정 실행 시간(%.0fs) 도달 - 종료", args.duration)
                break

            if now - last_health >= args.health_interval:
                print_health(mgr)
                last_health = now

            if args.headless:
                time.sleep(0.1)
            else:
                running = [s for s in mgr.seat_ids if mgr.get_camera(s)]
                items = []
                for s in running:
                    it = mgr.get_latest_frame(s)
                    items.append((s, it.frame if it is not None else None))
                if items:
                    cv2.imshow(WINDOW_NAME, build_montage(items))
                if (cv2.waitKey(1) & 0xFF) == ord("q"):
                    log.info("q 입력 - 종료합니다.")
                    break
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt - 종료합니다.")
    except Exception as exc:
        log.exception("메인 루프 예외: %s", exc)
        exit_code = 1
    finally:
        mgr.stop_all()
        if not args.headless:
            cv2.destroyAllWindows()

    log.info("프로그램 종료 (exit=%d)", exit_code)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
