// =========================================================================
// Admin AI Dashboard (Read-only) — react-query 훅 + Realtime
// =========================================================================
// 조회 전용. mutation 훅은 만들지 않는다.
// =========================================================================

import { useQuery } from '@tanstack/react-query';
import {
  getLatestAIDecisionsBySeats,
  getRecentAIDecisions,
  getRecentAIDecisionsForStabilization,
  getAIDecisionById,
} from './api';
import type { AIDecisionFilters } from './types';
import { SEAT_IDS } from './types';
import { stabilizeAIDecisionsBySeat } from './stabilizer';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';

export const SEAT_DECISIONS_KEY = ['ai-decisions-by-seat'] as const;
export const RECENT_DECISIONS_KEY = ['ai-decisions-recent'] as const;
export const STABILIZED_KEY = ['ai-decisions-stabilized'] as const;

export function useLatestAIDecisionsBySeatsQuery(seatIds?: string[]) {
  return useQuery({
    queryKey: [...SEAT_DECISIONS_KEY, seatIds ?? 'all'],
    queryFn: () => getLatestAIDecisionsBySeats(seatIds),
    staleTime: 1000 * 30,
  });
}

export function useRecentAIDecisionsQuery(params: AIDecisionFilters) {
  return useQuery({
    queryKey: [...RECENT_DECISIONS_KEY, params],
    queryFn: () => getRecentAIDecisions(params),
    staleTime: 1000 * 30,
  });
}

export function useAIDecisionByIdQuery(idOrDecisionUuid: string | null) {
  return useQuery({
    queryKey: ['ai-decision-detail', idOrDecisionUuid],
    queryFn: () => getAIDecisionById(idOrDecisionUuid as string),
    enabled: !!idOrDecisionUuid,
  });
}

/**
 * 좌석별 "안정화된 AI 추정 후보"(read-derived). 최근 판정을 조회해 프론트에서 계산한다.
 * DB write 없음 — SELECT 결과를 stabilizeAIDecisionsBySeat 로 묶기만 한다.
 */
export function useStabilizedCandidatesQuery(seatIds: string[] = SEAT_IDS) {
  return useQuery({
    queryKey: [...STABILIZED_KEY, seatIds],
    queryFn: async () => {
      const rows = await getRecentAIDecisionsForStabilization(seatIds, 5);
      return stabilizeAIDecisionsBySeat(rows, seatIds);
    },
    staleTime: 1000 * 30,
  });
}

/** ai_rule_decisions INSERT(새 판정) 발생 시 좌석 카드/로그/안정화 후보 갱신. */
export function useAIDecisionsRealtime() {
  useRealtimeTableSync('ai_rule_decisions', [
    SEAT_DECISIONS_KEY, RECENT_DECISIONS_KEY, STABILIZED_KEY,
  ]);
}
