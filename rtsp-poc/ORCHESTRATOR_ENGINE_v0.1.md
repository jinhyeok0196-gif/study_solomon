# Orchestrator Engine v0.1 — 구현 완료 리뷰 (복붙용)

> 클립보드 복붙용. 전체 선택(Ctrl/Cmd+A) → 복사.
> 범위: 트리거 수신 → 큐 → 워커 → CameraManager에서 프레임 → **BurstPackage 생성**까지.
> **미구현(절대 추가 안 함): AI/MediaPipe/YOLO/Rule Engine/Supabase/Dashboard.**

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── ring_buffer.py            # [Core] 변경 없음
├── camera_core.py            # [Core] 변경 없음
├── main.py                   # [Core] 변경 없음
├── camera_config.py          # [Manager] 변경 없음
├── camera_manager.py         # [Manager] 변경 없음
├── manage.py                 # [Manager] 변경 없음
├── cameras.yaml              # [Manager] 변경 없음
├── schedule_config.py        # [Scheduler] 변경 없음
├── scheduler_engine.py       # [Scheduler] 변경 없음
├── scheduler_demo.py         # [Scheduler] 변경 없음
├── schedule.yaml             # [Scheduler] 변경 없음
├── burst_package.py          # [NEW] BurstPackage / ErrorItem
├── trigger_queue.py          # [NEW] TriggerQueue (스레드세이프, overflow 방지)
├── orchestrator_engine.py    # [NEW] OrchestratorEngine (중앙 제어)
├── orchestrator_demo.py      # [NEW] CLI 데모(--run/--once/--fake/--duration/--headless)
├── test_orchestrator_engine.py # [NEW] 테스트(Fake Scheduler/CameraManager)
├── test_camera_core.py / test_camera_manager.py / test_scheduler_engine.py  # 변경 없음
├── requirements.txt          # 변경 없음
├── .env.example              # 변경 없음
├── README.md                 # [수정] Orchestrator 섹션 추가
├── CODE_REVIEW_v0.1.md / CAMERA_MANAGER_v0.1.md / SCHEDULER_ENGINE_v0.1.md
├── ORCHESTRATOR_ENGINE_v0.1.md  # (이 문서)
└── rtsp_poc.py               # [레거시]
```

기존 CameraCore / CameraManager / SchedulerEngine 파일은 **한 줄도 수정하지 않았다**(느슨한 연결).

---

## 2. 신규 파일 전체 코드

### burst_package.py
```python
"""
BurstPackage
============

Orchestrator 가 TriggerEvent + CameraManager 의 최근 프레임을 묶어 만드는 결과물.
향후 AI Engine 이 이 BurstPackage 를 입력으로 받아 분석한다(이번 단계는 생성까지만).

이 모듈은 OpenCV / AI 에 의존하지 않는다(frames 는 불투명한 리스트).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class BurstPackage:
    burst_uuid: str               # 이 묶음의 고유 id
    trigger_uuid: str             # 트리거 1건의 dispatch 고유 id
    trigger_id: str               # SchedulerEngine 의 결정적 trigger_id (dedup 키)
    trigger_type: str             # start_attendance_check / mid_study_check / ...
    period_id: str
    period_name: str
    seat_id: str                  # 이 묶음이 대상으로 하는 좌석
    captured_at: datetime         # 프레임을 가져온 시각
    frame_count: int
    frames: List[Any]             # CameraManager.get_recent_frames 결과(FrameItem 리스트)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ErrorItem:
    """Burst 를 끝내 못 가져왔을 때 Error Queue 에 들어가는 항목."""
    trigger_uuid: str
    trigger_id: str
    seat_id: str
    reason: str
    attempts: int
    created_at: Optional[datetime] = None
```

### trigger_queue.py
```python
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
```

### orchestrator_engine.py
```python
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
```

### orchestrator_demo.py
```python
"""
OrchestratorEngine v0.1 - CLI 데모
==================================

Scheduler ↔ CameraManager 를 연결해 BurstPackage 가 생성되는 흐름을 확인한다.
AI 는 호출하지 않는다.

실행 예시:
  # 하드웨어 없이 흐름 확인(가짜 Scheduler/CameraManager 로 즉시 BurstPackage 생성)
  python orchestrator_demo.py --once --fake

  # 실제 모듈 연결: cameras.yaml 의 카메라 + schedule.yaml 의 교시
  python orchestrator_demo.py --run --duration 600 --headless
  python orchestrator_demo.py --once --now 09:05
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, date as date_cls

