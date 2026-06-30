"""
SchedulerEngine v0.1
====================

교시 시간표(schedule.yaml)를 기반으로 "언제 Burst Analysis 를 요청할지"를 결정한다.
- TriggerEvent 만 생성한다. AI 를 호출하지 않고 CameraManager 에 강하게 의존하지 않는다.
- 향후 Orchestrator 가 TriggerEvent 를 받아 CameraManager.get_recent_frames(seat_id, 3) 를 호출한다.

이 단계에서 하지 않는 것: MediaPipe / YOLO / AI 판별 / Supabase / Rule Engine / 대시보드.

Burst 트리거 규칙 (study_period 기준):
  - 교시 시작 N분 후       → start_attendance_check (착석 확인)
  - 교시 종료 N분 전       → end_attendance_check
  - 교시 중간 15~20분 간격 → mid_study_check (정기 분석)
  - 교시 중 랜덤 1~2회     → random_study_check (선택 가능)
  - break / meal 시간      → Burst 요청하지 않음
"""

from __future__ import annotations

import hashlib
import logging
import random
from dataclasses import replace
from datetime import date as date_cls
from datetime import datetime, timedelta
from typing import List, Optional

from schedule_config import (
    ScheduleConfig,
    TriggerEvent,
    load_schedule,
)

log = logging.getLogger("scheduler_engine")


