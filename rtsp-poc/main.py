"""
Camera Core v0.1 - 실행 엔트리포인트
====================================

- .env 의 RTSP_URL 로 CameraCore 1대를 띄운다.
- 일반 모드: 영상 창 출력 + FPS/상태 로그, q 로 종료.
- --headless: 영상 창 없이 FPS/상태 로그만 출력 (서버 환경용), Ctrl+C 로 종료.
- 주기적으로 get_recent_frames(3) 를 호출해 Burst 준비가 동작하는지 로그로 보여준다.

향후 8대 확장: 아래 CameraCore 인스턴스를 카메라 수만큼 만들면 된다(이번엔 1대).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

# camera_core 를 cv2 보다 먼저 import 해야 FFmpeg 옵션(env)이 적용된다.
from camera_core import CameraCore, sanitize_url
import cv2  # noqa: E402
from dotenv import load_dotenv  # noqa: E402


WINDOW_NAME = "Solomon Camera Core v0.1"

log = logging.getLogger("main")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon Camera Core v0.1 (RTSP 수신 코어)")
    p.add_argument("--headless", action="store_true",
                   help="영상 창 없이 로그만 출력 (서버 환경)")
    p.add_argument("--duration", type=float, default=0.0,
                   help="N초 후 자동 종료 (0=무한, 기본 0)")
    p.add_argument("--buffer-seconds", type=float, default=3.0,
                   help="링버퍼 보관 시간(초), 기본 3")
    p.add_argument("--target-fps", type=float, default=10.0,
                   help="FPS 저하 경고 기준이 되는 목표 FPS, 기본 10")
    p.add_argument("--burst-interval", type=float, default=5.0,
                   help="get_recent_frames(3) 데모 로그 주기(초), 기본 5")
    p.add_argument("--name", default="cam0", help="카메라 이름(로그 식별용)")
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def log_burst_preview(core: CameraCore) -> None:
    """get_recent_frames(3) 가 최근 프레임을 잘 반환하는지 로그로 보여준다(향후 AI Burst 진입점)."""
    recent = core.get_recent_frames(seconds=3)
    if recent:
        span = recent[-1].timestamp - recent[0].timestamp
        log.info("[burst] 최근 3초 프레임 %d장 (구간 %.2fs, frame_index %d~%d)",
                 len(recent), span, recent[0].frame_index, recent[-1].frame_index)
    else:
        log.info("[burst] 최근 프레임 없음 (아직 수신 전이거나 끊김)")


def main() -> int:
    args = parse_args()
    setup_logging()

    load_dotenv()
    url = os.getenv("RTSP_URL")
    if not url:
        log.error(".env 에서 RTSP_URL 을 찾지 못했습니다. .env.example 를 참고하세요.")
        return 1

    log.info("실행 모드: %s | 대상: %s", "headless" if args.headless else "display", sanitize_url(url))

    core = CameraCore(
        rtsp_url=url,
        name=args.name,
        buffer_seconds=args.buffer_seconds,
        target_fps=args.target_fps,
    )
    core.start()

    if not args.headless:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

    start = time.time()
    last_burst = 0.0
    exit_code = 0
    try:
        while True:
            now = time.time()
            if args.duration and (now - start) >= args.duration:
                log.info("지정 실행 시간(%.0fs) 도달 - 종료", args.duration)
                break

            # 주기적 Burst 준비 데모
            if now - last_burst >= args.burst_interval:
                log_burst_preview(core)
                last_burst = now

            if args.headless:
                # 창이 없으므로 가볍게 대기 (상태/FPS 로그는 CameraCore 의 모니터 스레드가 출력)
                time.sleep(0.1)
            else:
                item = core.get_latest_frame()
                if item is not None:
                    frame = item.frame.copy()  # 버퍼 원본을 건드리지 않도록 복사 후 오버레이
                    h = core.health()
                    cv2.putText(frame, f"FPS:{h['fps']:.1f} idx:{item.frame_index}",
                                (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                                (0, 255, 0), 2, cv2.LINE_AA)
                    cv2.imshow(WINDOW_NAME, frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    log.info("q 입력 - 종료합니다.")
                    break
                if item is None:
                    time.sleep(0.01)
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt - 종료합니다.")
    except Exception as exc:
        log.exception("메인 루프 예외: %s", exc)
        exit_code = 1
    finally:
        core.stop()
        if not args.headless:
            cv2.destroyAllWindows()

    log.info("프로그램 종료 (exit=%d)", exit_code)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
