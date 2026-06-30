# Scheduler Engine v0.1 — 구현 완료 리뷰 (복붙용)

> 클립보드 복붙용 문서. 전체 선택(Ctrl/Cmd+A) → 복사.
> 범위: 교시 기반 Burst 트리거 생성까지. MediaPipe/YOLO/AI/Supabase/대시보드 미구현.

---

## 1. 전체 파일 목록

```
rtsp-poc/
├── ring_buffer.py            # [Core v0.1] 변경 없음
├── camera_core.py            # [Core v0.1] 변경 없음
├── main.py                   # [Core v0.1] 변경 없음
├── camera_config.py          # [Manager v0.1] 변경 없음
├── camera_manager.py         # [Manager v0.1] 변경 없음
├── manage.py                 # [Manager v0.1] 변경 없음
├── cameras.yaml              # [Manager v0.1] 변경 없음
├── schedule_config.py        # [NEW] ScheduleConfig / TriggerEvent + schedule 로더
├── scheduler_engine.py       # [NEW] SchedulerEngine (교시 기반 트리거 생성)
├── scheduler_demo.py         # [NEW] CLI 데모
├── schedule.yaml             # [NEW] 0~8교시 시간표
├── test_scheduler_engine.py  # [NEW] Scheduler 테스트(카메라 없이)
├── test_camera_core.py       # [Core v0.1] 변경 없음
├── test_camera_manager.py    # [Manager v0.1] 변경 없음
├── requirements.txt          # 변경 없음(PyYAML 이미 포함)
├── .env.example              # 변경 없음
├── README.md                 # [수정] Scheduler Engine v0.1 섹션 추가
├── CODE_REVIEW_v0.1.md       # [Core 리뷰]
├── CAMERA_MANAGER_v0.1.md    # [Manager 리뷰]
├── SCHEDULER_ENGINE_v0.1.md  # (이 문서)
└── rtsp_poc.py               # [레거시]
```

기존 Camera Core / CameraManager 파일은 **한 줄도 수정하지 않았다**(느슨한 연결, 독립 모듈로 추가).

---

## 2. 전체 코드 (신규 파일)

### schedule_config.py
```python
"""
ScheduleConfig / TriggerEvent & 스케줄 로더
==========================================

교시 시간표(schedule.yaml)를 설정으로 관리한다. 시간은 하드코딩하지 않는다.

이 모듈은 OpenCV / CameraManager 에 의존하지 않는다(느슨한 연결 + 테스트 용이).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import List, Optional

log = logging.getLogger("schedule_config")

# 교시(period) 유형
PERIOD_TYPES = {"attendance_check", "study_period", "meal", "break"}

# Burst 트리거 유형
TRIGGER_TYPES = {
    "start_attendance_check",
    "mid_study_check",
    "end_attendance_check",
    "random_study_check",
    "manual_check",
}


@dataclass
class ScheduleConfig:
    """교시 1개의 설정."""
    period_id: str          # 예: "P0", "lunch"
    name: str               # 예: "0교시", "점심"
    start_time: time        # 시작 시각(시:분)
    end_time: time          # 종료 시각(시:분)
    type: str               # attendance_check | study_period | meal | break
    enabled: bool = True
    memo: str = ""


@dataclass
class TriggerEvent:
    """Burst 요청 1건. SchedulerEngine 이 생성하고, 향후 Orchestrator 가 소비한다."""
    trigger_id: str             # 하루 단위로 유일 (중복 실행 방지 키)
    period_id: str
    period_name: str
    trigger_type: str           # TRIGGER_TYPES 중 하나
    scheduled_time: datetime    # 예정 시각(해당 날짜 + 시:분)
    reason: str
    target_seats: List[str] = field(default_factory=lambda: ["all"])
    created_at: Optional[datetime] = None  # 실제로 due 로 방출된 시각


def parse_hhmm(value) -> time:
    """"HH:MM" 문자열을 datetime.time 으로 변환한다."""
    if isinstance(value, time):
        return value
    s = str(value).strip()
    hh, mm = s.split(":")
    return time(int(hh), int(mm))


def _read_raw(path: str):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if path.endswith((".yaml", ".yml")):
        import yaml  # PyYAML (yaml 파일을 쓸 때만 필요)
        return yaml.safe_load(text)
    return json.loads(text)


def load_schedule(path: str) -> List[ScheduleConfig]:
    """
    schedule.yaml / schedule.json 을 읽어 ScheduleConfig 리스트로 반환한다(시작시각 정렬).
    최상위 `periods:` 리스트 또는 그냥 리스트 둘 다 허용.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"스케줄 설정 파일을 찾을 수 없습니다: {path}")

    raw = _read_raw(path)
    entries = raw.get("periods", []) if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise ValueError("설정 파일의 periods 는 리스트여야 합니다.")

    periods: List[ScheduleConfig] = []
    for entry in entries:
        ptype = str(entry.get("type", "study_period"))
        if ptype not in PERIOD_TYPES:
            log.warning("[%s] 알 수 없는 type=%s (그대로 사용)", entry.get("period_id"), ptype)
        periods.append(ScheduleConfig(
            period_id=str(entry["period_id"]),
            name=str(entry.get("name", entry["period_id"])),
            start_time=parse_hhmm(entry["start_time"]),
            end_time=parse_hhmm(entry["end_time"]),
            type=ptype,
            enabled=bool(entry.get("enabled", True)),
            memo=str(entry.get("memo", "")),
        ))

    periods.sort(key=lambda p: p.start_time)
    return periods
```