from schedule_config import parse_hhmm, TriggerEvent
from scheduler_engine import SchedulerEngine
from orchestrator_engine import OrchestratorEngine

log = logging.getLogger("orchestrator_demo")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SCHEDULE = os.path.join(HERE, "schedule.yaml")
DEFAULT_CAMERAS = os.path.join(HERE, "cameras.yaml")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon OrchestratorEngine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--run", action="store_true", help="스레드 모드로 계속 실행")
    mode.add_argument("--once", action="store_true", help="1회 폴링 + 큐 처리 후 종료")
    p.add_argument("--duration", type=float, default=0.0, help="--run 시 N초 후 종료(0=무한)")
    p.add_argument("--headless", action="store_true", help="영상 창 없이 실행(오케스트레이터는 본래 창 없음)")
    p.add_argument("--fake", action="store_true", help="가짜 Scheduler/CameraManager 로 흐름만 확인")
    p.add_argument("--now", metavar="HH:MM", help="--once 기준 시각")
    p.add_argument("--poll-interval", type=float, default=1.0, help="폴링 주기(초)")
    p.add_argument("--schedule", default=DEFAULT_SCHEDULE)
    p.add_argument("--config", default=DEFAULT_CAMERAS)
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def resolve_now(now_arg):
    if not now_arg:
        return datetime.now()
    t = parse_hhmm(now_arg)
    d = date_cls.today()
    return datetime(d.year, d.month, d.day, t.hour, t.minute)


# ----------------------------------------------------- fake(--fake) 모드 부품
class _FakeScheduler:
    def __init__(self, triggers):
        self._pending = list(triggers)

    def get_due_triggers(self, now=None, record=True):
        if not record:
            return list(self._pending)
        out, self._pending = self._pending, []
        return out


class _FakeCameraManager:
    def __init__(self, seats):
        self.seats = seats

    def get_all_health(self):
        return [{"seat_id": s, "running": True, "enabled": True} for s in self.seats]

    def get_recent_frames(self, seat_id, seconds=3):
        return [f"{seat_id}-frame{i}" for i in range(5)]


def build_fake():
    now = datetime.now()
    trig = TriggerEvent(
        trigger_id=f"{now.date().isoformat()}_P0_start_attendance_check",
        period_id="P0", period_name="0교시",
        trigger_type="start_attendance_check",
        scheduled_time=now, reason="(fake) 교시 시작 5분 후 착석 확인",
        target_seats=["all"],
    )
    return _FakeScheduler([trig]), _FakeCameraManager(["Seat1", "Seat2", "Seat3"])


def build_real(args):
    # 지연 import: --fake 만 쓸 때 OpenCV 없이도 동작
    from camera_manager import CameraManager
    from camera_config import load_camera_configs
    from dotenv import load_dotenv
    load_dotenv()

    scheduler = SchedulerEngine(schedule_path=args.schedule)
    scheduler.load_schedule()

    cams = load_camera_configs(args.config)
    cm = CameraManager(cams, status_interval=5.0)
    cm.start_all()
    return scheduler, cm


def print_summary(orch: OrchestratorEngine) -> None:
    print("===== Orchestrator stats =====")
    for k, v in orch.stats().items():
        print(f"  {k}: {v}")
    if orch.packages:
        print("----- BurstPackage (최근) -----")
        for p in orch.packages[-8:]:
            print(f"  seat={p.seat_id} type={p.trigger_type} frames={p.frame_count} "
                  f"captured={p.captured_at:%H:%M:%S} meta={p.metadata} burst_uuid={p.burst_uuid[:8]}")
    if orch.error_queue.size():
        print(f"----- Error Queue ({orch.error_queue.size()}) -----")


