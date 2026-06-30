"""
FusionResult
============

FactsFusionEngine.fuse() 의 반환값. SeatFacts 생성 결과와 그 과정의 상태를 담는다.

status:
  - SUCCESS : OpenCV/MediaPipe/YOLO 결과가 모두 정상(SUCCESS)으로 들어옴
  - PARTIAL : 일부 결과가 누락/실패했지만 SeatFacts 생성은 가능
  - FAILED  : 치명적 오류로 SeatFacts 생성 실패(쓸 수 있는 source 가 없음)
  - SKIPPED : 입력 결과가 아예 없거나 분석 불가

이 모듈은 OpenCV / MediaPipe / YOLO 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from seat_facts import SeatFacts

# fusion 상태
FUSION_SUCCESS = "SUCCESS"
FUSION_PARTIAL = "PARTIAL"
FUSION_FAILED = "FAILED"
FUSION_SKIPPED = "SKIPPED"


@dataclass
class FusionResult:
    fusion_uuid: str
    seat_id: str
    burst_uuid: str
    status: str                                  # SUCCESS | PARTIAL | FAILED | SKIPPED
    seat_facts: Optional[SeatFacts]              # FAILED/SKIPPED 면 None 일 수 있음
    missing_sources: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    generated_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
