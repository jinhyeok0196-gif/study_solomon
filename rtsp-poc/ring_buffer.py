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
