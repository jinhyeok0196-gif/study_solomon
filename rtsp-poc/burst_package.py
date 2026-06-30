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