### scheduler_engine.py
```python
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
```

### scheduler_demo.py
```python
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
```

### schedule.yaml
```yaml
# =========================================================================
# 솔로몬 스터디카페 교시 시간표 (Scheduler Engine v0.1)
# =========================================================================
# - 교시 시간은 코드에 하드코딩하지 않고 이 파일에서 읽는다.
# - type: attendance_check | study_period | meal | break
#   * study_period 만 Burst 트리거를 생성한다.
#   * meal / break / attendance_check 는 Burst 미생성.
# - start_time / end_time 은 "HH:MM" 24시간제.
# - enabled=false 인 교시는 무시된다.
# =========================================================================

periods:
  - period_id: arrival
    name: "등원 확인"
    start_time: "08:40"
    end_time: "09:00"
    type: attendance_check
    enabled: true
    memo: "등원 시간"

  - period_id: P0
    name: "0교시"
    start_time: "09:00"
    end_time: "09:50"
    type: study_period
    enabled: true

  - period_id: break1
    name: "쉬는시간"
    start_time: "09:50"
    end_time: "10:00"
    type: break
    enabled: true

  - period_id: P1
    name: "1교시"
    start_time: "10:00"
    end_time: "10:50"
    type: study_period
    enabled: true

  - period_id: break2
    name: "쉬는시간"
    start_time: "10:50"
    end_time: "11:00"
    type: break
    enabled: true

  - period_id: P2
    name: "2교시"
    start_time: "11:00"
    end_time: "11:50"
    type: study_period
    enabled: true

  - period_id: lunch
    name: "점심"
    start_time: "11:50"
    end_time: "13:00"
    type: meal
    enabled: true

  - period_id: P3
    name: "3교시"
    start_time: "13:00"
    end_time: "13:50"
    type: study_period
    enabled: true

  - period_id: break3
    name: "쉬는시간"
    start_time: "13:50"
    end_time: "14:00"
    type: break
    enabled: true

  - period_id: P4
    name: "4교시"
    start_time: "14:00"
    end_time: "14:50"
    type: study_period
    enabled: true

  - period_id: break4
    name: "쉬는시간"
    start_time: "14:50"
    end_time: "15:00"
    type: break
    enabled: true

  - period_id: P5
    name: "5교시"
    start_time: "15:00"
    end_time: "15:50"
    type: study_period
    enabled: true

  - period_id: break5
    name: "쉬는시간"
    start_time: "15:50"
    end_time: "16:00"
    type: break
    enabled: true

  - period_id: P6
    name: "6교시"
    start_time: "16:00"
    end_time: "16:50"
    type: study_period
    enabled: true

  - period_id: dinner
    name: "저녁"
    start_time: "16:50"
    end_time: "18:00"
    type: meal
    enabled: true

  - period_id: P7
    name: "7교시"
    start_time: "18:00"
    end_time: "18:50"
    type: study_period
    enabled: true

  - period_id: break6
    name: "쉬는시간"
    start_time: "18:50"
    end_time: "19:00"
    type: break
    enabled: true

  - period_id: P8
    name: "8교시"
    start_time: "19:00"
    end_time: "19:50"
    type: study_period
    enabled: true
```

