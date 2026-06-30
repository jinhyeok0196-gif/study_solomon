"""
VIGI C420I RTSP 수신 PoC
========================

목적: TP-Link VIGI C420I 카메라 1대의 RTSP 스트림을 Python(OpenCV)에서
      안정적으로 수신할 수 있는지 검증한다.

이 단계에서 하지 않는 것:
  - Camera Service / AI / MediaPipe / YOLO / Supabase 연동 (전부 제외)
  - 이번 스크립트는 "RTSP 스트림이 안정적으로 들어오는지"만 본다.

핵심 동작:
  - .env 의 RTSP_URL 을 읽어 FFmpeg backend 로 연결
  - 영상 GUI 창 출력
  - 1초마다 현재 FPS 콘솔 출력
  - 연결 실패/끊김 시 원인 로그 + 지수 백오프 재연결
  - q 키로 정상 종료
"""

import os
import sys
import time
import logging

# ---------------------------------------------------------------------------
# FFmpeg backend 옵션은 cv2.VideoCapture 생성 "전"에 환경변수로 설정해야 적용된다.
#   - rtsp_transport;tcp : RTSP 를 TCP 로 받아 장시간(10분+) 패킷 유실/깨짐을 줄인다.
#   - stimeout (마이크로초) : 소켓 read 가 막혔을 때 무한 대기하지 않고 타임아웃 → 재연결로 넘어간다.
# ---------------------------------------------------------------------------
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000",
)

import cv2  # noqa: E402  (환경변수 설정 후 import)
import numpy as np  # noqa: E402
from dotenv import load_dotenv  # noqa: E402


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rtsp-poc")

WINDOW_NAME = "VIGI C420I - RTSP PoC"

# 재연결 백오프 설정
RECONNECT_DELAY_START = 2.0   # 첫 재시도 대기(초)
RECONNECT_DELAY_MAX = 30.0    # 최대 대기(초)
# 프레임 읽기 연속 실패가 이 횟수를 넘으면 연결이 끊긴 것으로 보고 재연결
MAX_READ_FAILURES = 30


def sanitize_url(url: str) -> str:
    """로그에 URL 을 남길 때 비밀번호를 가린다. rtsp://user:pass@host -> rtsp://user:****@host"""
    if "@" not in url or "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user = creds.split(":", 1)[0]
        creds = f"{user}:****"
    return f"{scheme}://{creds}@{host}"


def open_capture(url: str) -> "cv2.VideoCapture":
    """FFmpeg backend 를 명시적으로 사용해 VideoCapture 를 연다."""
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    # 지연(latency) 누적을 줄이기 위해 내부 버퍼를 최소화 (backend 가 무시할 수도 있음)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


def log_open_failure_hints(url: str) -> None:
    """연결(open) 실패 시 어느 단계에서 막혔는지 추정할 수 있도록 원인 후보를 출력한다."""
    log.error("RTSP 스트림을 열지 못했습니다: %s", sanitize_url(url))
    log.error("확인할 점:")
    log.error("  1) 카메라 전원/네트워크: ping 192.168.219.50 이 되는지")
    log.error("  2) RTSP 포트(554) 개방 여부 및 방화벽")
    log.error("  3) 아이디/비밀번호가 .env 의 RTSP_URL 에 정확한지 (특수문자는 URL 인코딩)")
    log.error("  4) 스트림 경로: 메인=/stream1, 서브(848x480)=/stream2")
    log.error("  5) VIGI 앱에서 'RTSP/ONVIF' 또는 '서드파티 접근'이 켜져 있는지")
    log.error("  6) opencv-python 에 FFmpeg backend 가 포함됐는지 (print(cv2.getBuildInformation()))")


def make_status_frame(text: str, width: int = 848, height: int = 480) -> "np.ndarray":
    """재연결 대기 중에도 창이 살아 있도록 보여줄 검은 배경 안내 프레임."""
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.putText(frame, text, (30, height // 2), cv2.FONT_HERSHEY_SIMPLEX,
                0.8, (0, 200, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, "press 'q' to quit", (30, height // 2 + 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1, cv2.LINE_AA)
    return frame


def wait_with_quit(seconds: float, status_text: str) -> bool:
    """주어진 시간 동안 대기하되, 그 사이 q 가 눌리면 True 를 반환한다(창도 유지)."""
    frame = make_status_frame(status_text)
    end = time.time() + seconds
    while time.time() < end:
        cv2.imshow(WINDOW_NAME, frame)
        if (cv2.waitKey(100) & 0xFF) == ord("q"):
            return True
    return False


def stream_loop(cap: "cv2.VideoCapture") -> str:
    """
    연결된 capture 에서 프레임을 계속 읽어 출력한다.
    반환값:
      - "quit"      : 사용자가 q 를 눌러 정상 종료
      - "reconnect" : 연결이 끊겨 재연결이 필요
    """
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    log.info("스트림 해상도: %dx%d", width, height)

    frame_count = 0
    fps = 0.0
    last_tick = time.time()
    read_failures = 0

    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            read_failures += 1
            log.warning("프레임 수신 실패 (%d/%d)", read_failures, MAX_READ_FAILURES)
            if read_failures >= MAX_READ_FAILURES:
                log.error("연결이 끊긴 것으로 판단합니다. 재연결을 시도합니다.")
                return "reconnect"
            # 잠깐 쉬고 다시 시도 (이 사이에도 q 입력 처리)
            if (cv2.waitKey(30) & 0xFF) == ord("q"):
                return "quit"
            continue

        read_failures = 0
        frame_count += 1

        # 1초마다 FPS 계산 후 콘솔 출력
        now = time.time()
        elapsed = now - last_tick
        if elapsed >= 1.0:
            fps = frame_count / elapsed
            log.info("FPS: %.1f", fps)
            frame_count = 0
            last_tick = now

        # 화면에도 FPS 오버레이 (보조용)
        cv2.putText(frame, f"FPS: {fps:.1f}", (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2, cv2.LINE_AA)
        cv2.imshow(WINDOW_NAME, frame)

        if (cv2.waitKey(1) & 0xFF) == ord("q"):
            log.info("q 입력 감지 - 정상 종료합니다.")
            return "quit"


def main() -> int:
    load_dotenv()
    url = os.getenv("RTSP_URL")
    if not url:
        log.error(".env 에서 RTSP_URL 을 찾지 못했습니다. .env.example 를 참고해 .env 를 만들어 주세요.")
        return 1

    log.info("RTSP 대상: %s", sanitize_url(url))
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

    reconnect_delay = RECONNECT_DELAY_START
    try:
        while True:
            log.info("RTSP 스트림 연결 시도...")
            cap = open_capture(url)

            if not cap.isOpened():
                log_open_failure_hints(url)
                cap.release()
                if wait_with_quit(reconnect_delay, f"connecting failed - retry in {reconnect_delay:.0f}s"):
                    break
                reconnect_delay = min(reconnect_delay * 2, RECONNECT_DELAY_MAX)
                continue

            log.info("연결 성공.")
            reconnect_delay = RECONNECT_DELAY_START  # 성공 시 백오프 초기화

            result = stream_loop(cap)
            cap.release()

            if result == "quit":
                break
            # result == "reconnect"
            if wait_with_quit(reconnect_delay, f"reconnecting in {reconnect_delay:.0f}s"):
                break
            reconnect_delay = min(reconnect_delay * 2, RECONNECT_DELAY_MAX)
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt - 종료합니다.")
    finally:
        cv2.destroyAllWindows()

    log.info("프로그램을 종료했습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
