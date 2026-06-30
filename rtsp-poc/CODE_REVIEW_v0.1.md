# Camera Core v0.1 — CTO 코드리뷰

> 이 문서는 클립보드 복붙용입니다. 전체 선택(Ctrl/Cmd+A) → 복사해서 사용하세요.

---

# 1. 프로젝트 트리

```
rtsp-poc/                      ← Camera Core v0.1 루트
├── ring_buffer.py             # FrameItem + RingBuffer (deque 기반, OpenCV 비의존)
├── camera_core.py             # CameraCore: Capture 스레드 + Monitor/Health 스레드 + 재연결
├── main.py                    # 엔트리포인트: --headless, Display/Consumer, burst 데모
├── test_camera_core.py        # 카메라 없이 VideoCapture 가짜주입 통합 테스트
├── rtsp_poc.py                # (레거시) 초기 단일파일 PoC
├── requirements.txt           # 런타임 의존성
├── .env.example               # RTSP_URL 템플릿
├── .gitignore                 # .env / venv / __pycache__ 제외
├── CODE_REVIEW_v0.1.md        # (이 문서) CTO 코드리뷰
└── README.md                  # 구조·실행법·문제해결

생성되는 런타임 산출물(비커밋, .gitignore 처리):
  .env          ← 실제 RTSP_URL (비밀번호 포함)
  .venv/        ← 가상환경
  __pycache__/
```

---

# 2. 전체 소스코드

## requirements.txt
```
opencv-python>=4.8.0
python-dotenv>=1.0.0
numpy>=1.24.0
```

## .env.example
```bash
# VIGI C420I RTSP 접속 정보 (실제 값은 .env 에 넣고, .env 는 깃에 올리지 않는다)
#
# 형식: rtsp://아이디:비밀번호@IP:554/스트림경로
#   - 메인 스트림(고해상도)      : /stream1
#   - 서브 스트림(848x480, 권장) : /stream2
#
# 비밀번호에 @ : / 같은 특수문자가 있으면 URL 인코딩 필요
#   예) @ -> %40,  : -> %3A,  # -> %23
#
RTSP_URL=rtsp://admin:YOUR_PASSWORD@192.168.219.50:554/stream2
```

## ring_buffer.py
```python
"""
Ring Buffer
===========

최근 N초 분량의 프레임을 메모리에 보관하는 스레드 세이프 링버퍼.

- collections.deque(maxlen=...) 기반 — 가장 오래된 프레임은 자동으로 밀려난다.
- 각 프레임은 FrameItem(frame, timestamp, frame_index) 로 저장한다.
- get_recent_frames(seconds) 로 향후 AI Engine 이 2~3초 Burst Analysis 를 수행할 수 있다.

이 모듈은 OpenCV/numpy 에 의존하지 않는다 (frame 은 임의 객체).
→ 카메라 없이도 단위 테스트가 가능하도록 분리했다.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, List, Optional


@dataclass
class FrameItem:
    """링버퍼에 저장되는 한 장의 프레임과 메타데이터."""
    frame: Any          # 이미지 (OpenCV ndarray 등). 이 모듈은 타입을 강제하지 않는다.
    timestamp: float    # 수신 시각 (time.time())
    frame_index: int    # 카메라 시작 이후 단조 증가하는 프레임 번호


class RingBuffer:
    """최근 buffer_seconds 초 분량의 프레임을 담는 스레드 세이프 링버퍼."""

    def __init__(self, buffer_seconds: float = 3.0, max_fps: int = 30) -> None:
        self.buffer_seconds = buffer_seconds
        # 최악(최대 fps) 기준으로 용량을 잡아 메모리를 한정한다.
        maxlen = max(1, int(round(buffer_seconds * max_fps)))
        self._dq: "deque[FrameItem]" = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    @property
    def capacity(self) -> int:
        return self._dq.maxlen or 0

    def append(self, item: FrameItem) -> None:
        with self._lock:
            self._dq.append(item)

    def latest(self) -> Optional[FrameItem]:
        """가장 최근 프레임 1장 (없으면 None)."""
        with self._lock:
            return self._dq[-1] if self._dq else None

    def get_recent_frames(self, seconds: float = 3.0, now: Optional[float] = None) -> List[FrameItem]:
        """
        최근 `seconds` 초 이내의 프레임 리스트를 오래된→최신 순으로 반환한다.
        now 를 주입하면(테스트용) 결정적으로 동작한다.
        """
        if now is None:
            now = time.time()
        cutoff = now - seconds
        with self._lock:
            # deque 스냅샷을 떠서 호출자가 순회하는 동안 capture 스레드와 충돌하지 않게 한다.
            return [it for it in self._dq if it.timestamp >= cutoff]

    def clear(self) -> None:
        with self._lock:
            self._dq.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._dq)
```