### test_scheduler_engine.py
```python
"""
SchedulerEngine 테스트 (카메라/AI 없이).

검증 항목:
  - 09:05 → start_attendance_check 발생
  - 같은 시각 재호출 시 중복 발생하지 않음 (dedup)
  - 교시 종료 5분 전 → end_attendance_check 발생
  - 점심/저녁 시간에는 trigger 발생하지 않음
  - get_current_period() / get_today_timeline() 정상
  - TriggerEvent 필드 완비
"""
from datetime import datetime, time

from schedule_config import ScheduleConfig, TriggerEvent
from scheduler_engine import SchedulerEngine

D = (2026, 6, 30)  # 고정 날짜로 결정적 테스트


def _periods():
    return [
        ScheduleConfig("arrival", "등원 확인", time(8, 40), time(9, 0), "attendance_check"),
        ScheduleConfig("P0", "0교시", time(9, 0), time(9, 50), "study_period"),
        ScheduleConfig("break1", "쉬는시간", time(9, 50), time(10, 0), "break"),
        ScheduleConfig("P1", "1교시", time(10, 0), time(10, 50), "study_period"),
        ScheduleConfig("lunch", "점심", time(11, 50), time(13, 0), "meal"),
        ScheduleConfig("P3", "3교시", time(13, 0), time(13, 50), "study_period"),
        ScheduleConfig("dinner", "저녁", time(16, 50), time(18, 0), "meal"),
    ]


def at(h, m):
    return datetime(D[0], D[1], D[2], h, m)


def main():
    eng = SchedulerEngine(periods=_periods(), target_seats=["all"],
                          enable_random=False)  # 랜덤 제외 → 결정적

    # 1) 09:05 → start_attendance_check
    due = eng.get_due_triggers(at(9, 5))
    types = [e.trigger_type for e in due]
    print("09:05 due:", types)
    assert "start_attendance_check" in types, "09:05 start_attendance_check 필요"
    start_ev = next(e for e in due if e.trigger_type == "start_attendance_check")
    assert start_ev.period_id == "P0", start_ev.period_id

    # 2) 같은 시각 재호출 → dedup (빈 결과)
    due2 = eng.get_due_triggers(at(9, 5))
    print("09:05 재호출 due:", [e.trigger_type for e in due2])
    assert due2 == [], "중복 트리거가 발생하면 안 됨"
    # 새 엔진(기록 없음)에서는 should_trigger_burst True 여야 함(peek)
    fresh = SchedulerEngine(periods=_periods(), enable_random=False)
    assert fresh.should_trigger_burst(at(9, 5)) is True
    assert "start_attendance_check" in (fresh.get_trigger_reason(at(9, 5)) or "")

    # 3) 교시 종료 5분 전(0교시 09:50 → 09:45) → end_attendance_check
    eng2 = SchedulerEngine(periods=_periods(), enable_random=False)
    due_end = eng2.get_due_triggers(at(9, 45))
    print("09:45 due:", [e.trigger_type for e in due_end])
    assert any(e.trigger_type == "end_attendance_check" for e in due_end), "end_attendance_check 필요"

    # 4) 점심/저녁 → trigger 없음
    eng3 = SchedulerEngine(periods=_periods(), enable_random=False)
    assert eng3.get_due_triggers(at(12, 0)) == [], "점심엔 트리거 없음"
    assert eng3.should_trigger_burst(at(12, 0)) is False
    assert eng3.get_due_triggers(at(17, 0)) == [], "저녁엔 트리거 없음"

    # 5) get_current_period
    assert eng3.get_current_period(at(9, 5)).period_id == "P0"
    assert eng3.get_current_period(at(12, 0)).type == "meal"
    nxt = eng3.get_next_period(at(9, 55))  # 쉬는시간 09:50-10:00, 다음 교시는 P1
    assert nxt.period_id == "P1", nxt.period_id

    # 6) get_today_timeline
    timeline = eng3.get_today_timeline()
    assert len(timeline) == len(_periods())
    assert timeline == sorted(timeline, key=lambda p: p.start_time), "시작시각 정렬"

    # 7) TriggerEvent 필드 완비
    ev = start_ev
    for fld in ["trigger_id", "period_id", "period_name", "trigger_type",
                "scheduled_time", "reason", "target_seats", "created_at"]:
        assert hasattr(ev, fld), f"필드 누락: {fld}"
    assert ev.created_at is not None and ev.target_seats == ["all"]
    assert ev.trigger_id == "2026-06-30_P0_start_attendance_check", ev.trigger_id

    # 8) mid_study_check 가 교시 중간에 생성되는지(0교시 09:00~09:50, 18분 간격)
    planned = eng3.get_planned_triggers(at(9, 0).date())
    mids = [e for e in planned if e.period_id == "P0" and e.trigger_type == "mid_study_check"]
    print("P0 mid checks:", [f"{e.scheduled_time:%H:%M}" for e in mids])
    assert len(mids) >= 1, "mid_study_check 최소 1개"

    print("\nPASS: 09:05 start / dedup / 09:45 end / meal무트리거 / current_period / timeline / 필드 모두 정상")


if __name__ == "__main__":
    main()
```

