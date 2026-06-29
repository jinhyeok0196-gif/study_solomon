import { useEffect } from 'react';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useExtraStudyMutations, useOngoingExtraStudyQuery } from '@/features/extra-study/hooks';
import type { ScheduleSlot } from '@/hooks/useScheduleStatus';
import { cn } from '@/lib/utils';

interface Props {
  studentId: string;
  currentSlot: ScheduleSlot | null;
  /** 외출/파워냅 등 다른 활동 중이면 버튼을 숨긴다 */
  disabled?: boolean;
}

function fmtElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ExtraStudyCard({ studentId, currentSlot, disabled = false }: Props) {
  const now = useCurrentTime(1000);
  const { data: ongoing } = useOngoingExtraStudyQuery(studentId);
  const { start, end } = useExtraStudyMutations(studentId);

  const isClass = currentSlot?.category === 'class';

  // 중복 집계 방지: 교시(수업)가 시작되면 진행 중인 교시외공부를 자동 종료
  useEffect(() => {
    if (isClass && ongoing && !end.isPending) {
      end.mutate(ongoing.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClass, ongoing?.id]);

  // 수업 교시 중에는 이미 순공시간에 포함되므로 카드 자체를 숨긴다
  if (isClass) return null;

  const elapsedSeconds = ongoing
    ? Math.max(0, Math.floor((now.getTime() - new Date(ongoing.started_at).getTime()) / 1000))
    : 0;

  return (
    <div
      className={cn(
        'rounded-xl border-2 px-4 py-3 shadow-sm',
        ongoing ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">📖 교시외공부</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {ongoing
              ? '쉬는시간에도 공부 중! 순공시간에 합산됩니다.'
              : '쉬는시간·식사시간에 공부한다면 눌러서 순공시간에 기록하세요.'}
          </p>
        </div>
        {ongoing && (
          <span className="font-mono text-2xl font-bold tabular-nums text-green-700">
            {fmtElapsed(elapsedSeconds)}
          </span>
        )}
      </div>

      {ongoing ? (
        <button
          onClick={() => end.mutate(ongoing.id)}
          disabled={end.isPending}
          className="mt-3 w-full rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
        >
          공부 종료
        </button>
      ) : (
        <button
          onClick={() => start.mutate()}
          disabled={disabled || start.isPending}
          className="mt-3 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {disabled ? '다른 활동 중에는 시작할 수 없어요' : '교시외공부 시작'}
        </button>
      )}
    </div>
  );
}