## camera_core.py
```python
"""
Camera Core v0.1
================

Solomon AI Camera Service 의 기반이 되는 RTSP 수신 코어.

이 단계 범위 (v0.1):
  - RTSP 수신만 안정화한다.
  - Capture 스레드 / Monitor(Health) 스레드 / 링버퍼 / 재연결 까지.

이 단계에서 하지 않는 것 (절대 추가 금지):
  - MediaPipe / YOLO / Rule Engine / Supabase(DB) / 웹 연동

설계:
  - CameraCore 1개 = 카메라 1대. 8대 확장 시 CameraCore 를 8개 인스턴스화하면 된다.
  - Capture 스레드: RTSP 연결, 프레임 read, 링버퍼 적재, 재연결(지수 백오프).
  - Monitor 스레드: 1초마다 상태(FPS/해상도/마지막 프레임 시각/연결상태) 로깅,
    프레임 수신 중단·FPS 저하 감지.
  - Display/Consumer 로직은 이 클래스에 두지 않는다(main.py 가 담당) → 캡처와 소비 분리.
"""

from __future__ import annotations

import os
import threading
import time
import logging
from typing import List, Optional

# ---------------------------------------------------------------------------
# FFmpeg backend 옵션은 cv2 import "전"에 환경변수로 설정해야 적용된다.
#   - rtsp_transport;tcp : 장시간(10분+) 안정성을 위해 RTSP 를 TCP 로 수신.
#   - stimeout(마이크로초) : read 가 막혔을 때 무한 대기하지 않고 타임아웃 → 재연결.
# ---------------------------------------------------------------------------
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000",
)

import cv2  # noqa: E402  (환경변수 설정 후 import 해야 한다)

from ring_buffer import FrameItem, RingBuffer  # noqa: E402

log = logging.getLogger("camera_core")


def sanitize_url(url: str) -> str:
    """로그용으로 RTSP URL 의 비밀번호를 가린다. rtsp://user:pass@host -> rtsp://user:****@host"""
    if not url or "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user = creds.split(":", 1)[0]
        creds = f"{user}:****"
    return f"{scheme}://{creds}@{host}"


class CameraCore:
    """카메라 1대의 RTSP 수신 코어 (캡처 스레드 + 모니터 스레드 + 링버퍼)."""

    def __init__(
        self,
        rtsp_url: str,
        name: str = "cam0",
        buffer_seconds: float = 3.0,
        max_fps: int = 30,
        target_fps: float = 10.0,
        stall_timeout: float = 5.0,
        status_interval: float = 1.0,
        reconnect_start: float = 2.0,
        reconnect_max: float = 30.0,
        max_read_failures: int = 30,
    ) -> None:
        self.rtsp_url = rtsp_url
        self.name = name
        self.target_fps = target_fps
        self.stall_timeout = stall_timeout
        self.status_interval = status_interval
        self.reconnect_start = reconnect_start
        self.reconnect_max = reconnect_max
        self.max_read_failures = max_read_failures

        self.buffer = RingBuffer(buffer_seconds=buffer_seconds, max_fps=max_fps)

        self._stop = threading.Event()
        self._capture_thread: Optional[threading.Thread] = None
        self._monitor_thread: Optional[threading.Thread] = None

        # --- 상태(여러 스레드가 읽고 쓰므로 lock 으로 보호) ---
        self._state_lock = threading.Lock()
        self._opened = False
        self._last_frame_time = 0.0
        self._fps = 0.0
        self._frame_index = 0
        self._reconnects = 0
        self._width = 0
        self._height = 0

    # ------------------------------------------------------------------ API
    def start(self) -> None:
        log.info("[%s] CameraCore 시작 - 대상 %s", self.name, sanitize_url(self.rtsp_url))
        self._capture_thread = threading.Thread(
            target=self._capture_loop, name=f"{self.name}-capture", daemon=True
        )
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop, name=f"{self.name}-monitor", daemon=True
        )
        self._capture_thread.start()
        self._monitor_thread.start()

    def stop(self) -> None:
        log.info("[%s] CameraCore 정지 요청", self.name)
        self._stop.set()
        for t in (self._capture_thread, self._monitor_thread):
            if t is not None:
                t.join(timeout=5.0)
        log.info("[%s] CameraCore 정지 완료", self.name)

    def get_latest_frame(self) -> Optional[FrameItem]:
        """가장 최근 프레임 1장 (Display/Consumer 용)."""
        return self.buffer.latest()

    def get_recent_frames(self, seconds: float = 3.0) -> List[FrameItem]:
        """
        최근 `seconds` 초 프레임 리스트 반환.
        향후 AI Engine 이 2~3초 Burst Analysis 를 위해 호출한다.
        """
        return self.buffer.get_recent_frames(seconds=seconds)

    @property
    def is_connected(self) -> bool:
        with self._state_lock:
            return self._opened

    def health(self) -> dict:
        """현재 상태 스냅샷."""
        with self._state_lock:
            last = self._last_frame_time
            return {
                "name": self.name,
                "connected": self._opened,
                "fps": round(self._fps, 1),
                "resolution": f"{self._width}x{self._height}",
                "frames_received": self._frame_index,
                "last_frame_age": (time.time() - last) if last > 0 else None,
                "reconnects": self._reconnects,
                "buffer_len": len(self.buffer),
            }

    # ------------------------------------------------------- capture thread
    def _open_capture(self) -> "cv2.VideoCapture":
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)  # FFmpeg backend 명시
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # 지연 누적 최소화 (backend 가 무시할 수도)
        except Exception:
            pass
        return cap

    def _log_open_failure(self) -> None:
        log.error("[%s] RTSP open 실패: %s", self.name, sanitize_url(self.rtsp_url))
        log.error("[%s] 원인 후보: (1)카메라 전원/네트워크 (2)포트554/방화벽 "
                  "(3)아이디·비밀번호 (4)스트림경로 /stream1·/stream2 "
                  "(5)RTSP/ONVIF 활성화 (6)FFmpeg backend 포함 여부", self.name)

    def _set_opened(self, value: bool) -> None:
        with self._state_lock:
            self._opened = value
            if not value:
                self._fps = 0.0

    def _capture_loop(self) -> None:
        delay = self.reconnect_start
        while not self._stop.is_set():
            cap = None
            try:
                log.info("[%s] RTSP 연결 시도...", self.name)
                cap = self._open_capture()
                if not cap.isOpened():
                    self._log_open_failure()
                    self._set_opened(False)
                    self._reconnects += 1
                    if self._stop.wait(delay):
                        break
                    delay = min(delay * 2, self.reconnect_max)
                    continue

                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                with self._state_lock:
                    self._width, self._height = w, h
                    self._opened = True
                    self._fps = 0.0
                log.info("[%s] RTSP 연결 성공 - 해상도 %dx%d", self.name, w, h)
                delay = self.reconnect_start  # 성공 시 백오프 초기화

                self._read_frames(cap)  # 끊김 또는 stop 까지 블로킹
            except Exception as exc:  # 어떤 예외에도 스레드가 죽지 않게 한다
                log.exception("[%s] 캡처 루프 예외: %s", self.name, exc)
            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                self._set_opened(False)

            if self._stop.is_set():
                break
            self._reconnects += 1
            log.warning("[%s] 재연결 대기 %.0fs (누적 재연결 %d회)", self.name, delay, self._reconnects)
            if self._stop.wait(delay):
                break
            delay = min(delay * 2, self.reconnect_max)

        log.info("[%s] 캡처 스레드 종료", self.name)

    def _read_frames(self, cap: "cv2.VideoCapture") -> None:
        """연결된 capture 에서 프레임을 계속 읽어 링버퍼에 적재한다. 끊기면 반환."""
        failures = 0
        win_start = time.time()
        win_count = 0

        while not self._stop.is_set():
            try:
                ok, frame = cap.read()
            except Exception as exc:
                log.exception("[%s] read 예외: %s", self.name, exc)
                return

            if not ok or frame is None:
                failures += 1
                if failures >= self.max_read_failures:
                    log.error("[%s] 프레임 연속 수신 실패 %d회 - 연결 끊김 판단, 재연결",
                              self.name, failures)
                    return
                if self._stop.wait(0.03):  # 잠깐 쉬되 stop 이면 즉시 탈출
                    return
                continue

            failures = 0
            ts = time.time()
            with self._state_lock:
                self._frame_index += 1
                idx = self._frame_index
                self._last_frame_time = ts
            self.buffer.append(FrameItem(frame=frame, timestamp=ts, frame_index=idx))

            # 1초 단위 FPS 계산
            win_count += 1
            now = time.time()
            if now - win_start >= 1.0:
                fps = win_count / (now - win_start)
                with self._state_lock:
                    self._fps = fps
                win_count = 0
                win_start = now

    # ------------------------------------------------------- monitor thread
    def _monitor_loop(self) -> None:
        # status_interval 마다 깨어나며, stop 이 set 되면 즉시 종료
        while not self._stop.wait(self.status_interval):
            with self._state_lock:
                opened = self._opened
                fps = self._fps
                last = self._last_frame_time
                frames = self._frame_index
                reconnects = self._reconnects
                res = f"{self._width}x{self._height}"
            age = (time.time() - last) if last > 0 else None
            age_str = f"{age:.1f}s" if age is not None else "N/A"

            log.info(
                "[%s] STATUS connected=%s fps=%.1f res=%s frames=%d last_frame=%s reconnects=%d buf=%d",
                self.name, opened, fps, res, frames, age_str, reconnects, len(self.buffer),
            )

            # 프레임 수신 중단 감지 (연결은 됐다고 보고되나 프레임이 안 들어옴)
            if opened and age is not None and age > self.stall_timeout:
                log.warning("[%s] 프레임 수신 중단 감지 - 마지막 프레임 %.1fs 전 (재연결 대기 중일 수 있음)",
                            self.name, age)
            # FPS 저하 감지 (fps==0 은 연결 직후 아직 측정 전이므로 제외; 실제 멈춤은 위 stall 분기가 잡는다)
            elif opened and age is not None and self.target_fps > 0 and 0 < fps < self.target_fps * 0.5:
                log.warning("[%s] FPS 저하 감지 - 현재 %.1f / 목표 %.1f", self.name, fps, self.target_fps)

        log.info("[%s] 모니터 스레드 종료", self.name)
```