---

## 3. 테스트 결과

### test_scheduler_engine.py (카메라/AI 없이)
```
09:05 due: ['start_attendance_check']
09:05 재호출 due: []
09:45 due: ['end_attendance_check']
P0 mid checks: ['09:18', '09:36']
PASS: 09:05 start / dedup / 09:45 end / meal무트리거 / current_period / timeline / 필드 모두 정상
```

### scheduler_demo.py --now 09:05
```
===== 기준 시각: 2026-06-30 09:05 =====
  현재 교시 : 0교시 [study_period]
  다음 교시 : 쉬는시간 (09:50)
  Burst 요청 여부 : True
  사유 : start_attendance_check: 교시 시작 5분 후 착석 확인
  Due TriggerEvent:
    - id=2026-06-30_P0_start_attendance_check
      type=start_attendance_check period=P0(0교시) scheduled=09:05 seats=['all']
```

### scheduler_demo.py --now 12:00 (점심)
```
===== 기준 시각: 2026-06-30 12:00 =====
  현재 교시 : 점심 [meal]
  다음 교시 : 3교시 (13:00)
  Burst 요청 여부 : False
  사유 : -
```

### scheduler_demo.py --timeline (0교시 발췌)
```
  09:05  start_attendance_check 0교시 - 교시 시작 5분 후 착석 확인  (seats=['all'])
  09:18  mid_study_check        0교시 - 교시 중 정기 분석(18분 간격) (seats=['all'])
  09:18  random_study_check     0교시 - 교시 중 랜덤 분석            (seats=['all'])
  09:36  mid_study_check        0교시 - 교시 중 정기 분석(18분 간격) (seats=['all'])
  09:45  end_attendance_check   0교시 - 교시 종료 5분 전 착석 확인   (seats=['all'])
```

### 회귀 (기존 단계 미파손)
```
test_camera_core.py     → PASS (수신/health/get_recent_frames/재연결/정상종료)
test_camera_manager.py  → PASS (enabled필터/get_recent_frames/get_all_health/stop_all)
test_scheduler_engine.py→ PASS
```

