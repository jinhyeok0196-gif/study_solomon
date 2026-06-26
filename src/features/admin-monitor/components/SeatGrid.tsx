import { useMemo, memo } from 'react';
import type { SeatData } from '../types';
import { SeatCard } from './SeatCard';

interface Props {
  seats: SeatData[];
  selectedStudentId: string | null;
  onSeatClick: (studentId: string | null, seatNumber: number) => void;
  now: Date;
  currentSlotLabel: string | null;
  remainingSeconds: number;
}

function SeatGridInner({ seats, selectedStudentId, onSeatClick, now, currentSlotLabel, remainingSeconds }: Props) {
  // pos_y 기준으로 행 그룹화
  const rows = useMemo(() => {
    const rowMap = new Map<number, SeatData[]>();
    for (const seat of seats) {
      const row = rowMap.get(seat.seat.posY) ?? [];
      row.push(seat);
      rowMap.set(seat.seat.posY, row);
    }
    // pos_x 기준 정렬 후 반환
    return Array.from(rowMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([posY, rowSeats]) => ({
        posY,
        seats: rowSeats.sort((a, b) => a.seat.posX - b.seat.posX),
      }));
  }, [seats]);

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, rowIdx) => (
        <div key={row.posY}>
          {/* 통로 구분선: 이전 행과 pos_y 차이가 2 이상이면 통로 표시 */}
          {rowIdx > 0 && row.posY - (rows[rowIdx - 1]?.posY ?? 0) >= 2 && (
            <div className="my-2 flex items-center gap-3">
              <div className="flex-1 border-t border-dashed border-gray-300" />
              <span className="text-xs text-gray-400 select-none">── 통로 ──</span>
              <div className="flex-1 border-t border-dashed border-gray-300" />
            </div>
          )}

          {/* 좌석 행: 모바일 2열, 태블릿+ 4열, 데스크톱은 pos_x로 그리드 배치 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {row.seats.map((seatData) => (
              <SeatCard
                key={seatData.seat.id}
                seatData={seatData}
                isSelected={
                  !!selectedStudentId &&
                  seatData.student?.id === selectedStudentId
                }
                onClick={onSeatClick}
                now={now}
                currentSlotLabel={currentSlotLabel}
                remainingSeconds={remainingSeconds}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const SeatGrid = memo(SeatGridInner);