## main.py
```python
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
```

## test_camera_core.py
```python
"""
CameraCore 통합 테스트 (실제 카메라/네트워크 없이).

camera_core.cv2.VideoCapture 를 가짜 캡처로 주입(monkeypatch)해서
캡처 스레드 / 링버퍼 적재 / health / get_recent_frames / 재연결 을 검증한다.
"""
import logging
import time

import numpy as np

import camera_core
from camera_core import CameraCore

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                    datefmt="%H:%M:%S")


class FakeCapture:
    """cv2.VideoCapture 흉내. fail_reads 동안은 read 실패 → 재연결 유도."""
    def __init__(self, url, backend=None):
        self.url = url
        self._opened = True
        self.w, self.h = 848, 480

    def isOpened(self):
        return self._opened

    def set(self, *a, **k):
        return True

    def get(self, prop):
        if prop == camera_core.cv2.CAP_PROP_FRAME_WIDTH:
            return float(self.w)
        if prop == camera_core.cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self.h)
        return 0.0

    def read(self):
        # 약 30fps 로 합성 프레임 생성
        time.sleep(1 / 30)
        if FAIL_READS[0] > 0:
            FAIL_READS[0] -= 1
            return False, None
        frame = np.zeros((self.h, self.w, 3), dtype=np.uint8)
        return True, frame

    def release(self):
        self._opened = False


# 전역 플래그: read 가 몇 번 실패할지 (재연결 시뮬레이션용)
FAIL_READS = [0]
OPEN_COUNT = [0]


def fake_videocapture(url, backend=None):
    OPEN_COUNT[0] += 1
    return FakeCapture(url, backend)


def main():
    camera_core.cv2.VideoCapture = fake_videocapture  # 주입

    core = CameraCore(
        rtsp_url="rtsp://admin:secret@192.168.219.50:554/stream2",
        name="testcam",
        buffer_seconds=3.0,
        max_fps=30,
        target_fps=10.0,
        max_read_failures=5,      # 테스트를 빠르게: 5회 실패면 재연결
        reconnect_start=0.5,
        status_interval=1.0,
    )
    core.start()

    # 1) 정상 수신 확인
    time.sleep(2.5)
    h = core.health()
    print("HEALTH-1:", h)
    assert h["connected"] is True, "연결 상태여야 함"
    assert h["frames_received"] > 0, "프레임이 들어와야 함"
    assert h["fps"] > 0, "FPS > 0"
    assert h["resolution"] == "848x480", h["resolution"]

    recent = core.get_recent_frames(seconds=3)
    print(f"get_recent_frames(3) -> {len(recent)}장, idx {recent[0].frame_index}~{recent[-1].frame_index}")
    assert len(recent) > 0, "최근 프레임 반환되어야 함"
    span = recent[-1].timestamp - recent[0].timestamp
    assert span <= 3.0 + 0.1, f"3초 윈도우 초과: {span}"
    assert all(r.frame.shape == (480, 848, 3) for r in recent), "프레임 형상"

    # 2) 재연결 검증: read 를 연속 실패시켜 끊김 유발
    opens_before = OPEN_COUNT[0]
    rec_before = core.health()["reconnects"]
    print(f"--- 끊김 유발 (opens={opens_before}, reconnects={rec_before}) ---")
    FAIL_READS[0] = 100  # 충분히 많이 실패 → max_read_failures(5) 초과로 재연결
    time.sleep(2.0)
    FAIL_READS[0] = 0    # 복구
    time.sleep(2.0)

    h2 = core.health()
    print("HEALTH-2:", h2)
    assert OPEN_COUNT[0] > opens_before, "재연결로 VideoCapture 가 다시 열려야 함"
    assert h2["reconnects"] > rec_before, "reconnects 카운트 증가해야 함"
    assert h2["connected"] is True, "복구 후 다시 연결 상태"
    assert h2["frames_received"] > h["frames_received"], "복구 후 프레임 계속 증가"

    # 3) 정상 종료
    core.stop()
    assert not core._capture_thread.is_alive(), "캡처 스레드 종료"
    assert not core._monitor_thread.is_alive(), "모니터 스레드 종료"

    print("\nPASS: 수신/health/get_recent_frames/재연결/정상종료 모두 정상")


if __name__ == "__main__":
    main()
```

