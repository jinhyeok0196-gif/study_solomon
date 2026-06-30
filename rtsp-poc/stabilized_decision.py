"""
StabilizedDecision
==================

최근 여러 개의 RuleDecision 을 묶어 계산한 **좌석별 "안정화된 AI 상태 후보"**.

⚠️ 매우 중요:
  - StabilizedDecision 은 **실제 학생 상태가 아니다.** "안정화된 AI 후보" 일 뿐이다.
  - 학생 상태 변경 / 출결 / 벌점 / 알림은 절대 하지 않는다(관리자 참고용 후보).

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

# 안정화 상태
STAB_STABLE = "STABLE"                 # 한 activity 가 충분히 우세
STAB_UNSTABLE = "UNSTABLE"             # 신호가 섞여 우세하지 않음
STAB_INSUFFICIENT = "INSUFFICIENT_DATA"  # 판정 개수 부족
STAB_LOW_CONFIDENCE = "LOW_CONFIDENCE"   # 평균 신뢰도/품질 부족
STAB_CONFLICTED = "CONFLICTED"         # 상위 두 activity 가 충돌


@dataclass
class StabilizedDecision:
    stabilized_uuid: str
    seat_id: str
    activity: str                      # STUDYING/PHONE/SLEEPING/ABSENT/UNKNOWN
    confidence: float                  # 0.0~1.0
    status: str                        # STABLE/UNSTABLE/INSUFFICIENT_DATA/LOW_CONFIDENCE/CONFLICTED
    severity: str                      # INFO/WATCH/WARNING/CRITICAL

    window_size: int                   # 설정상 윈도우 용량(max_decisions)
    decision_count: int                # 실제로 사용한 판정 수
    decided_from: Optional[str]        # 윈도우 내 가장 이른 decided_at(ISO)
    decided_to: Optional[str]          # 윈도우 내 가장 늦은 decided_at(ISO)
    generated_at: datetime

    activity_counts: Dict[str, int] = field(default_factory=dict)
    confidence_by_activity: Dict[str, float] = field(default_factory=dict)
    source_decision_uuids: List[str] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    evidence: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        return {
            "stabilized_uuid": self.stabilized_uuid,
            "seat_id": self.seat_id,
            "activity": self.activity,
            "confidence": self.confidence,
            "status": self.status,
            "severity": self.severity,
            "decision_count": self.decision_count,
            "activity_counts": dict(self.activity_counts),
            "reasons": list(self.reasons),
            "source_decision_uuids": list(self.source_decision_uuids),
        }
