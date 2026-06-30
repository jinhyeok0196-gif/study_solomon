"""
AI Decision Repository
======================

RuleDecision 을 Supabase 의 ai_rule_decisions 테이블에 **저장/조회만** 한다.

  save_decision / get_latest_by_seat / get_recent_by_seat / health

⚠️ 이 모듈은 **저장/조회만** 한다. 학생 상태 변경/출결/벌점/알림 로직은 절대 넣지 않는다.

테스트는 실제 Supabase 연결 없이 FakeAIDecisionRepository 로 통과한다.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from decision_serializer import serialize_decision

log = logging.getLogger("ai_decision_repository")

TABLE = "ai_rule_decisions"


class RepositoryError(Exception):
    """저장/조회 실패."""


class AIDecisionRepository:
    """Supabase(service role) 기반 실제 repository."""

    def __init__(self, client: Optional[Any] = None) -> None:
        self._client = client
        self._ready = False

    def initialize(self) -> None:
        if self._client is None:
            from supabase_client import get_supabase_client   # lazy
            self._client = get_supabase_client()
        self._ready = True
        log.info("AIDecisionRepository 초기화 - table=%s", TABLE)

    def save_decision(self, decision: Any) -> Dict[str, Any]:
        """RuleDecision 직렬화 후 insert. (검증 실패/insert 실패 시 예외)"""
        row = serialize_decision(decision)          # 필수값 검증 포함
        try:
            res = self._client.table(TABLE).insert(row).execute()
        except Exception as exc:
            raise RepositoryError(f"insert 실패: {exc}") from exc
        data = getattr(res, "data", None) or []
        return {"saved": True, "decision_uuid": row["decision_uuid"],
                "row": data[0] if data else row}

    def get_latest_by_seat(self, seat_id: str) -> Optional[Dict[str, Any]]:
        try:
            res = (self._client.table(TABLE).select("*")
                   .eq("seat_id", seat_id).order("decided_at", desc=True)
                   .limit(1).execute())
        except Exception as exc:
            raise RepositoryError(f"조회 실패: {exc}") from exc
        data = getattr(res, "data", None) or []
        return data[0] if data else None

    def get_recent_by_seat(self, seat_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            res = (self._client.table(TABLE).select("*")
                   .eq("seat_id", seat_id).order("decided_at", desc=True)
                   .limit(limit).execute())
        except Exception as exc:
            raise RepositoryError(f"조회 실패: {exc}") from exc
        return list(getattr(res, "data", None) or [])

    def health(self) -> dict:
        return {"repository": "supabase", "ready": self._ready, "table": TABLE}


class FakeAIDecisionRepository:
    """테스트/데모용 in-memory repository. Supabase 연결이 전혀 필요 없다.

    실제 repository 와 동일한 인터페이스. serialize_decision 을 그대로 써서
    직렬화/검증 경로도 함께 검증한다. fail=True 면 save_decision 에서 예외.
    """

    def __init__(self, fail: bool = False) -> None:
        self._rows: List[Dict[str, Any]] = []
        self._fail = fail
        self._ready = False

    def initialize(self) -> None:
        self._ready = True

    def save_decision(self, decision: Any) -> Dict[str, Any]:
        row = serialize_decision(decision)          # 검증 포함(누락 시 예외)
        if self._fail:
            raise RepositoryError("FakeAIDecisionRepository: 강제 저장 실패(fail=True)")
        self._rows.append(row)
        return {"saved": True, "decision_uuid": row["decision_uuid"], "row": row}

    def get_latest_by_seat(self, seat_id: str) -> Optional[Dict[str, Any]]:
        rows = self._by_seat(seat_id)
        return rows[0] if rows else None

    def get_recent_by_seat(self, seat_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        return self._by_seat(seat_id)[:limit]

    def _by_seat(self, seat_id: str) -> List[Dict[str, Any]]:
        rows = [r for r in self._rows if r.get("seat_id") == seat_id]
        rows.sort(key=lambda r: r.get("decided_at") or "", reverse=True)
        return rows

    def health(self) -> dict:
        return {"repository": "fake", "ready": self._ready, "count": len(self._rows)}
