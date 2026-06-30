"""
AnalysisResult
==============

AI Engine 이 BurstPackage 를 분석한 결과(이번 단계는 Dummy 만 생성).
향후 Rule Engine 이 이 결과를 입력으로 받는다(이번 단계는 호출하지 않음).

OpenCV / AI 라이브러리에 의존하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional

# 분석 상태
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED = "FAILED"
STATUS_SKIPPED = "SKIPPED"

# 활동(activity) — 이번 단계는 문자열만, 실제 판별은 미구현
ACTIVITY_UNKNOWN = "UNKNOWN"


@dataclass
class AnalysisResult:
    analysis_uuid: str
    burst_uuid: str
    seat_id: str
    started_at: datetime
    finished_at: datetime
    processing_time: float           # 처리 시간(ms)
    confidence: float                # 0.0 ~ 1.0 (Dummy 는 0)
    status: str                      # SUCCESS | FAILED | SKIPPED
    activity: str                    # 현재는 "UNKNOWN" 만
    scores: Dict[str, float] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