> `rtsp_poc.py`(레거시 단일파일 PoC)는 저장소 파일을 참고. v0.1에서는 `main.py` 사용 권장.

---

# 3. 클래스 구조 설명

### FrameItem (ring_buffer.py, @dataclass)
- 역할: 링버퍼 저장 단위(프레임 1장 + 메타데이터).
- 책임: 이미지 + 메타데이터를 묶어 운반.
- 필드: `frame`(ndarray), `timestamp`(time.time()), `frame_index`(단조 증가).
- 메서드: 없음(순수 데이터).

### RingBuffer (ring_buffer.py)
- 역할: 최근 N초 프레임 보관 스레드 세이프 링버퍼.
- 책임: 용량 한정 저장(자동 폐기), 타임스탬프 기반 조회, 동시성 보호. OpenCV 비의존(테스트 용이).
- public: `append`, `latest`, `get_recent_frames(seconds, now=None)`, `clear`, `capacity`, `__len__`.
- private: `_dq`(deque), `_lock`(Lock).

### CameraCore (camera_core.py)
- 역할: 카메라 1대 RTSP 수신 코어(캡처/모니터 스레드 + 링버퍼).
- 책임: 연결·재연결, 프레임 수신·적재, 헬스 노출, 안전 시작/종료. 소비(Display/AI)는 비책임(분리).
- public: `start`, `stop`, `get_latest_frame`, `get_recent_frames(seconds=3)`, `is_connected`, `health`.
- private: `_capture_loop`, `_read_frames`, `_monitor_loop`, `_open_capture`, `_log_open_failure`, `_set_opened` + 상태 필드(`_state_lock`, `_opened`, `_last_frame_time`, `_fps`, `_frame_index`, `_reconnects`, `_width/_height`, `_stop`).

