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
