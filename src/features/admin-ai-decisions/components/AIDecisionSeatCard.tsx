import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG,
  SEVERITY_CONFIG,
  confidencePercent,
  overallQuality,
  minutesSince,
  isStale,
  LOW_CONFIDENCE_THRESHOLD,
  type AIDecisionRow,
} from '../types';

interface Props {
  seatId: string;
  row: AIDecisionRow | null;
  nowMs: number;
  onOpen: (row: AIDecisionRow) => void;
}

function AIDecisionSeatCardInner({ seatId, row, nowMs, onOpen }: Props) {
  // 판정 없음
  if (!row) {
    return (
      <div className="flex flex-col rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-3 opacity-80">
        <span className="text-[10px] font-bold text-gray-400">{seatId}</span>
        <div className="flex flex-1 items-center justify-center py-3 min-h-[40px]">
          <p className="text-xs text-gray-300">AI 판정 없음</p>
        </div>
      </div>
    );
  }

  const cfg = ACTIVITY_CONFIG[row.activity];
  const sev = SEVERITY_CONFIG[row.severity];
  const pct = confidencePercent(row.confidence);
  const quality = overallQuality(row);
  const stale = isStale(row.decided_at, nowMs);
  const lowConf = (row.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD;
  const topReason = row.reasons?.[0];

  return (
    <div className={cn('flex flex-col rounded-xl border-2 p-3', cfg.cardClass)}>
      {/* 좌석 + 상태 점 */}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500">{seatId}</span>
        <span className={cn('h-2 w-2 rounded-full', cfg.dotClass)} />
      </div>

      {/* activity 뱃지 */}
      <div className="flex items-center justify-center py-1">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', cfg.badgeClass)}>
          {cfg.emoji} {cfg.label}
        </span>
      </div>

      {/* confidence + severity */}
      <div className="mt-1 flex items-center justify-center gap-1 text-[11px]">
        <span className="font-semibold text-gray-700">{pct}%</span>
        <span className={cn('rounded px-1 py-0.5 font-medium', sev.badgeClass)}>{sev.label}</span>
      </div>

      {/* 경고 플래그 */}
      {(stale || lowConf) && (
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {stale && (
            <span className="rounded bg-gray-200 px-1 text-[10px] text-gray-500">오래됨</span>
          )}
          {lowConf && (
            <span className="rounded bg-yellow-100 px-1 text-[10px] text-yellow-700">신뢰 낮음</span>
          )}
        </div>
      )}

      {/* 주요 reason */}
      {topReason && (
        <p className="mt-1 line-clamp-2 text-center text-[10px] text-gray-500">{topReason}</p>
      )}

      {/* 시각 + 품질 */}
      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
        <span>{minutesSince(row.decided_at, nowMs)}분 전</span>
        {quality !== null && <span>품질 {Math.round(quality * 100)}%</span>}
      </div>

      {/* AI 추정 표시 + 상세 */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] text-gray-400">AI 추정 · 자동 변경 아님</span>
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="rounded-md bg-white/70 px-2 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-white"
        >
          상세
        </button>
      </div>
    </div>
  );
}

export const AIDecisionSeatCard = memo(AIDecisionSeatCardInner);