### main.py (모듈)
- 역할: 엔트리포인트 / Display·Consumer 계층.
- 책임: .env 로드, 인자 파싱, 수명주기 관리, 일반/headless 분기, q·Ctrl+C·--duration 종료, burst 데모.

---

# 4. 실행 흐름 (Flow Diagram)

```
python main.py [--headless]
        │
        ▼
  load_dotenv() → RTSP_URL 읽기 ──(없으면)→ ERROR 로그 → exit 1
        │
        ▼
  CameraCore(...) 생성
        │
        ▼
  core.start() ───────────────┬─────────────────────────┐
        │                     │                          │
        ▼              [Capture Thread]          [Monitor Thread]
  (메인 스레드)               │                          │
  Display/Consumer 루프       ▼                          ▼
        │             _capture_loop()           _monitor_loop()
        │             ├ _open_capture()(FFmpeg)  └ 1초마다 STATUS 로그
        │             ├ isOpened? ──no→ 백오프 재연결   stall/FPS저하 감지
        │             └ _read_frames()
        │                  └ cap.read() → FrameItem
        │                        │
        │                        ▼
        │                   ┌───────────┐
        ├──get_latest_frame─┤ RingBuffer │←append (deque, maxlen)
        ├─get_recent_frames─┤  (3초분)   │
        │                   └───────────┘
        ▼
  [일반] imshow + FPS 오버레이 + waitKey('q')
  [headless] sleep, 모니터가 로그
  [--duration] 시간 도달
        │  (q / Ctrl+C / duration)
        ▼
  finally: core.stop() → _stop.set() → 두 스레드 join
        │
        ▼
  cv2.destroyAllWindows() (일반 모드) → exit
```