class SchedulerEngine:
    def __init__(
        self,
        schedule_path: Optional[str] = None,
        periods: Optional[List[ScheduleConfig]] = None,
        target_seats: Optional[List[str]] = None,
        start_offset_min: int = 5,
        end_offset_min: int = 5,
        mid_interval_min: int = 18,
        random_checks_per_period: int = 1,
        enable_random: bool = True,
        trigger_window_seconds: float = 60.0,
    ) -> None:
        self.schedule_path = schedule_path
        self._periods: List[ScheduleConfig] = list(periods) if periods else []
        self.target_seats = list(target_seats) if target_seats else ["all"]

        self.start_offset_min = start_offset_min
        self.end_offset_min = end_offset_min
        self.mid_interval_min = mid_interval_min
        self.random_checks_per_period = random_checks_per_period
        self.enable_random = enable_random
        self.trigger_window_seconds = trigger_window_seconds

        # 중복 실행 방지: 이미 방출된 trigger_id 를 메모리에 기록
        self._executed: set[str] = set()

    # --------------------------------------------------------------- loading
    def load_schedule(self) -> List[ScheduleConfig]:
        if not self.schedule_path:
            raise ValueError("schedule_path 가 설정되지 않았습니다.")
        self._periods = load_schedule(self.schedule_path)
        log.info("스케줄 로드: %d개 교시 (%s)", len(self._periods), self.schedule_path)
        return self._periods

    def _enabled_periods(self) -> List[ScheduleConfig]:
        return sorted((p for p in self._periods if p.enabled), key=lambda p: p.start_time)

    # ------------------------------------------------------------ period API
    def get_current_period(self, now: Optional[datetime] = None) -> Optional[ScheduleConfig]:
        now = now or datetime.now()
        t = now.time()
        for p in self._enabled_periods():
            if p.start_time <= t < p.end_time:
                return p
        return None

    def get_next_period(self, now: Optional[datetime] = None) -> Optional[ScheduleConfig]:
        now = now or datetime.now()
        t = now.time()
        upcoming = [p for p in self._enabled_periods() if p.start_time > t]
        return upcoming[0] if upcoming else None

    def get_today_timeline(self) -> List[ScheduleConfig]:
        """오늘 교시 타임라인(시작시각 정렬)."""
        return self._enabled_periods()

    # ----------------------------------------------------- trigger planning
    def _make_trigger(
        self,
        d: date_cls,
        period: ScheduleConfig,
        trigger_type: str,
        scheduled_time: datetime,
        reason: str,
        unique_by_time: bool = False,
    ) -> TriggerEvent:
        if unique_by_time:
            tid = f"{d.isoformat()}_{period.period_id}_{trigger_type}_{scheduled_time:%H%M}"
        else:
            tid = f"{d.isoformat()}_{period.period_id}_{trigger_type}"
        return TriggerEvent(
            trigger_id=tid,
            period_id=period.period_id,
            period_name=period.name,
            trigger_type=trigger_type,
            scheduled_time=scheduled_time,
            reason=reason,
            target_seats=list(self.target_seats),
        )

    def get_planned_triggers(self, d: Optional[date_cls] = None) -> List[TriggerEvent]:
        """해당 날짜의 study_period 들에 대해 계획된 모든 TriggerEvent 를 생성(시각 정렬)."""
        d = d or datetime.now().date()
        triggers: List[TriggerEvent] = []

        for p in self._enabled_periods():
            if p.type != "study_period":
                continue  # break/meal/attendance_check 는 Burst 미생성

            start_dt = datetime.combine(d, p.start_time)
            end_dt = datetime.combine(d, p.end_time)
            start_check = start_dt + timedelta(minutes=self.start_offset_min)
            end_check = end_dt - timedelta(minutes=self.end_offset_min)

            # 교시 시작 N분 후
            if start_check < end_dt:
                triggers.append(self._make_trigger(
                    d, p, "start_attendance_check", start_check,
                    f"교시 시작 {self.start_offset_min}분 후 착석 확인"))

            # 교시 종료 N분 전
            if end_check > start_dt and end_check > start_check:
                triggers.append(self._make_trigger(
                    d, p, "end_attendance_check", end_check,
                    f"교시 종료 {self.end_offset_min}분 전 착석 확인"))

            # 교시 중간 정기 분석 (15~20분 간격)
            t = start_dt + timedelta(minutes=self.mid_interval_min)
            while t < end_check:
                if t > start_check:
                    triggers.append(self._make_trigger(
                        d, p, "mid_study_check", t,
                        f"교시 중 정기 분석({self.mid_interval_min}분 간격)",
                        unique_by_time=True))
                t += timedelta(minutes=self.mid_interval_min)

            # 교시 중 랜덤 분석 (1~2회, 날짜+교시로 시드 고정 → 결정적)
            if self.enable_random and self.random_checks_per_period > 0:
                lo = start_dt + timedelta(minutes=10)
                hi = end_dt - timedelta(minutes=10)
                total = int((hi - lo).total_seconds())
                if total > 0:
                    rng = random.Random(self._seed(d, p.period_id))
                    k = min(self.random_checks_per_period, total)
                    for sec in sorted(rng.sample(range(total), k)):
                        rt = (lo + timedelta(seconds=sec)).replace(second=0, microsecond=0)
                        triggers.append(self._make_trigger(
                            d, p, "random_study_check", rt,
                            "교시 중 랜덤 분석", unique_by_time=True))

        triggers.sort(key=lambda e: e.scheduled_time)
        return triggers

    @staticmethod
    def _seed(d: date_cls, period_id: str) -> int:
        """PYTHONHASHSEED 와 무관하게 결정적인 시드(날짜+교시)."""
        digest = hashlib.sha256(f"{d.isoformat()}:{period_id}".encode()).digest()
        return int.from_bytes(digest[:8], "big")

    # -------------------------------------------------------- trigger output
    def get_due_triggers(self, now: Optional[datetime] = None, record: bool = True) -> List[TriggerEvent]:
        """
        지금(now) 시점에 실행해야 할(아직 실행 안 된) TriggerEvent 들을 반환한다.
        record=True 면 중복 방지를 위해 실행 기록에 추가한다.
        """
        now = now or datetime.now()
        due: List[TriggerEvent] = []
        for ev in self.get_planned_triggers(now.date()):
            if ev.trigger_id in self._executed:
                continue
            delta = (now - ev.scheduled_time).total_seconds()
            if 0 <= delta <= self.trigger_window_seconds:
                due.append(replace(ev, created_at=now))

        if record:
            for ev in due:
                self._executed.add(ev.trigger_id)
                log.info("TRIGGER %s [%s] %s @ %s - %s (seats=%s)",
                         ev.trigger_type, ev.period_name, ev.trigger_id,
                         ev.scheduled_time.strftime("%H:%M"), ev.reason, ev.target_seats)
        return due

    def should_trigger_burst(self, now: Optional[datetime] = None) -> bool:
        return len(self.get_due_triggers(now, record=False)) > 0

    def get_trigger_reason(self, now: Optional[datetime] = None) -> Optional[str]:
        due = self.get_due_triggers(now, record=False)
        if not due:
            return None
        return "; ".join(f"{e.trigger_type}: {e.reason}" for e in due)

    # --------------------------------------------------------------- manual
    def make_manual_trigger(self, now: Optional[datetime] = None,
                            target_seats: Optional[List[str]] = None) -> TriggerEvent:
        """수동 Burst 요청(교시와 무관). dedup 대상 아님(매번 유일 id)."""
        now = now or datetime.now()
        period = self.get_current_period(now)
        tid = f"{now.date().isoformat()}_manual_{now:%H%M%S}"
        return TriggerEvent(
            trigger_id=tid,
            period_id=period.period_id if period else "-",
            period_name=period.name if period else "-",
            trigger_type="manual_check",
            scheduled_time=now,
            reason="수동 요청",
            target_seats=list(target_seats or self.target_seats),
            created_at=now,
        )

    def reset_executed(self) -> None:
        self._executed.clear()
