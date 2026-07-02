import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/Spinner';
import {
  useLatestAIDecisionsBySeatsQuery,
  useRecentAIDecisionsQuery,
  useStabilizedCandidatesQuery,
  useAIDecisionsRealtime,
  SEAT_DECISIONS_KEY,
  RECENT_DECISIONS_KEY,
  STABILIZED_KEY,
} from '../hooks';
import { AI_DISCLAIMER, SEAT_IDS, type AIDecisionRow, type AIDecisionFilters } from '../types';
import type { StabilizedCandidate } from '../stabilizedTypes';
import { PREVIEW_REFETCH_INTERVAL_MS } from '../previewTypes';
import { AIDecisionSeatGrid } from './AIDecisionSeatGrid';
import { AIDecisionLogTable } from './AIDecisionLogTable';
import { AIDecisionDetailDrawer } from './AIDecisionDetailDrawer';
import { StabilizedCandidatePanel } from './StabilizedCandidatePanel';
import { StabilizedCandidateDetail } from './StabilizedCandidateDetail';

/**
 * 관리자 대시보드 "AI 판정 현황" 섹션(읽기 전용).
 * 1) 안내 배너  2) 좌석 카드(단발 AI + 안정화된 추정 2층)  3) 안정화 후보 패널
 * 4) 최근 판정 로그 + 상세 Drawer
 * ⚠️ 학생 상태/출결/벌점/알림을 절대 변경하지 않는다. StabilizedCandidate 는 DB 에 저장하지 않는다.
 */
export function AIDecisionSection() {
  const [filters, setFilters] = useState<AIDecisionFilters>({ limit: 50 });
  const [selectedRow, setSelectedRow] = useState<AIDecisionRow | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<StabilizedCandidate | null>(null);

  const qc = useQueryClient();
  useAIDecisionsRealtime();

  const seatQuery = useLatestAIDecisionsBySeatsQuery(SEAT_IDS);
  const stabilizedQuery = useStabilizedCandidatesQuery(SEAT_IDS);
  const logQuery = useRecentAIDecisionsQuery(filters);

  // preview 만료/재생성이 화면에 자연스럽게 반영되도록 주기적으로 now 를 갱신한다.
  // (Date.now() 를 렌더 1회만 읽으면 available→expired 전이가 리렌더 전까지 멈춘다)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), PREVIEW_REFETCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: SEAT_DECISIONS_KEY });
    qc.invalidateQueries({ queryKey: RECENT_DECISIONS_KEY });
    qc.invalidateQueries({ queryKey: STABILIZED_KEY });
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
        ⚠️ {AI_DISCLAIMER} <span className="text-amber-600">단발 AI 판정과 "안정화된 추정"은 모두 보조 지표이며, STABLE 도 확정이 아닙니다.</span>
      </div>

      {/* 좌석 카드(단발 AI + 안정화된 추정) */}
      <div>
        {seatQuery.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <AIDecisionSeatGrid
            rows={seatQuery.data ?? []}
            nowMs={nowMs}
            onOpen={setSelectedRow}
            candidatesBySeat={stabilizedQuery.data ?? {}}
            onOpenCandidate={setSelectedCandidate}
          />
        )}
      </div>

      {/* 안정화 후보 요약 패널 */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-gray-500">안정화된 추정 후보 (최근 3~5개 기반 · 관리자 확인 필요)</h4>
        {stabilizedQuery.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (
          <StabilizedCandidatePanel
            candidatesBySeat={stabilizedQuery.data ?? {}}
            onOpen={setSelectedCandidate}
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
            onOpen={setSelectedRow}
          />
        )}
      </div>

      {/* 상세 Drawer */}
      <AIDecisionDetailDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
      <StabilizedCandidateDetail candidate={selectedCandidate} onClose={() => setSelectedCandidate(null)} />
    </section>
  );
}
