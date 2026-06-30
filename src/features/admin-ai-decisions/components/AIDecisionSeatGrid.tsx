import { useMemo } from 'react';
import { AIDecisionSeatCard } from './AIDecisionSeatCard';
import { SEAT_IDS, type AIDecisionRow } from '../types';

interface Props {
  rows: AIDecisionRow[];
  seatIds?: string[];
  nowMs: number;
  onOpen: (row: AIDecisionRow) => void;
}

/** Seat1~Seat8 좌석별 최신 AI 판정 카드 그리드. */
export function AIDecisionSeatGrid({ rows, seatIds = SEAT_IDS, nowMs, onOpen }: Props) {
  const bySeat = useMemo(() => {
    const map = new Map<string, AIDecisionRow>();
    for (const row of rows) {
      if (!map.has(row.seat_id)) map.set(row.seat_id, row); // rows 는 최신순 가정
    }
    return map;
  }, [rows]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {seatIds.map((seatId) => (
        <AIDecisionSeatCard
          key={seatId}
          seatId={seatId}
          row={bySeat.get(seatId) ?? null}
          nowMs={nowMs}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
