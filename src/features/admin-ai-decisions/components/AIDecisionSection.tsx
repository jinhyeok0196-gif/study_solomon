import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/Spinner';
import {
  useLatestAIDecisionsBySeatsQuery,
  useRecentAIDecisionsQuery,
  useAIDecisionsRealtime,
  SEAT_DECISIONS_KEY,
  RECENT_DECISIONS_KEY,
} from '../hooks';
import { AI_DISCLAIMER, SEAT_IDS, type AIDecisionRow, type AIDecisionFilters } from '../types';
import { AIDecisionSeatGrid } from './AIDecisionSeatGrid';
import { AIDecisionLogTable } from './AIDecisionLogTable';
import { AIDecisionDetailDrawer } from './AIDecisionDetailDrawer';

/**
 * 관리자 대시보드 "AI 판정 현황" 섹션(읽기 전용).
 * 1) 안내 배너  2) 좌석별 최신 판정 카드  3) 최근 판정 로그 + 상세 Drawer
 * ⚠️ 학생 상태/출결/벌점/알림을 절대 변경하지 않는다.
 */
export function AIDecisionSection() {
  const [filters, setFilters] = useState<AIDecisionFilters>({ limit: 50 });
  const [selected, setSelected] = useState<AIDecisionRow | null>(null);

  const qc = useQueryClient();
  useAIDecisionsRealtime();

  const seatQuery = useLatestAIDecisionsBySeatsQuery(SEAT_IDS);
  const logQuery = useRecentAIDecisionsQuery(filters);

  const nowMs = Date.now();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: SEAT_DECISIONS_KEY });
    qc.invalidateQueries({ queryKey: RECENT_DECISIONS_KEY });
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">AI 판정 현황</h3>
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          새로고침
        </button>
      </div>

      {/* 안내 배너 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠️ {AI_DISCLAIMER}
      </div>

      {/* 좌석별 최신 판정 카드 */}
      <div>
        {seatQuery.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <AIDecisionSeatGrid
            rows={seatQuery.data ?? []}
            nowMs={nowMs}
            onOpen={setSelected}
          />
        )}
      </div>

      {/* 최근 판정 로그 */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-gray-500">최근 AI 판정 로그</h4>
        {logQuery.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <AIDecisionLogTable
            rows={logQuery.data ?? []}
            filters={filters}
            onFiltersChange={setFilters}
            onOpen={setSelected}
          />
        )}
      </div>

      {/* 상세 Drawer */}
      <AIDecisionDetailDrawer row={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
