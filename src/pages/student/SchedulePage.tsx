import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getWeekStartDate, formatWeekRangeLabel } from '@/features/schedule/dates';
import { useSaveWeeklyScheduleMutation, useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { WeeklyScheduleGrid } from '@/features/schedule/components/WeeklyScheduleGrid';
import { cellKey, type ScheduleCell } from '@/features/schedule/types';
import type { DayOfWeek } from '@/constants/periods';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';

const WEEK_OPTIONS = [
  { offset: 0, label: '이번주' },
  { offset: 1, label: '다음주' },
];

export default function SchedulePage() {
  const { user } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const weekStartDate = getWeekStartDate(weekOffset);
  const { data, isLoading } = useWeeklyScheduleQuery(user!.id, weekStartDate);
  const saveMutation = useSaveWeeklyScheduleMutation(user!.id, weekStartDate);

  useEffect(() => {
    setSelected(new Set((data?.cells ?? []).map((cell) => cellKey(cell.dayOfWeek, cell.periodNumber))));
    setMessage(null);
  }, [data]);

  const toggleCell = (dayOfWeek: DayOfWeek, periodNumber: number) => {
    const key = cellKey(dayOfWeek, periodNumber);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectedCells: ScheduleCell[] = Array.from(selected).map((key) => {
    const [dayOfWeek, periodNumber] = key.split('-');
    return { dayOfWeek: dayOfWeek as DayOfWeek, periodNumber: Number(periodNumber) as ScheduleCell['periodNumber'] };
  });

  const handleSave = async (submit: boolean) => {
    setMessage(null);
    await saveMutation.mutateAsync({ cells: selectedCells, submit });
    setMessage(submit ? '시간표를 제출했습니다.' : '임시 저장했습니다.');
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">주간 시간표 제출</h2>
        <Badge tone={data?.schedule?.status === 'submitted' ? 'success' : 'default'}>
          {data?.schedule?.status === 'submitted' ? '제출 완료' : '작성 중'}
        </Badge>
      </div>

      <div className="flex gap-2">
        {WEEK_OPTIONS.map((option) => (
          <Button
            key={option.offset}
            variant={weekOffset === option.offset ? 'primary' : 'secondary'}
            onClick={() => setWeekOffset(option.offset)}
          >
            {option.label}
          </Button>
        ))}
        <span className="flex items-center text-sm text-gray-500">
          {formatWeekRangeLabel(weekStartDate)}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <WeeklyScheduleGrid selected={selected} onToggle={toggleCell} />
      )}

      {message && <p className="text-sm text-brand-700">{message}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" disabled={saveMutation.isPending} onClick={() => handleSave(false)}>
          저장
        </Button>
        <Button disabled={saveMutation.isPending} onClick={() => handleSave(true)}>
          제출
        </Button>
      </div>
    </div>
  );
}
