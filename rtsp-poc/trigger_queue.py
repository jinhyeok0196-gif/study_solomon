"""
TriggerQueue
============

Orchestrator 내부 메모리 큐(스레드 세이프). Trigger 와 Error 모두에 재사용한다.

- 최대 길이(max_size) configurable → Overflow 방지(가득 차면 enqueue 가 False 반환).
- enqueue / dequeue / peek / clear / size 제공.
- dequeue 는 Condition 으로 대기(timeout) 가능.

OpenCV / AI 비의존(임의 객체를 담는 범용 큐).
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Any, Optional


class TriggerQueue:
    def __init__(self, max_size: int = 1000) -> None:
        self.max_size = max_size
        self._dq: "deque[Any]" = deque()
        self._lock = threading.Lock()
        self._not_empty = threading.Condition(self._lock)
        self._dropped = 0  # Overflow 로 버려진 개수(관측용)

    def enqueue(self, item: Any) -> bool:
        """가득 차 있으면 넣지 않고 False 반환(Overflow 방지)."""
        with self._lock:
            if len(self._dq) >= self.max_size:
                self._dropped += 1
                return False
            self._dq.append(item)
            self._not_empty.notify()
            return True

    def dequeue(self, timeout: Optional[float] = None) -> Optional[Any]:
        """항목을 꺼낸다. 비어 있으면 timeout 만큼 대기 후 None 반환."""
        with self._not_empty:
            if not self._dq:
                self._not_empty.wait(timeout)
            if self._dq:
                return self._dq.popleft()
            return None

    def peek(self) -> Optional[Any]:
        with self._lock:
            return self._dq[0] if self._dq else None

    def clear(self) -> None:
        with self._lock:
            self._dq.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._dq)

    @property
    def dropped(self) -> int:
        with self._lock:
            return self._dropped

    def __len__(self) -> int:
        return self.size()