def main() -> int:
    args = parse_args()
    setup_logging()

    cm = None
    try:
        if args.fake:
            scheduler, cm = build_fake()
        else:
            scheduler, cm = build_real(args)
    except Exception as exc:
        log.error("초기화 실패: %s", exc)
        return 1

    orch = OrchestratorEngine(scheduler, cm, poll_interval=args.poll_interval)

    try:
        if args.once or (not args.run):
            now = resolve_now(args.now)
            log.info("--once 실행 (now=%s)", now.strftime("%H:%M"))
            orch.process_once(now=now)
            print_summary(orch)
        else:
            orch.start()
            start = time.time()
            try:
                while True:
                    if args.duration and (time.time() - start) >= args.duration:
                        log.info("지정 실행 시간(%.0fs) 도달", args.duration)
                        break
                    time.sleep(2.0)
                    log.info("stats: %s", orch.stats())
            except KeyboardInterrupt:
                log.info("KeyboardInterrupt")
            finally:
                orch.stop()
                print_summary(orch)
    finally:
        # 실제 CameraManager 였다면 정리
        if hasattr(cm, "stop_all"):
            cm.stop_all()

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### test_orchestrator_engine.py
```python
"""
OrchestratorEngine 테스트 (카메라/AI 없이, Fake Scheduler/CameraManager).

검증:
  - TriggerQueue 동작(enqueue/dequeue/peek/clear/size/overflow)
  - BurstPackage 생성
  - Worker Thread 동작(start/stop)
  - Retry (실패 후 성공 / 영구 실패 → Error Queue)
  - Queue Overflow
  - Multi Seat (["all"] → 여러 좌석)
  - 정상 종료(스레드 join)
"""
import time
from datetime import datetime

from schedule_config import TriggerEvent
from trigger_queue import TriggerQueue
from orchestrator_engine import OrchestratorEngine


# ----------------------------------------------------------------- fakes
class FakeScheduler:
    """record=True 호출 시 보류 트리거를 1회만 방출(=dedup 흉내)."""
    def __init__(self, triggers=None):
        self._pending = list(triggers or [])

    def add(self, ev):
        self._pending.append(ev)

    def get_due_triggers(self, now=None, record=True):
        if not record:
            return list(self._pending)
        out, self._pending = self._pending, []
        return out


class FakeCameraManager:
    def __init__(self, seats, fail_times=None, frames_per_seat=5):
        self.seats = list(seats)
        self.fail_times = dict(fail_times or {})  # seat -> 남은 실패 횟수
        self.frames_per_seat = frames_per_seat

    def get_all_health(self):
        return [{"seat_id": s, "running": True, "enabled": True} for s in self.seats]

    def get_recent_frames(self, seat_id, seconds=3):
        rem = self.fail_times.get(seat_id, 0)
        if rem > 0:
            self.fail_times[seat_id] = rem - 1
            return []  # 실패(빈 결과)
        return [f"{seat_id}-frame{i}" for i in range(self.frames_per_seat)]


def mk_trigger(ttype="start_attendance_check", target=None):
    return TriggerEvent(
        trigger_id=f"2026-06-30_P0_{ttype}",
        period_id="P0", period_name="0교시",
        trigger_type=ttype,
        scheduled_time=datetime(2026, 6, 30, 9, 5),
        reason="테스트",
        target_seats=target or ["all"],
    )


def test_queue():
    q = TriggerQueue(max_size=3)
    assert q.size() == 0 and q.peek() is None
    assert q.enqueue("a") and q.enqueue("b")
    assert q.size() == 2 and q.peek() == "a"
    assert q.dequeue() == "a" and q.size() == 1
    # overflow
    assert q.enqueue("c") and q.enqueue("d")  # now b,c,d = 3
    assert q.enqueue("e") is False, "가득 차면 False"
    assert q.dropped == 1
    q.clear()
    assert q.size() == 0
    assert q.dequeue(timeout=0) is None
    print("PASS queue: enqueue/dequeue/peek/clear/size/overflow")


def test_burst_and_multiseat():
    sch = FakeScheduler([mk_trigger(target=["all"])])
    cm = FakeCameraManager(["Seat1", "Seat2", "Seat3"])
    orch = OrchestratorEngine(sch, cm, max_retries=2, retry_delay=0)
    pkgs = orch.process_once(now=datetime(2026, 6, 30, 9, 5))
    seats = sorted(p.seat_id for p in pkgs)
    print("multiseat pkgs:", seats)
    assert seats == ["Seat1", "Seat2", "Seat3"], "['all'] → 3좌석"
    p = pkgs[0]
    for fld in ["burst_uuid", "trigger_uuid", "trigger_id", "trigger_type",
                "period_id", "period_name", "seat_id", "captured_at",
                "frame_count", "frames", "metadata"]:
        assert hasattr(p, fld), f"필드 누락 {fld}"
    assert p.frame_count == 5 and len(p.frames) == 5
    assert p.metadata["attempts"] == 1
    assert "queue_delay_ms" in p.metadata and "processing_ms" in p.metadata
    print("PASS burst+multiseat: BurstPackage 생성/필드/멀티좌석")


def test_retry():
    # Seat1: 2회 실패 후 성공(attempts=3), Seat2: 영구 실패 → Error Queue
    sch = FakeScheduler([mk_trigger(target=["Seat1", "Seat2"])])
    cm = FakeCameraManager(["Seat1", "Seat2"], fail_times={"Seat1": 2, "Seat2": 99})
    orch = OrchestratorEngine(sch, cm, max_retries=2, retry_delay=0)
    pkgs = orch.process_once(now=datetime(2026, 6, 30, 9, 5))
    by_seat = {p.seat_id: p for p in pkgs}
    assert "Seat1" in by_seat, "Seat1 은 retry 후 성공해야 함"
    assert by_seat["Seat1"].metadata["attempts"] == 3, by_seat["Seat1"].metadata["attempts"]
    assert "Seat2" not in by_seat, "Seat2 는 실패해야 함"
    assert orch.error_queue.size() == 1, "Seat2 는 Error Queue 로"
    err = orch.error_queue.peek()
    assert err.seat_id == "Seat2" and err.attempts == 3
    print("PASS retry: 실패후성공(attempts=3) / 영구실패 → Error Queue")


def test_overflow():
    # 큐를 작게 두고, 여러 트리거를 한 번에 폴링 → 일부 드롭
    triggers = [mk_trigger(ttype=f"t{i}", target=["Seat1"]) for i in range(5)]
    for i, t in enumerate(triggers):
        t.trigger_id = f"2026-06-30_P0_t{i}"  # 유니크 id
    sch = FakeScheduler(triggers)
    cm = FakeCameraManager(["Seat1"])
    orch = OrchestratorEngine(sch, cm, max_queue_size=2, max_retries=0, retry_delay=0)
    orch._poll_once(now=datetime(2026, 6, 30, 9, 5))  # 5개 중 2개만 적재
    assert orch.queue.size() == 2, orch.queue.size()
    assert orch.queue.dropped == 3, orch.queue.dropped
    print("PASS overflow: max_queue=2 에서 5개 중 3개 드롭")


def test_worker_thread_and_shutdown():
    sch = FakeScheduler()
    cm = FakeCameraManager(["Seat1", "Seat2"])
    orch = OrchestratorEngine(sch, cm, poll_interval=0.1, max_retries=0, retry_delay=0)
    orch.start()
    # 트리거를 흘려보냄 → poll 스레드가 집어서 worker 가 처리
    sch.add(mk_trigger(target=["all"]))
    time.sleep(0.6)
    st = orch.stats()
    print("worker stats:", st)
    assert st["processed"] >= 2, "두 좌석 처리되어야 함"
    orch.stop()
    assert not orch._poll_thread.is_alive(), "poll 스레드 종료"
    assert not orch._worker_thread.is_alive(), "worker 스레드 종료"
    print("PASS worker+shutdown: 스레드 처리 및 정상 종료")


def main():
    test_queue()
    test_burst_and_multiseat()
    test_retry()
    test_overflow()
    test_worker_thread_and_shutdown()
    print("\nALL PASS: queue / burst / multiseat / retry / overflow / worker / shutdown")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드

`README.md` 만 수정(제목/파일표에 Orchestrator 추가 + Orchestrator Engine v0.1 섹션 신규).
코드 파일은 **하나도 수정하지 않았다**(CameraCore/CameraManager/SchedulerEngine 무수정).

README 추가 섹션 요지:
```
## Orchestrator Engine v0.1
- 전체 흐름: Scheduler → Trigger Queue → Worker → target_seats 해석
  → CameraManager.get_recent_frames(3) → (Retry/Error Queue) → BurstPackage → burst_consumer → (향후 AI)
