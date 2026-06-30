"""
SeatFacts
=========

여러 분석 엔진(OpenCV / MediaPipe / YOLO)의 결과를 **하나의 좌석 단위 사실 모음**으로
합친 표준 데이터. Rule Engine 이 사용할 **표준 입력**이다.

매우 중요:
  - SeatFacts 는 **판단 결과가 아니다.**
  - SeatFacts 는 "현재 좌석에서 관측된 사실(Facts) 모음" 일 뿐이다.
  - 공부/휴대폰 사용/수면/자리비움 같은 **최종 행동 판별을 절대 담지 않는다**(Rule Engine 의 일).

이 모듈은 OpenCV / MediaPipe / YOLO 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class SeatFacts:
    facts_uuid: str
    burst_uuid: str
    seat_id: str
    period_id: Optional[str]
    period_name: Optional[str]
    captured_at: Optional[datetime]
    generated_at: datetime

    # 엔진별 사실 묶음(해석 없음)
    vision: Dict[str, Any] = field(default_factory=dict)    # OpenCV 요약
    human: Dict[str, Any] = field(default_factory=dict)     # MediaPipe 요약
    objects: Dict[str, Any] = field(default_factory=dict)   # YOLO 요약

    # 전체 "판정 재료 품질" 점수(행동 신뢰도가 아님)
    quality: Dict[str, Any] = field(default_factory=dict)

    # 입력으로 사용된 AnalysisResult UUID 목록
    source_results: List[str] = field(default_factory=list)

    # trace 정보, engine 상태, 오류, 누락된 결과 등
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        """로그/출력용 축약 dict."""
        return {
            "facts_uuid": self.facts_uuid,
            "burst_uuid": self.burst_uuid,
            "seat_id": self.seat_id,
            "period_id": self.period_id,
            "vision": self.vision,
            "human": self.human,
            "objects": self.objects,
            "quality": self.quality,
            "source_results": list(self.source_results),
        }
