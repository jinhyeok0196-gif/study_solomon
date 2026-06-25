import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { formatWeekRangeLabel, getWeekStartDate, listRecentWeekStartDates } from '@/features/schedule/dates';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { WeeklyScheduleGrid } from '@/features/schedule/components/WeeklyScheduleGrid';
import { cellKey } from '@/features/schedule/types';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

const PAST_WEEKS_COUNT = 8;

export default function ScheduleHistoryPage() {
  const { user } = useAuth();
  const weekOptions = [
    { value: getWeekStartDate(1), label: '다음주' },
    { value: getWeekStartDate(0), label: '이번주' },
    ...listRecentWeekStartDates(PAST_WEEKS_COUNT)
      .slice(1)
      .map((value) => ({ value, label: formatWeekRangeLabel(value) })),
  ];

  const [weekStartDate, setWeekStartDate] = useState(weekOptions[1].value);
  const { data, isLoading } = useWeeklyScheduleQuery(user!.id, weekStartDate);

  const selected = new Set((data?.cells ?? []).map((cell) => cellKey(cell.dayOfWeek, cell.periodNumber)));

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold text-gray-900">내 시간표 조회</h2>

      <select
        value={weekStartDate}
        onChange={(event) => setWeekStartDate(event.target.value)}
        className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
      >
        {weekOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({formatWeekRangeLabel(option.value)})
          </option>
        ))}
      </select>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !data?.schedule ? (
        <EmptyState title="제출된 시간표가 없습니다" description="선택한 주에 제출한 시간표가 없습니다." />
      ) : (
        <>
          <Badge tone={data.schedule.status === 'submitted' ? 'success' : 'default'}>
            {data.schedule.status === 'submitted' ? '제출 완료' : '작성 중(미제출)'}
          </Badge>
          <WeeklyScheduleGrid selected={selected} readOnly />
        </>
      )}
    </div>
  );
}
