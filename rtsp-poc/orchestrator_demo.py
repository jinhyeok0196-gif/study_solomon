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
