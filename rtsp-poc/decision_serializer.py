"""
Decision Serializer
===================

RuleDecision → Supabase(JSONB) 저장 가능한 dict 로 변환한다.

  - datetime 은 ISO 문자열로 변환.
  - reasons/evidence/rule_hits/quality/metadata 는 JSONB 저장 가능한 형태로 정리.
  - 필수값(decision_uuid/seat_id/activity/status/severity/decided_at)을 검증한다.
    검증 실패 시 저장하지 않고 명확한 에러(DecisionValidationError)를 던진다.

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 변환).
"""

from __future__ import annotations

from typing import Any, Dict

# 저장 전 반드시 존재해야 하는 필드
REQUIRED_FIELDS = ("decision_uuid", "seat_id", "activity", "status", "severity", "decided_at")


class DecisionValidationError(ValueError):
    """RuleDecision 필수값 누락 등 직렬화 검증 실패."""


def _iso(dt: Any) -> Any:
    """datetime → ISO 문자열. 이미 문자열이면 그대로."""
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


def _num(v: Any):
    """confidence 등 숫자 → float(없으면 None)."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def serialize_decision(decision: Any) -> Dict[str, Any]:
    """RuleDecision → 저장용 dict. 필수값 누락 시 DecisionValidationError."""
    missing = []
    for f in REQUIRED_FIELDS:
        v = getattr(decision, f, None)
        if v is None or (isinstance(v, str) and not v.strip()):
            missing.append(f)
    if missing:
        raise DecisionValidationError(f"RuleDecision 필수값 누락: {missing}")

    return {
        "decision_uuid": decision.decision_uuid,
        "facts_uuid": getattr(decision, "facts_uuid", None),
        "burst_uuid": getattr(decision, "burst_uuid", None),
        "seat_id": decision.seat_id,
        "period_id": getattr(decision, "period_id", None),
        "period_name": getattr(decision, "period_name", None),
        "decided_at": _iso(decision.decided_at),
        "activity": decision.activity,
        "confidence": _num(getattr(decision, "confidence", None)),
        "status": decision.status,
        "severity": decision.severity,
        "reasons": list(getattr(decision, "reasons", []) or []),
        "evidence": dict(getattr(decision, "evidence", {}) or {}),
        "rule_hits": list(getattr(decision, "rule_hits", []) or []),
        "quality": dict(getattr(decision, "quality", {}) or {}),
        "metadata": dict(getattr(decision, "metadata", {}) or {}),
    }
