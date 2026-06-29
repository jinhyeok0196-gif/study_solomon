import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePeriods } from '@/hooks/usePeriods';
import {
  getWeekStartDate,
  formatWeekRangeLabel,
  weekStartDateOf,
  dayOfWeekKeyOf,
} from '@/features/schedule/dates';
import { useMyRequestsQuery } from '@/features/requests/hooks';
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  const weekStartDate = getWeekStartDate(weekOffset);
  const { data, isLoading } = useWeeklyScheduleQuery(user!.id, weekStartDate);
  const saveMutation = useSaveWeeklyScheduleMutation(user!.id, weekStartDate);
  const { data: hasPendingUnlock } = usePendingScheduleUnlockQuery(user!.id, weekStartDate);
  const requestUnlockMutation = useRequestScheduleUnlockMutation(user!.id, weekStartDate);
  const { data: absenceRequests } = useMyRequestsQuery('absence', user!.id);

  // 승인된 결석 중 현재 표시 중인 주(week)에 해당하는 교시 셀
  const approvedAbsenceCells = useMemo(() => {
    const set = new Set<string>();
    for (const req of absenceRequests ?? []) {
      if (req.status !== 'approved') continue;
      if (weekStartDateOf(req.requestDate) !== weekStartDate) continue;
      const day = dayOfWeekKeyOf(req.requestDate);
      for (const period of req.periodNumbers) set.add(cellKey(day, period));
    }
    return set;
  }, [absenceRequests, weekStartDate]);

  useEffect(() => {
    setSelected(new Set((data?.cells ?? []).map((cell) => cellKey(cell.dayOfWeek, cell.periodNumber))));
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
      if (!p.is_selectable) continue;
      for (const d of DAYS_OF_WEEK) next.add(cellKey(d, p.period_number));
    }
    setSelected(next);
  };

  const handleClearAll = () => setSelected(new Set());

  const handleSelectWeekdays = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of periods ?? []) {
        if (!p.is_selectable) continue;
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
        if (!p.is_selectable) continue;
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

  const handleSave = async () => {
    await saveMutation.mutateAsync({ cells: selectedCells, submit: false });
  };

  const handleConfirmSubmit = async () => {
    await saveMutation.mutateAsync({ cells: selectedCells, submit: true });
    setShowConfirmModal(false);
    setShowSuccessModal(true);
  };

  const handleRequestUnlock = async () => {
    if (!unlockReason.trim()) return;
    await requestUnlockMutation.mutateAsync(unlockReason.trim());
    setShowUnlockModal(false);
    setUnlockReason('');
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">주간 시간표 제출</h2>
        <Badge tone={isLocked ? 'success' : data?.schedule?.status === 'draft' ? 'warning' : 'default'}>
          {isLocked ? '🔒 제출 완료' : data?.schedule?.status === 'draft' ? '작성 중' : '미작성'}
        </Badge>
      </div>

      {/* 주차 선택 */}
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
          {/* 빠른 선택 버튼 (잠금 해제 상태에서만) */}
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

          {/* 시간표 그리드 */}
          <WeeklyScheduleGrid
            selected={selected}
            onCellChange={handleCellChange}
            readOnly={isLocked}
            absenceCells={approvedAbsenceCells}
          />

          {/* 잠금 상태 안내 */}
          {isLocked ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium text-gray-800">현재 시간표는 제출되어 수정이 잠겨 있습니다.</p>
                <p className="text-xs text-gray-500 mt-1">수정이 필요한 경우 관리자에게 수정 권한을 요청하세요.</p>
              </div>
              {hasPendingUnlock ? (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2">
                  <p className="text-sm text-yellow-800 font-medium">관리자의 승인을 기다리고 있습니다.</p>
                  <p className="text-xs text-yellow-600 mt-0.5">승인 후 시간표를 수정하고 반드시 다시 제출해주세요.</p>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setShowUnlockModal(true)}>
                  수정 권한 요청
                </Button>
              )}
            </div>
          ) : (
            /* 저장 / 제출 버튼 */
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={saveMutation.isPending}
                onClick={handleSave}
              >
                임시 저장
              </Button>
              <Button
                disabled={saveMutation.isPending}
                onClick={() => setShowConfirmModal(true)}
              >
                제출
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── 제출 확인 모달 ── */}
      <Modal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="시간표 최종 제출"
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
            <p className="font-medium mb-1">제출 전 확인해주세요</p>
            <ul className="list-disc list-inside space-y-1 text-xs text-yellow-700">
              <li>시간표를 제출하면 더 이상 직접 수정할 수 없습니다.</li>
              <li>수정을 원할 경우 관리자에게 "수정 권한 요청"을 해야 합니다.</li>
              <li>제출 전 모든 교시를 다시 확인해주세요.</li>
            </ul>
          </div>
          <p className="text-sm text-gray-600">
            선택한 교시 수: <span className="font-semibold text-gray-900">{selectedCells.length}개</span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={saveMutation.isPending}
              onClick={() => setShowConfirmModal(false)}
            >
              취소
            </Button>
            <Button
              className="flex-1"
              disabled={saveMutation.isPending}
              onClick={handleConfirmSubmit}
            >
              {saveMutation.isPending ? '제출 중...' : '최종 제출'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── 제출 완료 모달 ── */}
      <Modal
        open={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title="제출 완료"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 py-2">
            <span className="text-4xl">✅</span>
            <p className="text-base font-semibold text-gray-900 text-center">
              시간표가 정상적으로 제출되었습니다.
            </p>
          </div>
          <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 space-y-1">
            <p>시간표는 잠금 상태로 변경되었습니다.</p>
            <p>추후 수정이 필요한 경우 관리자에게 "수정 권한 요청"을 통해 승인받아야 합니다.</p>
          </div>
          <Button onClick={() => setShowSuccessModal(false)}>확인</Button>
        </div>
      </Modal>

      {/* ── 수정 권한 요청 모달 ── */}
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
