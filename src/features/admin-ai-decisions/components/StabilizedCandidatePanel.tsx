import { cn } from '@/lib/utils';
import { confidencePercent, SEAT_IDS } from '../types';
import { STABILIZED_STATUS_LABEL, type StabilizedCandidate } from '../stabilizedTypes';
import { getCandidateLabel, getCandidateBadgeClass } from '../stabilizer';

interface Props {
  candidatesBySeat: Record<string, StabilizedCandidate>;
  seatIds?: string[];
  onOpen: (candidate: StabilizedCandidate) => void;
}

/** 좌석별 "안정화된 추정 후보" 요약 패널(읽기 전용). */
export function StabilizedCandidatePanel({ candidatesBySeat, seatIds = SEAT_IDS, onOpen }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">좌석</th>
            <th className="px-2 py-1.5 font-medium">안정화 후보</th>
            <th className="px-2 py-1.5 font-medium">상태</th>
            <th className="px-2 py-1.5 font-medium">신뢰</th>
            <th className="px-2 py-1.5 font-medium">판정수</th>
            <th className="px-2 py-1.5 font-medium">이유</th>
            <th className="px-2 py-1.5 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {seatIds.map((seatId) => {
            const c = candidatesBySeat[seatId];
            if (!c) {
              return (
                <tr key={seatId}>
                  <td className="px-2 py-1.5 font-medium text-gray-700">{seatId}</td>
                  <td className="px-2 py-1.5 text-gray-300" colSpan={6}>안정화 데이터 없음</td>
                </tr>
              );
            }
            const isStable = c.status === 'STABLE';
            return (
              <tr key={seatId} className="hover:bg-gray-50">
                <td className="px-2 py-1.5 font-medium text-gray-700">{seatId}</td>
                <td className="px-2 py-1.5">
                  <span className={cn('rounded px-1.5 py-0.5 font-medium', getCandidateBadgeClass(c))}>
                    {getCandidateLabel(c)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-gray-500">{STABILIZED_STATUS_LABEL[c.status]}</td>
                <td className="px-2 py-1.5 text-gray-700">{isStable ? `${confidencePercent(c.confidence)}%` : '-'}</td>
                <td className="px-2 py-1.5 text-gray-500">{c.decision_count}</td>
                <td className="max-w-[220px] truncate px-2 py-1.5 text-gray-500">{c.reasons?.[0] ?? '-'}</td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => onOpen(c)}
                    className="rounded-md px-2 py-0.5 font-medium text-brand-600 hover:bg-brand-50"
                  >
                    상세
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
