"""
AI Decision Storage Pipeline
============================

  SeatFacts → RuleEngine.decide() → RuleDecision → AI Decision Repository 저장

⚠️ 이 파이프라인은 **저장까지만** 한다.
    Dashboard 표시 / 학생 상태 변경 / 알림 / 벌점 / 출결 처리는 절대 하지 않는다.

process(seat_facts) 반환:
  {"success": bool, "decision_uuid": str, "activity": str, "saved": bool, "error": None|str}

  - save_enabled=False 이거나 repository 가 없으면: 판정만 하고 saved=False(success=True).
  - 저장 시도 중 실패하면: success=False, saved=False, error 메시지.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from rule_engine import RuleEngine

log = logging.getLogger("ai_decision_storage_pipeline")


class AIDecisionStoragePipeline:
    def __init__(self, rule_engine: Optional[Any] = None,
                 repository: Optional[Any] = None,
                 save_enabled: bool = True) -> None:
        self.rule_engine = rule_engine or RuleEngine()
        self.repository = repository
        self.save_enabled = save_enabled
        self._ready = False

    def initialize(self) -> None:
        self.rule_engine.initialize()
        if self.save_enabled and self.repository is not None:
            self.repository.initialize()
        self._ready = True

    def process(self, seat_facts: Any) -> Dict[str, Any]:
        decision = self.rule_engine.decide(seat_facts)
        result = {
            "success": True,
            "decision_uuid": decision.decision_uuid,
            "activity": decision.activity,
            "saved": False,
            "error": None,
        }

        # 저장 비활성 또는 repository 없음 → 판정만(저장 생략)
        if not self.save_enabled or self.repository is None:
            return result

        try:
            self.repository.save_decision(decision)
            result["saved"] = True
        except Exception as exc:                    # 저장 실패 → success False
            result["success"] = False
            result["error"] = f"{type(exc).__name__}: {exc}"
            log.exception("RuleDecision 저장 실패")
        return result

    def health(self) -> dict:
        return {"pipeline": "ai_decision_storage", "ready": self._ready,
                "save_enabled": self.save_enabled,
                "repository": self.repository.health()
                if self.repository is not None and hasattr(self.repository, "health") else None}
