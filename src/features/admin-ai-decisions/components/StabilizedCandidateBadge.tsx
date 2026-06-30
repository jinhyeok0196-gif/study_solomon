import { cn } from '@/lib/utils';
import { confidencePercent } from '../types';
import { STABILIZED_STATUS_LABEL, type StabilizedCandidate } from '../stabilizedTypes';
import { getCandidateLabel, getCandidateBadgeClass } from '../stabilizer';

interface Props {
  candidate: StabilizedCandidate;
  onClick?: (candidate: StabilizedCandidate) => void;
  className?: string;
}

/**
 * "안정화된 추정" 뱃지(읽기 전용). 절대 "확정" 이라 표현하지 않는다.
 *  예) 안정화된 추정: 휴대폰 추정 78% · 안정 · 최근 5개 중 3회
 *      안정화된 추정: 판정 보류 · 충돌
 *      안정화된 추정: 데이터 부족
 */
export function StabilizedCandidateBadge({ candidate, onClick, className }: Props) {
  const label = getCandidateLabel(candidate);
  const badgeClass = getCandidateBadgeClass(candidate);
  const isStable = candidate.status === 'STABLE';
  const pct = confidencePercent(candidate.confidence);
  const topCount = isStable ? (candidate.activity_counts[candidate.activity] ?? 0) : 0;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button', onClick: () => onClick(candidate) } : {})}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-md border border-gray-100 bg-white/60 px-2 py-1 text-left',
        onClick && 'hover:bg-white',
        className
      )}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
        안정화된 추정
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', badgeClass)}>
          {label}
          {isStable && ` ${pct}%`}
        </span>
        {/* STABLE 일 때만 상태 칩 표시(비안정은 label 자체가 상태라 중복 방지) */}
        {isStable && (
          <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500">
            {STABILIZED_STATUS_LABEL[candidate.status]}
          </span>
        )}
      </span>
      {isStable ? (
        <span className="text-[10px] text-gray-400">
          최근 {candidate.decision_count}개 중 {topCount}회
        </span>
      ) : (
        <span className="text-[10px] text-gray-400">관리자 확인 필요</span>
      )}
    </Wrapper>
  );
}