---

# 5. Thread 구조

총 3개 스레드(메인 1 + CameraCore 2).

| Thread | 역할 | 비고 |
|--------|------|------|
| Main Thread | Display/Consumer. 일반=imshow+waitKey, headless=대기. get_latest/get_recent 소비. 종료 트리거(q/Ctrl+C/duration). | OpenCV GUI는 메인에서만 안전 |
| {name}-capture (daemon) | RTSP 연결·재연결, cap.read() → RingBuffer.append → 상태 갱신(frame_index/last_frame_time/fps) | 블로킹 I/O |
| {name}-monitor (daemon) | 1초마다 STATUS 로깅, 수신중단·FPS저하 감지 | 수신 경로와 독립 |

동기화
- `threading.Event _stop`: 종료 신호 + 중단 가능한 sleep(`_stop.wait(t)`).
- `threading.Lock _state_lock`: 공유 스칼라 상태 보호.
- `RingBuffer._lock`: deque 적재/스냅샷 보호.

종료 방식
- `stop()` → `_stop.set()` → 루프 탈출 → `join(timeout=5)`.
- 두 스레드 daemon=True(안전망), cap.read() 블로킹은 FFmpeg stimeout(5s)로 상한.

---

# 6. Ring Buffer 설명

- deque 크기: `maxlen = round(buffer_seconds × max_fps)` 기본 3×30=90. 오래된 프레임 자동 폐기 → 메모리 상한 고정(848×480×3 ≈ 1.2MB × 90 ≈ 약 110MB/대).
- 저장 데이터: `FrameItem(frame, timestamp, frame_index)`.
- timestamp 저장: read 직후 `ts=time.time()`(epoch float) 기록. get_recent_frames가 `now-seconds` cutoff로 필터(오래된→최신 정렬).
- frame index 증가: `_frame_index`를 `_state_lock` 아래 `+=1` 단조 증가. 카메라 시작 이후 전역 누적, 재연결되어도 리셋 안 됨.