### 완료 조건 체크
- [x] SchedulerEngine 단독 실행 (scheduler_demo.py)
- [x] schedule.yaml 기반 교시 판단 (get_current_period/get_next_period/timeline)
- [x] TriggerEvent 생성 (start/mid/end/random/manual)
- [x] 중복 Trigger 방지 (메모리 dedup, trigger_id)
- [x] 카메라/AI 없이 테스트 통과
- [x] 기존 CameraCore/CameraManager 미파손 (회귀 PASS, 무수정)

---

## 4. 남은 기술 부채 (운영 기준)

1. **자정 넘어가는 교시 미지원** — 24시제 단순 비교라 야간(23:00~01:00) 교시는 처리 못 함.
2. **시간대(timezone)/DST 미고려** — `datetime.now()` 로컬 시간 가정. NTP/서버 TZ 불일치 시 트리거 어긋남.
3. **dedup 기록이 영구 누적/비영속** — `_executed` 세트가 프로세스 메모리에만 존재(재시작 시 같은 날 트리거 재발) + 날짜 지나도 안 비워져 메모리 미세 증가.
4. **트리거 누락 위험(window 의존)** — Orchestrator 폴링 간격이 `trigger_window_seconds`(60s)보다 길면 트리거를 놓침. 캐치업(지나간 트리거 보정) 없음.
5. **교시 겹침/검증 부재** — start<end, 교시 간 overlap, 중복 period_id 검증이 없음(잘못된 yaml 도 그대로 동작).
6. **target_seats 가 정적** — `["all"]` 고정. 좌석별/교시별 다른 대상, enabled 카메라 연동은 Orchestrator 몫(아직 없음).
7. **랜덤 분석 1~2회 상한만 지원** — `random_checks_per_period` 정수 1개. "1~2회 범위 랜덤"이나 분포 제어는 미구현.
8. **schedule.yaml 핫리로드 불가** — 시간표 변경 시 재시작 필요. 파일 변경 감지/주기적 리로드 없음.
9. **요일/공휴일/특별일정 미지원** — 모든 날 동일 시간표. 주말·시험기간 등 변형 불가.
10. **관측성 부족** — 트리거를 logging 으로만 남김. 메트릭/감사로그/예정 트리거 export 없음.
11. **manual_check 연동 경로 부재** — 메서드는 있으나 외부(관리자 버튼 등)에서 호출할 인터페이스/큐 없음.
12. **테스트가 pytest 아님** — assert+`__main__` 스크립트. CI/파라미터화/엣지 케이스 커버리지 부족.

---

## 5. 다음 개선안 (Scheduler Engine v0.2 / Orchestrator)

**P0 — 정확성/견고성**
1. dedup 기록 **영속화(파일/SQLite)** + 날짜 경과 시 정리. 재시작해도 같은 트리거 재발 방지.
2. **캐치업 로직** — 마지막 폴링 이후 지나간 트리거를 보정(window 의존 제거). 폴링 간격과 분리.
3. **스케줄 검증기** — start<end, overlap, 중복 id, 누락 필드 검사 + 명확한 에러.
4. **timezone 명시** — 설정에 TZ 두고 aware datetime 사용.

**P1 — 연결(다음 단계 핵심)**
5. **Orchestrator 신설** — `get_due_triggers()` 폴링 → `TriggerEvent.target_seats` → `CameraManager.get_recent_frames(seat_id,3)` 묶어 "Burst 묶음" 생성(여전히 AI 없음). SchedulerEngine↔CameraManager 를 Orchestrator 가 중재(느슨한 연결 유지).
6. **target_seats 해석기** — "all" → 현재 enabled/연결된 좌석으로 확장(CameraManager.get_all_health 활용).
7. **manual_check 진입점** — 관리자 트리거용 큐/콜백.

**P2 — 운영성/유연성**
8. 요일·공휴일·특별일정(시험기간) 프로파일.
9. schedule.yaml 핫리로드(파일 watch).
10. 랜덤 1~2회 범위 + 분포 제어, 교시별 규칙 오버라이드.
11. pytest 전환 + CI, 예정 트리거 export(JSON), 메트릭.

> 경계: v0.2/Orchestrator 까지도 **AI 판별/Supabase/대시보드는 미구현**. "트리거 → 프레임 묶음 전달"까지만.
