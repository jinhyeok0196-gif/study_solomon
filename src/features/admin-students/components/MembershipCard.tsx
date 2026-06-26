import { useState } from 'react';
import { addDays, addMonths, addYears, format, differenceInCalendarDays } from 'date-fns';
import { useGrantMembershipMutation } from '../hooks';
import type { StudentSummary } from '../types';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface Preset {
  label: string;
  apply: (base: Date) => Date;
}

const PRESETS: Preset[] = [
  { label: '7일', apply: (d) => addDays(d, 7) },
  { label: '1개월', apply: (d) => addMonths(d, 1) },
  { label: '3개월', apply: (d) => addMonths(d, 3) },
  { label: '6개월', apply: (d) => addMonths(d, 6) },
  { label: '1년', apply: (d) => addYears(d, 1) },
];

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function parseLocal(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function fmtKo(dateStr: string): string {
  const d = parseLocal(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function MembershipCard({ student }: { student: StudentSummary }) {
  const mutation = useGrantMembershipMutation(student.id);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const applyPreset = (preset: Preset) => {
    const base = startDate ? parseLocal(startDate) : new Date();
    setEndDate(format(preset.apply(base), 'yyyy-MM-dd'));
    setSelectedPreset(preset.label);
    setMessage(null);
  };

  const handleGrant = async () => {
    if (!startDate || !endDate) return;
    if (parseLocal(endDate) <= parseLocal(startDate)) {
      setMessage('종료일은 시작일보다 뒤여야 합니다.');
      return;
    }
    setMessage(null);
    await mutation.mutateAsync({
      startDate,
      endDate,
      type: selectedPreset ?? '직접설정',
    });
    setMessage('이용권이 부여되었습니다.');
  };

  // 현재 이용권 상태
  const hasMembership = !!(student.membershipStartDate && student.membershipEndDate);
  const remainingDays = student.membershipEndDate
    ? differenceInCalendarDays(parseLocal(student.membershipEndDate), new Date())
    : null;
  const isExpired = remainingDays != null && remainingDays < 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 현재 이용권 */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500">현재 이용권</p>
          {hasMembership ? (
            <Badge tone={isExpired ? 'danger' : 'success'}>
              {isExpired ? '만료됨' : remainingDays === 0 ? '오늘 만료' : `D-${remainingDays}`}
            </Badge>
          ) : (
            <Badge tone="default">미등록</Badge>
          )}
        </div>
        {hasMembership ? (
          <div className="mt-2 text-sm text-gray-700">
            <p className="font-medium">{student.membershipType ?? '이용권'}</p>
            <p className="text-xs text-gray-500">
              {fmtKo(student.membershipStartDate!)} ~ {fmtKo(student.membershipEndDate!)}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-400">등록된 이용권이 없습니다.</p>
        )}
      </div>

      {/* 이용권 부여 */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="membership-start" className="mb-1 block text-xs font-medium text-gray-600">
              시작일
            </label>
            <Input
              id="membership-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setSelectedPreset(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="membership-end" className="mb-1 block text-xs font-medium text-gray-600">
              종료일
            </label>
            <Input
              id="membership-end"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setSelectedPreset(null);
              }}
            />
          </div>
        </div>

        {/* 자주 쓰는 기간 프리셋 */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-600">자주 쓰는 기간</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  selectedPreset === preset.label
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:bg-gray-50'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <p
            className={cn(
              'text-sm',
              message.includes('부여') ? 'text-brand-700' : 'text-red-500'
            )}
          >
            {message}
          </p>
        )}

        <Button
          type="button"
          disabled={!startDate || !endDate || mutation.isPending}
          onClick={handleGrant}
        >
          {mutation.isPending ? '부여 중...' : '이용권 부여'}
        </Button>
      </div>
    </div>
  );
}