- 느슨한 연결: scheduler/camera_manager 덕타이핑, burst_consumer 콜백(AI 교체 지점), 기존 모듈 무수정
- BurstPackage 필드 / 실행(--once --fake, --run --duration, --once --now) / 테스트 안내
```

---

## 4. Orchestrator 구조도

```
          ┌───────────────────────── OrchestratorEngine ─────────────────────────┐
          │                                                                       │
 [poll thread] every poll_interval                          [worker thread]       │
   now = now_fn()                                             loop:               │
   due = scheduler.get_due_triggers(now, record=True)          item = queue.dequeue(0.2)
   for trig in due:                                             if item:           │
     uuid = uuid4()                                               seats = resolve(trig.target_seats)
     queue.enqueue(_QueueItem(trig, uuid)) ──┐                    for seat in seats:
        (가득 차면 drop + 경고)               │                      frames = camera_manager
                                              ▼                                 .get_recent_frames(seat,3)
                                     ┌──────────────────┐           retry ≤2 ─┐  (실패 시)
                                     │  Trigger Queue   │                     ▼
                                     │ (max_size 한정)  │            error_queue.enqueue(ErrorItem)
                                     └──────────────────┘                     │
                                              │ frames 있음                    │
                                              ▼                               │
                                     BurstPackage(...) ── burst_consumer ──> (기본 sink: 로그+packages)
                                              │                                  └─ 향후 AI Engine 교체
                                              ▼
                                     events 기록 / stats 갱신
          └───────────────────────────────────────────────────────────────────────┘

  scheduler / camera_manager / burst_consumer 는 모두 외부 주입(덕타이핑) → Fake 대체 + AI 교체 용이.