---

# 7. Health Check

모니터 스레드가 status_interval(1초)마다 수행.
- 마지막 프레임 시간: 매 프레임 `_last_frame_time` 갱신, health에서 `last_frame_age=now-last`(없으면 None).
- FPS 계산: 캡처 스레드 1초 슬라이딩 윈도우(win_count/경과초). 끊김 시 0으로 초기화.
- 재연결 조건/감지:
  - read 연속 실패 ≥ max_read_failures(30) → 끊김 판단 → 재연결.
  - connected인데 last_frame_age > stall_timeout(5s) → "수신 중단" 경고.
  - connected, 0 < fps < target_fps×0.5 → "FPS 저하" 경고.
- 현 한계: 모니터의 stall 감지는 경고만, 실제 재연결은 캡처 스레드 read-실패 경로가 담당.

---

# 8. 재연결 로직 (순서도)

```
        ┌──────────────────────────────┐
        │  _capture_loop 진입            │
        │  delay = reconnect_start(2s)  │
        └──────────────┬───────────────┘
                       ▼
              _open_capture() (FFmpeg/TCP)
                       │
            ┌──────────┴───────────┐
       isOpened()=False        isOpened()=True
            │                       │
   _log_open_failure()      해상도 읽기, _opened=True
   reconnects += 1          delay = reconnect_start(초기화)
            │                       │
   _stop.wait(delay) ──set?──→break  _read_frames(cap)  ← 프레임 수신 루프
            │ (timeout)                    │
   delay = min(delay×2, 30s)        read 연속 실패 ≥ max_read_failures(30)
            │                              │  또는 read 예외 / stop
            └──────────┐                   ▼
                       │           cap.release(), _opened=False
                       │           reconnects += 1
                       │           "재연결 대기 delay초" 로그
                       │           _stop.wait(delay) ──set?──→ break
                       │                  │ (timeout)
                       │           delay = min(delay×2, 30s)
                       └──────────────────┘  ← 루프 반복
```
- 대기: 2s → ×2 (2→4→8→16→30s 상한). 성공 시 2s로 초기화. 모든 대기는 _stop.wait로 중단 가능.

---

# 9. 현재 남아있는 기술 부채 (운영 기준, 13개)

