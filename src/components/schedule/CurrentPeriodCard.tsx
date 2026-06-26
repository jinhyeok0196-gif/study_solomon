import type { ScheduleStatus } from '@/hooks/useScheduleStatus';

const CATEGORY_ICON: Record<string, string> = {
  class: '📚',
  meal: '🍽',
  arrival: '🏫',
  free: '📖',
  break: '⏸',
};

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

interface Props {
  status: ScheduleStatus;
  upcomingAlert: ScheduleStatus['upcomingClassAlert'];
}

export function CurrentPeriodCard({ status, upcomingAlert }: Props) {
  const { currentSlot, nextSlot, remainingSeconds } = status;

  return (
    <div className="flex flex-col gap-2">
      {upcomingAlert && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-sm font-semibold text-blue-800">
            {upcomingAlert.minutesBefore}분 후 {upcomingAlert.slot.label}이 시작됩니다
          </p>
          <p className="text-xs text-blue-600">착석 준비해주세요.</p>
        </div>
      )}

      <div className="rounded-xl border-2 border-blue-400 bg-white px-4 py-3 shadow-sm">
        {currentSlot ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="mb-1 text-xs font-medium text-gray-500">현재 진행 중</p>
              <div className="flex items-center gap-2">
                <span className="text-lg">{CATEGORY_ICON[currentSlot.category] ?? '⏱'}</span>
                <span className="text-xl font-bold text-gray-900">{currentSlot.label}</span>
              </div>
              <p className="mt-0.5 text-sm text-gray-500">
                {fmtTime(currentSlot.startMinutes)} ~ {fmtTime(currentSlot.endMinutes)}
              </p>
            </div>
            <div className="text-right">
              <p className="mb-0.5 text-xs text-gray-400">남은 시간</p>
              <p className="text-2xl font-mono font-bold tabular-nums text-blue-600">
                {formatCountdown(remainingSeconds)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">현재 진행 중인 일정이 없습니다.</p>
        )}

        {nextSlot && (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="mb-1 text-xs text-gray-400">다음 일정</p>
            <div className="flex items-center gap-2">
              <span>{CATEGORY_ICON[nextSlot.category] ?? '⏱'}</span>
              <span className="text-sm font-medium text-gray-700">{nextSlot.label}</span>
              <span className="text-xs text-gray-400">
                {fmtTime(nextSlot.startMinutes)} ~ {fmtTime(nextSlot.endMinutes)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
