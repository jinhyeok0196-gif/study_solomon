"""
RuleDecision
============

Rule Engine 이 SeatFacts 를 보고 내린 **1차 판정 결과**.

이번 단계(v0.1)에서 처음으로 activity 가 UNKNOWN 이 아닌 값이 나올 수 있다.
단, 이것은 **판정 결과 데이터일 뿐** — 저장/표시/학생 상태 변경/알림은 하지 않는다.

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class RuleDecision:
    decision_uuid: str
    facts_uuid: Optional[str]
    burst_uuid: Optional[str]
    seat_id: Optional[str]
    period_id: Optional[str]
    period_name: Optional[str]
    decided_at: datetime

    activity: str                    # STUDYING / PHONE / SLEEPING / ABSENT / UNKNOWN
    confidence: float                # 0.0 ~ 1.0
    status: str                      # SUCCESS / SKIPPED / FAILED / LOW_CONFIDENCE
    severity: str                    # INFO / WATCH / WARNING / CRITICAL

    reasons: List[str] = field(default_factory=list)     # 사람이 읽는 판정 이유
    evidence: Dict[str, Any] = field(default_factory=dict)  # 판정에 쓴 주요 SeatFacts 값
    rule_hits: List[Dict[str, Any]] = field(default_factory=list)  # 발동/평가된 규칙
    quality: Dict[str, Any] = field(default_factory=dict)   # SeatFacts.quality 복사

    metadata: Dict[str, Any] = field(default_factory=dict)  # trace, engine version, thresholds

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        return {
            "decision_uuid": self.decision_uuid,
            "facts_uuid": self.facts_uuid,
            "seat_id": self.seat_id,
            "activity": self.activity,
            "confidence": self.confidence,
            "status": self.status,
            "severity": self.severity,
            "reasons": list(self.reasons),
            "rule_hits": list(self.rule_hits),
        }
