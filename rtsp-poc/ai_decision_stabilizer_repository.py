"""
AI Decision Stabilizer Repository (조회 보조)
============================================

ai_rule_decisions 에서 **최근 판정을 조회**해 DecisionStabilizer 에 넘기는 보조 함수.

⚠️ SELECT 만 한다. insert/update/delete 없음(기존 AIDecisionRepository 재사용).
   안정화는 "후보" 를 만들 뿐 학생 상태/출결/벌점/알림을 바꾸지 않는다.
"""

from __future__ import annotations

from typing import Any, Dict, List


def get_recent_decisions_for_stabilization(repository: Any, seat_id: str,
                                           limit: int = 5) -> List[Dict[str, Any]]:
    """한 좌석의 최근 판정 row dict 목록(최신순). repository 는 get_recent_by_seat 제공."""
    return list(repository.get_recent_by_seat(seat_id, limit=limit) or [])


def get_recent_decisions_for_all_seats(repository: Any, seat_ids: List[str],
                                       limit_per_seat: int = 5) -> Dict[str, List[Dict[str, Any]]]:
    """여러 좌석의 최근 판정을 좌석별 dict 로. stabilize_by_seat 입력 형태."""
    return {
        seat: list(repository.get_recent_by_seat(seat, limit=limit_per_seat) or [])
        for seat in (seat_ids or [])
    }
