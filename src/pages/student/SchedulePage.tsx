import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePeriods } from '@/hooks/usePeriods';
import { getWeekStartDate, formatWeekRangeLabel } from '@/features/schedule/dates';
import {
  useSaveWeeklyScheduleMutation,
  useWeeklyScheduleQuery,
  usePendingScheduleUnlockQuery,
  useRequestScheduleUnlockMutation,
} from '@/features/schedule/hooks';
import { WeeklyScheduleGrid } from '@/features/schedule/components/WeeklyScheduleGrid';
import { cellKey, type ScheduleCell } from '@/features/schedule/types';
import { DAYS_OF_WEEK, type DayOfWeek } from '@/constants/periods';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';

const WEEK_OPTIONS = [
  { offset: 0, label: '이번주' },
  { offset: 1, label: '다음주' },
];

const WEEKDAY_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_DAYS: DayOfWeek[] = ['sat', 'sun'];

export default function SchedulePage() {
  const { user } = useAuth();
  const { data: periods } = usePeriods();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  const weekStartDate = getWeekStartDate(weekOffset);
  const { data, isLoading } = useWeeklyScheduleQuery(user!.id, weekStartDate);
  const saveMutation = useSaveWeeklyScheduleMutation(user!.id, weekStartDate);
  const { data: hasPendingUnlock } = usePendingScheduleUnlockQuery(user!.id, weekStartDate);
  const requestUnlockMutation = useRequestScheduleUnlockMutation(user!.id, weekStartDate);

  useEffect(() => {
    setSelected(new Set((data?.cells ?? []).map((cell) => cellKey(cell.dayOfWeek, cell.periodNumber))));
    setMessage(null);
  }, [data]);

  const isLocked = data?.schedule?.status === 'submitted';

  const handleCellChange = (dayOfWeek: DayOfWeek, periodNumber: number, sel: boolean) => {
    const key = cellKey(dayOfWeek, periodNumber);
    setSelected((prev) => {
      const next = new Set(prev);
      if (sel) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleSelectAll = () => {
    const next = new Set<string>();
    for (const p of periods ?? []) {
      for (const d of DAYS_OF_WEEK) next.add(cellKey(d, p.period_number));
    }
    setSelected(next);
  };

  const handleClearAll = () => setSelected(new Set());

  const handleSelectWeekdays = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of periods ?? []) {
        for (const d of WEEKDAY_DAYS) next.add(cellKey(d, p.period_number));
        for (const d of WEEKEND_DAYS) next.delete(cellKey(d, p.period_number));
      }
      return next;
    });
  };

  const handleSelectWeekend = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of periods ?? []) {
        for (const d of WEEKEND_DAYS) next.add(cellKey(d, p.period_number));
        for (const d of WEEKDAY_DAYS) next.delete(cellKey(d, p.period_number));
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

  const handleRequestUnlock = async () => {
    if (!unlockReason.trim()) return;
    await requestUnlockMutation.mutateAsync(unlockReason.trim());
    setShowUnlockModal(false);
    setUnlockReason('');
    setMessage('수정 권한 요청을 보냈습니다. 관리자 승인 후 수정할 수 있습니다.');
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">주간 시간표 제출</h2>
        <Badge tone={isLocked ? 'success' : 'default'}>
          {isLocked ? '제출 완료 (잠금)' : data?.schedule?.status === 'draft' ? '작성 중' : '미작성'}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
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
        <>
          {!isLocked && (
            <div className="flex flex-wrap gap-1">
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={handleSelectAll}>
                전체 선택
              </Button>
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={handleClearAll}>
                전체 해제
              </Button>
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={handleSelectWeekdays}>
                평일만
              </Button>
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={handleSelectWeekend}>
                주말만
              </Button>
            </div>
          )}

          <WeeklyScheduleGrid
            selected={selected}
            onCellChange={handleCellChange}
            readOnly={isLocked}
          />

          {isLocked ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-gray-500">
                제출된 시간표는 잠금 상태입니다. 수정하려면 관리자 승인이 필요합니다.
              </p>
              {hasPendingUnlock ? (
                <Badge tone="warning">수정 권한 요청 대기 중</Badge>
              ) : (
                <Button variant="secondary" onClick={() => setShowUnlockModal(true)}>
                  수정 권한 요청
                </Button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={saveMutation.isPending} onClick={() => handleSave(false)}>
                저장
              </Button>
              <Button disabled={saveMutation.isPending} onClick={() => handleSave(true)}>
                제출
              </Button>
            </div>
          )}
        </>
      )}

      {message && <p className="text-sm text-brand-700">{message}</p>}

      <Modal
        open={showUnlockModal}
        onClose={() => { setShowUnlockModal(false); setUnlockReason(''); }}
        title="시간표 수정 권한 요청"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            수정 사유를 입력하면 관리자에게 요청이 전달됩니다.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700" htmlFor="unlock-reason">
              수정 사유 <span className="text-red-500">*</span>
            </label>
            <textarea
              id="unlock-reason"
              rows={3}
              placeholder="시간표를 수정해야 하는 사유를 입력해주세요"
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => { setShowUnlockModal(false); setUnlockReason(''); }}
            >
              취소
            </Button>
            <Button
              className="flex-1"
              disabled={!unlockReason.trim() || requestUnlockMutation.isPending}
              onClick={handleRequestUnlock}
            >
              {requestUnlockMutation.isPending ? '요청 중...' : '요청하기'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
