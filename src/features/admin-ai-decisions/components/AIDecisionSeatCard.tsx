import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG,
  SEVERITY_CONFIG,
  confidencePercent,
  overallQuality,
  minutesSince,
  isStale,
  unknownSignalHint,
  LOW_CONFIDENCE_THRESHOLD,
  type AIDecisionRow,
} from '../types';
import type { StabilizedCandidate } from '../stabilizedTypes';
import { StabilizedCandidateBadge } from './StabilizedCandidateBadge';

interface Props {
  seatId: string;
  row: AIDecisionRow | null;
  nowMs: number;
  onOpen: (row: AIDecisionRow) => void;
  candidate?: StabilizedCandidate | null;
  onOpenCandidate?: (candidate: StabilizedCandidate) => void;
}

function AIDecisionSeatCardInner({ seatId, row, nowMs, onOpen, candidate, onOpenCandidate }: Props) {
  // 판정 없음
  if (!row) {
    return (
      <div className="flex flex-col rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-3 opacity-80">
        <span className="text-[10px] font-bold text-gray-400">{seatId}</span>
        <div className="flex flex-1 items-center justify-center py-3 min-h-[40px]">
          <p className="text-xs text-gray-300">AI 판정 없음</p>
        </div>
        {candidate && candidate.status !== 'INSUFFICIENT_DATA' && (
          <StabilizedCandidateBadge candidate={candidate} onClick={onOpenCandidate} className="mt-2" />
        )}
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
  const unknownHint = unknownSignalHint(row);

  return (
    <div className={cn('flex flex-col rounded-xl border-2 p-3', cfg.cardClass)}>
      {/* 좌석 + 상태 점 */}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500">{seatId}</span>
        <span className={cn('h-2 w-2 rounded-full', cfg.dotClass)} />
      </div>

      {/* 1층: 단발 AI 판정(최근 1개) */}
      <div className="flex flex-col items-center py-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">단발 AI</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', cfg.badgeClass)}>
          {cfg.emoji} {cfg.label}
        </span>
      </div>

      {/* confidence + severity */}
      <div className="mt-1 flex items-center justify-center gap-1 text-[11px]">
        <span className="font-semibold text-gray-700">{pct}%</span>
        <span className={cn('rounded px-1 py-0.5 font-medium', sev.badgeClass)}>{sev.label}</span>
      </div>

      {/* UNKNOWN 원인 힌트: 카메라 연결 성공 / 판정 신호 부족 구분 */}
      {unknownHint && (
        <div className="mt-1 flex justify-center">
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
            {unknownHint}
          </span>
        </div>
      )}

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

      {/* 2층: 안정화된 추정(최근 3~5개 기반) — 단발 판정과 구분해 표시 */}
      {candidate && candidate.status !== 'INSUFFICIENT_DATA' && (
        <div className="mt-2 border-t border-gray-200/70 pt-2">
          <StabilizedCandidateBadge candidate={candidate} onClick={onOpenCandidate} />
        </div>
      )}
    </div>
  );
}

export const AIDecisionSeatCard = memo(AIDecisionSeatCardInner);
