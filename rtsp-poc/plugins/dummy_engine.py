"""
DummyAIEngine
=============

AIEngine 인터페이스의 최소 구현체. **실제 분석은 하지 않는다.**
analyze() 호출 시 activity="UNKNOWN", confidence=0 인 AnalysisResult 를 반환한다.

목적: AI 를 교체 가능한 구조로 만들기 위한 자리표시자(placeholder).
향후 MediaPipeEngine / YOLOEngine 등이 동일 인터페이스로 이 자리를 대체한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from ai_engine import AIEngine
from analysis_result import (
    AnalysisResult,
    ACTIVITY_UNKNOWN,
    STATUS_SUCCESS,
)

if TYPE_CHECKING:
    from burst_package import BurstPackage


class DummyAIEngine(AIEngine):
    name = "dummy"

    def __init__(self, **kwargs) -> None:
        self._ready = False
        self._analyzed = 0
        self._kwargs = kwargs  # 향후 엔진별 옵션 호환용(미사용)

    def initialize(self) -> None:
        self._ready = True

    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        started = datetime.now()
        # 실제 분석 없음 — 즉시 UNKNOWN 결과
        finished = datetime.now()
        self._analyzed += 1
        return AnalysisResult(
            analysis_uuid=uuid.uuid4().hex,
            burst_uuid=getattr(burst, "burst_uuid", ""),
            seat_id=getattr(burst, "seat_id", ""),
            started_at=started,
            finished_at=finished,
            processing_time=(finished - started).total_seconds() * 1000.0,
            confidence=0.0,
            status=STATUS_SUCCESS,
            activity=ACTIVITY_UNKNOWN,
            scores={},
            metadata={
                "engine": self.name,
                "frame_count": getattr(burst, "frame_count", 0),
                "note": "dummy - no real analysis",
            },
        )

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"name": self.name, "ready": self._ready, "analyzed": self._analyzed}
