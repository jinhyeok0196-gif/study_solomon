"""
OrchestratorEngine v0.1
=======================

Scheduler ↔ CameraManager ↔ (향후 AI Engine) 을 잇는 중앙 제어 엔진.

흐름:
  SchedulerEngine.get_due_triggers(now)
    → Trigger Queue (enqueue)
    → Worker Thread (dequeue)
    → target_seats 해석(["all"] → 현재 카메라)
    → CameraManager.get_recent_frames(seat_id, 3)  (실패 시 Retry → Error Queue)
    → BurstPackage 생성
    → burst_consumer(콜백) 로 전달  ← 기본은 로그/보관 (AI 아님)

이 단계에서 하지 않는 것: MediaPipe / YOLO / AI 분석 / Rule Engine / Supabase / Dashboard.

느슨한 연결:
  - scheduler/camera_manager 는 덕타이핑(메서드 시그니처)만 의존 → Fake 로 대체 가능.
  - burst_consumer 는 콜백 → 향후 AI Engine 으로 교체해도 Orchestrator 코드는 수정하지 않는다.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Callable, List, Optional

from burst_package import BurstPackage, ErrorItem
from trigger_queue import TriggerQueue

log = logging.getLogger("orchestrator")


class _QueueItem:
    """큐에 담기는 trigger dispatch 단위(큐 지연 측정을 위해 enqueue 시각 보관)."""
    __slots__ = ("trigger", "trigger_uuid", "enqueued_perf")

    def __init__(self, trigger: Any, trigger_uuid: str) -> None:
        self.trigger = trigger
        self.trigger_uuid = trigger_uuid
        self.enqueued_perf = time.perf_counter()


class OrchestratorEngine:
    def __init__(
        self,
        scheduler: Any,
        camera_manager: Any,
        *,
        burst_consumer: Optional[Callable[[BurstPackage], None]] = None,
        poll_interval: float = 1.0,
        recent_seconds: float = 3.0,
        max_queue_size: int = 1000,
        max_retries: int = 2,
        retry_delay: float = 0.2,
        now_fn: Optional[Callable[[], datetime]] = None,
        keep_packages: int = 200,
    ) -> None:
        self.scheduler = scheduler
        self.camera_manager = camera_manager
        # 기본 consumer 는 AI 가 아니라 로그+보관 sink. 향후 AI Engine 으로 교체.
        self.burst_consumer = burst_consumer or self._default_consume

        self.poll_interval = poll_interval
        self.recent_seconds = recent_seconds
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._now = now_fn or datetime.now
        self.keep_packages = keep_packages

        self.queue = TriggerQueue(max_size=max_queue_size)
        self.error_queue = TriggerQueue(max_size=max_queue_size)

        self._stop = threading.Event()
        self._poll_thread: Optional[threading.Thread] = None
        self._worker_thread: Optional[threading.Thread] = None

        # 관측용
        self.events: List[dict] = []
        self.packages: List[BurstPackage] = []  # 기본 consumer 가 보관(최근 keep_packages 개)
        self._processed = 0
        self._errors = 0
        self._enqueued = 0
        self._dropped = 0
        self._lock = threading.Lock()

    # ----------------------------------------------------------- lifecycle
    def start(self) -> None:
        log.info("Orchestrator 시작 (poll=%.1fs, recent=%.1fs, retries=%d, max_queue=%d)",
                 self.poll_interval, self.recent_seconds, self.max_retries, self.queue.max_size)
        self._poll_thread = threading.Thread(target=self._poll_loop, name="orch-poll", daemon=True)
        self._worker_thread = threading.Thread(target=self._worker_loop, name="orch-worker", daemon=True)
        self._poll_thread.start()
        self._worker_thread.start()

    def stop(self) -> None:
        log.info("Orchestrator 정지 요청")
        self._stop.set()
        for t in (self._poll_thread, self._worker_thread):
            if t is not None:
                t.join(timeout=5.0)
        log.info("Orchestrator 정지 완료 (processed=%d, errors=%d)", self._processed, self._errors)

    # ------------------------------------------------------ synchronous API
    def process_once(self, now: Optional[datetime] = None) -> List[BurstPackage]:
        """
        스레드 없이 1회 동작: Scheduler 폴링 → 큐 적재 → 큐를 즉시 모두 처리.
        --once / 테스트용. 이번 호출에서 생성된 BurstPackage 들을 반환한다.
        """
        before = len(self.packages)
        self._poll_once(now)
        self._drain()
        return self.packages[before:]

    # ----------------------------------------------------------- internals
    def _poll_loop(self) -> None:
        while not self._stop.wait(self.poll_interval):
            try:
                self._poll_once()
            except Exception as exc:  # 폴링 실패가 스레드를 죽이지 않게
                log.exception("폴링 예외: %s", exc)
        log.info("폴링 스레드 종료")

    def _poll_once(self, now: Optional[datetime] = None) -> None:
        now = now or self._now()
        due = self.scheduler.get_due_triggers(now, record=True)
        for trig in due:
            trigger_uuid = uuid.uuid4().hex
            item = _QueueItem(trig, trigger_uuid)
            if self.queue.enqueue(item):
                with self._lock:
                    self._enqueued += 1
                log.info("ENQUEUE trigger_uuid=%s type=%s period=%s seats=%s",
                         trigger_uuid, trig.trigger_type, trig.period_id, trig.target_seats)
            else:
                with self._lock:
                    self._dropped += 1
                log.warning("QUEUE OVERFLOW - trigger 드롭됨 type=%s (queue=%d/%d)",
                            trig.trigger_type, self.queue.size(), self.queue.max_size)

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            item = self.queue.dequeue(timeout=0.2)
            if item is None:
                continue
            try:
                self._handle_item(item)
            except Exception as exc:
                log.exception("Worker 처리 예외: %s", exc)
        log.info("Worker 스레드 종료")

    def _drain(self) -> None:
        """큐에 남은 항목을 현재 스레드에서 모두 처리(동기)."""
        while True:
            item = self.queue.dequeue(timeout=0)
            if item is None:
                break
            self._handle_item(item)

    def _resolve_seats(self, target_seats: List[str]) -> List[str]:
        """target_seats(["all"] 등)를 현재 동작 중인 좌석 목록으로 확장한다."""
        if any(s == "all" for s in target_seats):
            try:
                health = self.camera_manager.get_all_health()
            except Exception as exc:
                log.exception("get_all_health 실패: %s", exc)
                return []
            return [h["seat_id"] for h in health if h.get("running")]
        return list(target_seats)

    def _handle_item(self, item: _QueueItem) -> None:
        trig = item.trigger
        dequeue_perf = time.perf_counter()
        queue_delay_ms = (dequeue_perf - item.enqueued_perf) * 1000.0

        seats = self._resolve_seats(trig.target_seats)
        if not seats:
            log.warning("대상 좌석 없음 - trigger_uuid=%s type=%s (running 카메라 없음)",
                        item.trigger_uuid, trig.trigger_type)
            return

        for seat in seats:
            self._build_package_for_seat(item, trig, seat, queue_delay_ms)

    def _build_package_for_seat(self, item: _QueueItem, trig: Any, seat: str,
                                queue_delay_ms: float) -> None:
        attempts = 0
        last_reason = ""
        for attempt in range(1, self.max_retries + 2):  # 최초 1회 + retry max_retries 회
            attempts = attempt
            t0 = time.perf_counter()
            try:
                frames = self.camera_manager.get_recent_frames(seat, seconds=self.recent_seconds)
            except Exception as exc:
                last_reason = f"예외: {exc}"
                log.warning("[%s] get_recent_frames 예외(시도 %d): %s", seat, attempt, exc)
                frames = None

            processing_ms = (time.perf_counter() - t0) * 1000.0

            if frames:
                pkg = BurstPackage(
                    burst_uuid=uuid.uuid4().hex,
                    trigger_uuid=item.trigger_uuid,
                    trigger_id=trig.trigger_id,
                    trigger_type=trig.trigger_type,
                    period_id=trig.period_id,
                    period_name=trig.period_name,
                    seat_id=seat,
                    captured_at=self._now(),
                    frame_count=len(frames),
                    frames=frames,
                    metadata={
                        "queue_delay_ms": round(queue_delay_ms, 1),
                        "processing_ms": round(processing_ms, 1),
                        "attempts": attempts,
                        "recent_seconds": self.recent_seconds,
                    },
                )
                self._emit_package(pkg)
                return
            else:
                if not last_reason:
                    last_reason = "프레임 없음(빈 결과)"
                if attempt <= self.max_retries:
                    if self._stop.wait(self.retry_delay):
                        break

        # 모든 시도 실패 → Error Queue
        err = ErrorItem(
            trigger_uuid=item.trigger_uuid,
            trigger_id=trig.trigger_id,
            seat_id=seat,
            reason=last_reason,
            attempts=attempts,
            created_at=self._now(),
        )
        self.error_queue.enqueue(err)
        with self._lock:
            self._errors += 1
        log.error("BURST 실패 [%s] trigger_uuid=%s attempts=%d reason=%s",
                  seat, item.trigger_uuid, attempts, last_reason)

    def _emit_package(self, pkg: BurstPackage) -> None:
        with self._lock:
            self._processed += 1
        event = {
            "trigger_uuid": pkg.trigger_uuid,
            "trigger_id": pkg.trigger_id,
            "trigger_type": pkg.trigger_type,
            "seat_id": pkg.seat_id,
            "frame_count": pkg.frame_count,
            "captured_at": pkg.captured_at.isoformat(timespec="seconds"),
            "queue_delay_ms": pkg.metadata["queue_delay_ms"],
            "processing_ms": pkg.metadata["processing_ms"],
            "attempts": pkg.metadata["attempts"],
        }
        self.events.append(event)
        log.info("BURST ok seat=%s type=%s frames=%d queue_delay=%.1fms proc=%.1fms attempts=%d "
                 "burst_uuid=%s",
                 pkg.seat_id, pkg.trigger_type, pkg.frame_count,
                 pkg.metadata["queue_delay_ms"], pkg.metadata["processing_ms"],
                 pkg.metadata["attempts"], pkg.burst_uuid)
        # consumer 로 전달(향후 AI Engine 교체 지점)
        try:
            self.burst_consumer(pkg)
        except Exception as exc:
            log.exception("burst_consumer 예외: %s", exc)

    def _default_consume(self, pkg: BurstPackage) -> None:
        """기본 sink: 메모리에 최근 N개 보관(AI 아님)."""
        self.packages.append(pkg)
        if len(self.packages) > self.keep_packages:
            del self.packages[0:len(self.packages) - self.keep_packages]

    # --------------------------------------------------------------- stats
    def stats(self) -> dict:
        with self._lock:
            return {
                "enqueued": self._enqueued,
                "processed": self._processed,
                "errors": self._errors,
                "dropped": self._dropped,
                "queue_size": self.queue.size(),
                "error_queue_size": self.error_queue.size(),
                "events": len(self.events),
            }