```

---

## 5. Queue 구조 (TriggerQueue)

```
deque + Lock + Condition(not_empty)
  enqueue(item) : len >= max_size 면 False(+dropped++), 아니면 append + notify  → Overflow 방지
  dequeue(timeout): 비면 Condition.wait(timeout) → 있으면 popleft, 없으면 None
  peek()        : 머리 1개(제거 X)
  clear()       : 전체 비움
  size()/len    : 현재 길이
  dropped       : overflow 로 버린 누적 개수(관측)
용도: Trigger Queue + Error Queue 모두 동일 클래스 재사용.
```

---

## 6. Worker Thread 구조

```
스레드 2개(둘 다 daemon):
  orch-poll   : 스케줄 폴링 → 큐 적재. _stop.wait(poll_interval) 로 중단 가능.
  orch-worker : 큐 dequeue(0.2s) → _handle_item → 좌석 해석 → 좌석별 BurstPackage(+retry).
동기화:
  _stop(Event)        : 종료 신호(+중단 가능 sleep)
  queue Condition     : 워커 대기/깨우기
  _lock(Lock)         : 카운터(enqueued/processed/errors/dropped) 보호
종료:
  stop() → _stop.set() → 두 스레드 join(timeout=5). 예외는 try/except 로 스레드 사망 방지.
동기 경로:
  process_once(now)   : 스레드 없이 polling+drain (--once / 테스트용).
```

---

## 7. BurstPackage 설명

| 필드 | 의미 |
|------|------|
| `burst_uuid` | 이 묶음 고유 id (uuid4) |
| `trigger_uuid` | 트리거 dispatch 고유 id (큐 적재 시 부여) |
| `trigger_id` | SchedulerEngine 결정적 id (dedup 키) |
| `trigger_type` | start/mid/end/random/manual |
| `period_id` / `period_name` | 교시 |
| `seat_id` | 대상 좌석 |
| `captured_at` | 프레임 취득 시각 |
| `frame_count` / `frames` | CameraManager.get_recent_frames 결과(최근 N초) |
| `metadata` | `queue_delay_ms`, `processing_ms`, `attempts`, `recent_seconds` |

생성 단위: **트리거 1건 × 대상 좌석 1개 = BurstPackage 1개** (멀티좌석이면 N개).
`frames` 는 불투명 리스트라 AI/디코딩 의존이 없다.

---

## 8. 테스트 결과

### test_orchestrator_engine.py (카메라/AI 없이)
```
PASS queue: enqueue/dequeue/peek/clear/size/overflow
PASS burst+multiseat: BurstPackage 생성/필드/멀티좌석
PASS retry: 실패후성공(attempts=3) / 영구실패 → Error Queue
PASS overflow: max_queue=2 에서 5개 중 3개 드롭
PASS worker+shutdown: 스레드 처리 및 정상 종료
ALL PASS: queue / burst / multiseat / retry / overflow / worker / shutdown
```

### orchestrator_demo.py --once --fake
```
===== Orchestrator stats =====
  enqueued: 1
  processed: 3
  errors: 0
  dropped: 0
  queue_size: 0
  error_queue_size: 0
  events: 3
----- BurstPackage (최근) -----
  seat=Seat1 type=start_attendance_check frames=5 captured=... meta={'queue_delay_ms':0.1,'processing_ms':0.0,'attempts':1,'recent_seconds':3.0} burst_uuid=...
  seat=Seat2 ... frames=5 ...
  seat=Seat3 ... frames=5 ...
