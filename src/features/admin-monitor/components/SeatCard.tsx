import { memo } from 'react';
import { cn } from '@/lib/utils';
import { formatElapsed, formatRemaining } from '@/lib/time';
import type { SeatData } from '../types';
import { SEAT_STATUS_CONFIG } from '../types';

interface Props {
  seatData: SeatData;
  isSelected: boolean;
  onClick: (studentId: string | null, seatNumber: number) => void;
  now: Date;
  currentSlotLabel: string | null;
  remainingSeconds: number;
}

function SeatCardInner({ seatData, isSelected, onClick, now, currentSlotLabel, remainingSeconds }: Props) {
  const { seat, student, status } = seatData;
  const cfg = SEAT_STATUS_CONFIG[status];
  const isEmpty = status === 'empty';

  const handleClick = () => {
    if (!isEmpty) {
      onClick(student?.id ?? null, seat.seatNumber);
    }
  };

  const remainingMin = Math.floor(remainingSeconds / 60);

  return (
    <div
      role={isEmpty ? undefined : 'button'}
      tabIndex={isEmpty ? undefined : 0}
      onKeyDown={isEmpty ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      onClick={isEmpty ? undefined : handleClick}
      className={cn(
        'relative flex flex-col rounded-xl border-2 p-3 transition-all duration-200',
        cfg.cardClass,
        isSelected && 'ring-2 ring-brand-500 ring-offset-1',
        !isEmpty && 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]',
        isEmpty && 'cursor-default opacity-70'
      )}
    >
      {/* 좌석 번호 */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-gray-400">{seat.displayName}</span>
        <span className={cn('h-2 w-2 rounded-full flex-shrink-0', cfg.dotClass)} />
      </div>

      {/* 학생 이름 */}
      <div className="flex-1 flex items-center justify-center py-2 min-h-[40px]">
        {student ? (
          <p className="text-sm font-bold text-gray-800 text-center leading-tight">
            {student.studentName}
          </p>
        ) : (
          <p className="text-xs text-gray-300 text-center">빈 좌석</p>
        )}
      </div>

      {/* 상태 뱃지 */}
      <div className={cn('text-center text-xs font-semibold', cfg.textClass)}>
        {cfg.emoji} {cfg.label}
      </div>

      {/* 교시/시간 정보 */}
      {student && (status === 'studying' || status === 'late') && currentSlotLabel && (
        <div className="mt-1 text-center text-[10px] text-gray-500">
          <span>{currentSlotLabel}</span>
          {remainingMin > 0 && (
            <span className="ml-1 text-brand-500">{remainingMin}분 남음</span>
          )}
        </div>
      )}

      {/* 외출 경과 시간 */}
      {student?.ongoingOuting && status === 'outing' && (
        <div className="mt-1 text-center font-mono text-xs text-orange-600">
          {formatElapsed(student.ongoingOuting.startedAt, now)}
        </div>
      )}

      {/* 파워냅 잔여 시간 */}
      {student?.ongoingPowerNap && status === 'power_nap' && (
        <div className="mt-1 text-center font-mono text-xs text-purple-600">
          {now > new Date(student.ongoingPowerNap.plannedEndAt)
            ? <span className="text-red-500">+{formatElapsed(student.ongoingPowerNap.plannedEndAt, now)}</span>
            : formatRemaining(student.ongoingPowerNap.plannedEndAt, now)
          }
        </div>
      )}

      {/* 선택 표시 */}
      {isSelected && (
        <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-brand-500" />
      )}
    </div>
  );
}

export const SeatCard = memo(SeatCardInner);
