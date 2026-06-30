"""
AIManager
=========

현재 사용할 AI Engine 을 관리한다(로드/언로드/리로드/분석/상태).
엔진은 Engine Registry 를 통해 이름으로 생성되며, 동일 인터페이스(AIEngine)라
어떤 엔진이든 교체 가능하다(현재는 DummyAIEngine 만 등록).

AI Pipeline:
  BurstPackage → AIManager.analyze() → AIEngine.analyze() → AnalysisResult
                                                              → (향후 Rule Engine)
  * 이번 단계는 Rule Engine 을 호출하지 않는다.

AIManager.analyze 는 시그니처가 `(burst) -> AnalysisResult` 이므로,
OrchestratorEngine 의 burst_consumer 콜백으로 그대로 꽂을 수 있다(Orchestrator 무수정).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING

import engine_registry
from ai_engine import AIEngine
from analysis_result import (
    AnalysisResult,
    ACTIVITY_UNKNOWN,
    STATUS_FAILED,
    STATUS_SKIPPED,
)

if TYPE_CHECKING:
    from burst_package import BurstPackage

log = logging.getLogger("ai_manager")


class AIManager:
    def __init__(self, engine_name: Optional[str] = None, **engine_kwargs) -> None:
        self._engine: Optional[AIEngine] = None
        self._engine_name: Optional[str] = None
        self._engine_kwargs: dict = {}
        self._analyzed = 0
        if engine_name:
            self.load_engine(engine_name, **engine_kwargs)

    # ----------------------------------------------------------- lifecycle
    def load_engine(self, name: str, **kwargs) -> AIEngine:
        """이름으로 엔진을 생성·초기화하고 현재 엔진으로 설정한다(기존 엔진은 언로드)."""
        if self._engine is not None:
            self.unload_engine()
        engine = engine_registry.create_engine(name, **kwargs)
        engine.initialize()
        self._engine = engine
        self._engine_name = name
        self._engine_kwargs = dict(kwargs)
        log.info("엔진 로드: %s", name)
        return engine

    def unload_engine(self) -> None:
        if self._engine is None:
            return
        try:
            self._engine.shutdown()
        except Exception as exc:
            log.exception("엔진 shutdown 예외: %s", exc)
        log.info("엔진 언로드: %s", self._engine_name)
        self._engine = None
        self._engine_name = None

    def reload(self) -> Optional[AIEngine]:
        """현재 엔진을 같은 이름/옵션으로 다시 로드한다."""
        if self._engine_name is None:
            log.warning("reload: 로드된 엔진이 없습니다.")
            return None
        name, kwargs = self._engine_name, dict(self._engine_kwargs)
        return self.load_engine(name, **kwargs)

    # ------------------------------------------------------------- analyze
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        """BurstPackage 를 현재 엔진으로 분석한다. 엔진 없음/예외는 결과 status 로 표현."""
        if self._engine is None:
            return self._fallback_result(burst, STATUS_SKIPPED, "no_engine")
        try:
            result = self._engine.analyze(burst)
            self._analyzed += 1
            return result
        except Exception as exc:
            log.exception("분석 예외(seat=%s): %s", getattr(burst, "seat_id", "?"), exc)
            return self._fallback_result(burst, STATUS_FAILED, str(exc))

    def _fallback_result(self, burst: "BurstPackage", status: str, reason: str) -> AnalysisResult:
        now = datetime.now()
        return AnalysisResult(
            analysis_uuid=uuid.uuid4().hex,
            burst_uuid=getattr(burst, "burst_uuid", ""),
            seat_id=getattr(burst, "seat_id", ""),
            started_at=now,
            finished_at=now,
            processing_time=0.0,
            confidence=0.0,
            status=status,
            activity=ACTIVITY_UNKNOWN,
            scores={},
            metadata={"engine": self._engine_name, "reason": reason},
        )

    # -------------------------------------------------------------- status
    def health(self) -> dict:
        return {
            "loaded": self._engine is not None,
            "engine": self._engine_name,
            "analyzed": self._analyzed,
            "available": engine_registry.available_engines(),
            "engine_health": self._engine.health() if self._engine else None,
        }
