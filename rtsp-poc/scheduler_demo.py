"""
SchedulerEngine v0.1 - CLI 데모
===============================

카메라/AI 없이 교시 판단과 Burst 트리거를 확인한다.

실행 예시:
  python scheduler_demo.py --now 09:05        # 09:05 기준 현재/다음 교시 + 트리거 여부
  python scheduler_demo.py --timeline         # 오늘 교시 + 계획된 트리거 전체
  python scheduler_demo.py --now 12:00        # 점심(트리거 없음) 확인
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, date as date_cls

from schedule_config import parse_hhmm
from scheduler_engine import SchedulerEngine

log = logging.getLogger("scheduler_demo")

DEFAULT_SCHEDULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schedule.yaml")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon SchedulerEngine v0.1 데모")
    p.add_argument("--now", metavar="HH:MM", help="기준 시각(미지정 시 현재 시각)")
    p.add_argument("--timeline", action="store_true", help="오늘 교시 + 계획된 트리거 전체 출력")
    p.add_argument("--schedule", default=DEFAULT_SCHEDULE, help="스케줄 파일 경로")
    p.add_argument("--target-seats", default="all",
                   help="대상 좌석(콤마 구분, 기본 all). 예: Seat1,Seat2")
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def resolve_now(now_arg) -> datetime:
    if not now_arg:
        return datetime.now()
    t = parse_hhmm(now_arg)
    today = date_cls.today()
    return datetime(today.year, today.month, today.day, t.hour, t.minute)


def print_timeline(engine: SchedulerEngine, d: date_cls) -> None:
    print("===== 오늘 교시 타임라인 =====")
    for p in engine.get_today_timeline():
        print(f"  {p.start_time:%H:%M}-{p.end_time:%H:%M}  {p.period_id:<8} "
              f"{p.name:<8} [{p.type}]{('  · ' + p.memo) if p.memo else ''}")
    print("\n===== 계획된 Burst 트리거 =====")
    for ev in engine.get_planned_triggers(d):
        print(f"  {ev.scheduled_time:%H:%M}  {ev.trigger_type:<22} "
              f"{ev.period_name:<6} - {ev.reason}  (seats={ev.target_seats})")


def print_now_status(engine: SchedulerEngine, now: datetime) -> None:
    cur = engine.get_current_period(now)
    nxt = engine.get_next_period(now)
    print(f"===== 기준 시각: {now:%Y-%m-%d %H:%M} =====")
    print(f"  현재 교시 : {cur.name + ' [' + cur.type + ']' if cur else '없음'}")
    print(f"  다음 교시 : {(nxt.name + ' (' + format(nxt.start_time, '%H:%M') + ')') if nxt else '없음'}")
    print(f"  Burst 요청 여부 : {engine.should_trigger_burst(now)}")
    reason = engine.get_trigger_reason(now)
    print(f"  사유 : {reason if reason else '-'}")
    due = engine.get_due_triggers(now, record=False)
    if due:
        print("  Due TriggerEvent:")
        for ev in due:
            print(f"    - id={ev.trigger_id}")
            print(f"      type={ev.trigger_type} period={ev.period_id}({ev.period_name}) "
                  f"scheduled={ev.scheduled_time:%H:%M} seats={ev.target_seats}")


def main() -> int:
    args = parse_args()
    setup_logging()

    seats = [s.strip() for s in args.target_seats.split(",") if s.strip()]
    engine = SchedulerEngine(schedule_path=args.schedule, target_seats=seats)
    try:
        engine.load_schedule()
    except Exception as exc:
        log.error("스케줄 로드 실패: %s", exc)
        return 1

    now = resolve_now(args.now)
    if args.timeline:
        print_timeline(engine, now.date())
    else:
        print_now_status(engine, now)
    return 0


if __name__ == "__main__":
    sys.exit(main())