1. stall 감지와 재연결 분리 — 모니터가 수신중단을 알아도 직접 재연결 못함. stale read 반환 카메라는 끊김 영원히 못 잡을 수 있음 → watchdog 강제 reconnect 필요.
2. `stimeout` 호환성 — 최신 FFmpeg에서 deprecated(`timeout` 대체), 빌드 따라 무시 → read 블로킹 상한 미보장.
3. 테스트 커버리지 부족 — 실제 RTSP 단절·지연·코덱 깨짐 테스트 없음, pytest 구조 아님.
4. 8대 확장 미검증 / GIL 병목 — deque 8×110MB≈880MB, 8개 블로킹 read GIL 경합. 멀티프로세스/HW디코딩 전략 부재.
5. 메모리 상한이 fps 가정 의존 — 실제 fps가 max_fps 초과/미달 시 3초 미보장/과할당. 동적 사이징 없음.
6. 관측성 부재 — 메트릭이 로그 텍스트뿐. Prometheus/health HTTP/구조화 로그 없음.
7. 설정 관리 빈약 — 임계값이 코드 기본값, 카메라별 설정/검증 없음.
8. wall-clock 타임스탬프 — NTP/시간 역행 취약, PTS 미사용, monotonic 미사용 → Burst 프레임 간격 정확도 한계.
9. zero-copy 아님 / 백프레셔 없음 — 매 프레임 객체 생성+copy, 소비자 지연 시 사일런트 드롭.
10. 자가 복구 한계 — 인증 실패(401)·잘못된 URL 같은 영구 오류도 무한 재연결. 오류 분류/서킷브레이커/알림 없음.
11. 헬스가 수신만 보고 품질 못 봄 — 검은 화면/프리징/디코드 에러도 정상 카운트. 프레임 유효성 검사 없음.
12. 로깅 전역 오염 — basicConfig 루트 로거, 회전/파일 핸들러 없음. 장시간/멀티카메라 로그 폭증·혼재.
13. 타입/품질 게이트 부재 — mypy/ruff/CI 없음, monkeypatch 의존 테스트라 회귀 탐지 약함.

---

# 10. 개선 계획 — Camera Core v0.2 (우선순위)

P0 (안정성·정확성, 운영 진입 전 필수)
1. Watchdog 기반 강제 재연결(부채 1,11) — last_frame_age > stall_timeout이면 capture 강제 release/재연결.
2. 오류 분류 + 서킷브레이커(부채 10) — 일시적/영구 구분, 영구는 백오프↑+알림.
3. 모노토닉 시계 + 스트림 PTS 분리(부채 8) — recv_monotonic/wall_ts 둘 다 저장.
4. FFmpeg 옵션 견고화(부채 2) — stimeout/timeout 동시 지정, 첫 프레임 타임아웃 가드.

P1 (관측성·운영성)
5. Health HTTP + Prometheus 메트릭(부채 6) — /healthz, /metrics, JSON 로그 + 로그 회전.
6. 설정 외부화 + 검증(부채 7) — 카메라별 YAML/.env 다중 + Pydantic.
7. 품질 게이트/테스트 정비(부채 3,13) — pytest 전환, ruff+mypy+pre-commit, CI, 단절 시나리오 테스트.

P2 (확장성, 8대 본격 대비)
8. 멀티프로세스 + HW 디코딩(부채 4) — 카메라당 프로세스/asyncio/GStreamer, VAAPI/NVDEC.
9. 백프레셔·드롭 정책 + 메모리 모니터링(부채 5,9) — 드롭 카운터, 동적 버퍼, 총 메모리 상한/알림.
10. 프레임 품질 검사(부채 11) — 검은화면/동일프레임/디코드 오류 감지 → quality 지표.

P3 (다음 단계 연동 준비 — v0.2 범위 경계)
11. AI Engine이 get_recent_frames(3)를 구독하는 Consumer 인터페이스(콜백/큐) 표준화.
    단, 실제 MediaPipe/YOLO/DB/웹은 여전히 미구현 — v0.2도 "수신 코어 + 운영성"까지만.
```
