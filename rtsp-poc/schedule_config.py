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