```

### 회귀 (기존 단계 미파손)
```
test_camera_core.py     → PASS
test_camera_manager.py  → PASS
test_scheduler_engine.py→ PASS
test_orchestrator_engine.py → ALL PASS
```

### 완료 조건 체크
- [x] Scheduler ↔ CameraManager 연결 (Orchestrator 중재)
- [x] BurstPackage 생성 성공
- [x] Queue 정상 (enqueue/dequeue/peek/clear/size/overflow)
- [x] Worker 정상 (스레드 처리/정상 종료)
- [x] Retry 정상 (실패후성공 / 영구실패 → Error Queue)
- [x] AI/Supabase/Dashboard/Rule Engine/MediaPipe/YOLO **미구현**
- [x] 기존 모듈 무수정 (회귀 PASS)

---

## 9. 남은 기술 부채 (운영 기준)

1. **트리거당 좌석을 직렬 처리** — 한 워커가 좌석들을 순차로 get_recent_frames. 8좌석×retry면 지연 누적. 좌석 병렬화 없음.
2. **워커 1개 고정** — 동시 트리거 폭증 시 큐만 쌓임. 워커 풀/동시성 설정 없음.
3. **Retry 정책 단순** — 고정 횟수+고정 지연. 백오프/지터/오류유형별 분기 없음. "빈 프레임"과 "예외"를 같은 실패로 취급.
4. **Error Queue 가 종착지** — 쌓이기만 하고 재처리/알림/드레인 소비자가 없음.
5. **packages/events 무한 보관 경향** — packages 는 keep_packages 로 제한하나 events 리스트는 무제한(장시간 메모리 증가).
6. **target_seats 해석이 running 의존** — 연결만 되고 프레임 미수신(검은화면) 좌석도 running 이면 대상. 프레임 품질/유효성 미확인.
7. **시계 일원화 부재** — queue_delay 는 perf_counter, captured_at 은 now_fn(datetime). now_fn 주입은 되나 단조시계/벽시계 혼용.
8. **BurstPackage frames 가 참조 공유** — CameraManager 링버퍼의 FrameItem 참조를 그대로 담음. 소비자가 오래 들고 있으면 버퍼 회전과 무관히 메모리 점유(복사/소유권 정책 없음).
9. **백프레셔 없음** — consumer(향후 AI)가 느리면 큐/메모리만 늘어남. 처리율 제어 없음.
10. **관측성 한계** — stats/로그만. 메트릭(Prometheus)·트레이싱·burst 영속 로그 없음.
11. **graceful drain 부재** — stop() 시 큐 잔여 항목을 버림(미처리). 종료 시 드레인 옵션 없음.
12. **테스트가 pytest 아님** — assert+`__main__`. CI/동시성 스트레스/타이밍 플래키 커버리지 부족.

---

## 10. v0.2 개선 계획

**P0 — 처리량/정확성**
1. **좌석 병렬 처리 + 워커 풀** — 트리거 내 좌석을 ThreadPool 로 동시 get_recent_frames. 워커 수 configurable.
2. **Retry 고도화** — 지수 백오프+지터, 오류유형(빈 프레임 vs 예외 vs 미연결) 분기, 좌석 미연결은 즉시 skip.
3. **frames 소유권 정책** — BurstPackage 에 얕은 복사/스냅샷 또는 명시적 TTL. 링버퍼 참조 장기 점유 방지.

**P1 — 운영성**
4. **Error Queue 소비자** — 재시도 스케줄/알림/드롭 메트릭. graceful drain(종료 시 잔여 처리 옵션).
5. **관측성** — Prometheus 메트릭(enqueued/processed/errors/queue_delay 분포), 구조화 로그, events 링버퍼화.
6. **백프레셔** — consumer 처리율 기반 폴링/적재 조절, 큐 가득 시 정책(드롭/블록/우선순위) 선택.

**P2 — 연결(다음 단계)**
7. **AI Engine 어댑터** — `burst_consumer` 자리에 MediaPipe/YOLO 어댑터 주입(Orchestrator 무수정). *AI 자체는 별도 단계.*
8. **target_seats 해석기 강화** — running + 최근 프레임 유효성까지 반영, 교시별/좌석별 규칙.
9. **pytest 전환 + CI**, 동시성/타이밍 스트레스 테스트.

> 경계: v0.2 까지도 **AI 판별/Supabase/대시보드/Rule Engine 은 미구현**. "트리거 → BurstPackage" 파이프라인의 견고화까지만.
