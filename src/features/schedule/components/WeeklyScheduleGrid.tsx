import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAYS_OF_WEEK, DAY_OF_WEEK_LABEL, type DayOfWeek } from '@/constants/periods';
import { usePeriods } from '@/hooks/usePeriods';
import { cn } from '@/lib/utils';
import { cellKey } from '../types';

interface WeeklyScheduleGridProps {
  selected: ReadonlySet<string>;
  onCellChange?: (dayOfWeek: DayOfWeek, periodNumber: number, selected: boolean) => void;
  readOnly?: boolean;
  /** 결석 승인된 셀(cellKey) — 해당 교시에 X·결석승인 표시 */
  absenceCells?: ReadonlySet<string>;
  /** 조퇴 승인된 셀(cellKey) — 해당 교시에 X·조퇴승인 표시 */
  leaveCells?: ReadonlySet<string>;
}

interface DragState {
  isDragging: boolean;
  targetSelected: boolean;
  affectedKeys: Set<string>;
}

function fmtTime(t: string) {
  return t.slice(0, 5);
}

function categoryLabel(category: string) {
  if (category === 'meal') return '식사 시간';
  if (category === 'arrival') return '등원 시간';
  return '자율학습';
}

export function WeeklyScheduleGrid({
  selected,
  onCellChange,
  readOnly = false,
  absenceCells,
  leaveCells,
}: WeeklyScheduleGridProps) {
  const { data: periods } = usePeriods();
  const containerRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<DragState>({
    isDragging: false,
    targetSelected: false,
    affectedKeys: new Set(),
  });

  const onCellChangeRef = useRef(onCellChange);
  onCellChangeRef.current = onCellChange;

  // 터치 직후(약 300ms 뒤) 브라우저가 합성 마우스 이벤트를 발생시켜 같은 셀을
  // 다시 토글해버린다(탭 = 켜짐→꺼짐). 마지막 터치 시각을 기록해 그 직후의
  // 마우스 이벤트는 무시한다.
  const lastTouchRef = useRef(0);

  const [draggingState, setDraggingState] = useState<{
    keys: Set<string>;
    targetSelected: boolean;
  } | null>(null);

  const applyDragEnd = useCallback(() => {
    const { targetSelected, affectedKeys } = dragRef.current;
    dragRef.current = { isDragging: false, targetSelected: false, affectedKeys: new Set() };
    setDraggingState(null);
    for (const key of affectedKeys) {
      const dashIdx = key.indexOf('-');
      const day = key.slice(0, dashIdx) as DayOfWeek;
      const period = Number(key.slice(dashIdx + 1));
      onCellChangeRef.current?.(day, period, targetSelected);
    }
  }, []);

  const applyDragCell = useCallback((day: DayOfWeek, period: number) => {
    if (!dragRef.current.isDragging) return;
    const key = cellKey(day, period);
    if (dragRef.current.affectedKeys.has(key)) return;
    dragRef.current.affectedKeys.add(key);
    setDraggingState({
      keys: new Set(dragRef.current.affectedKeys),
      targetSelected: dragRef.current.targetSelected,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    const handleMouseUp = () => {
      if (dragRef.current.isDragging) applyDragEnd();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragRef.current.isDragging) return;
      e.preventDefault();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const button = el?.closest('[data-day]') as HTMLElement | null;
      if (!button) return;
      const day = button.dataset.day as DayOfWeek;
      const period = Number(button.dataset.period);
      if (day && period) applyDragCell(day, period);
    };

    const handleTouchEnd = () => {
      lastTouchRef.current = performance.now();
      if (dragRef.current.isDragging) applyDragEnd();
    };

    document.addEventListener('mouseup', handleMouseUp);
    container?.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      container?.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [applyDragEnd, applyDragCell]);

  const visualSelected = useMemo(() => {
    if (!draggingState) return selected;
    const next = new Set(selected);
    for (const key of draggingState.keys) {
      if (draggingState.targetSelected) next.add(key);
      else next.delete(key);
    }
    return next;
  }, [selected, draggingState]);

  const startDrag = (day: DayOfWeek, period: number, e: React.MouseEvent | React.TouchEvent) => {
    if (readOnly) return;
    const isTouch = 'touches' in e;
    if (isTouch) {
      lastTouchRef.current = performance.now();
    } else if (performance.now() - lastTouchRef.current < 700) {
      // 터치 직후의 합성 마우스 이벤트 → 이중 토글 방지를 위해 무시
      return;
    }
    e.preventDefault();
    const key = cellKey(day, period);
    const target = !selected.has(key);
    dragRef.current = { isDragging: true, targetSelected: target, affectedKeys: new Set([key]) };
    setDraggingState({ keys: new Set([key]), targetSelected: target });
  };

  return (
    <div ref={containerRef} className="overflow-x-auto select-none">
      <table className="w-full min-w-[340px] border-collapse border border-black text-center text-sm">
        <thead>
          <tr>
            <th className="w-20 min-w-[80px] border border-black p-2 text-left text-xs text-gray-500">교시</th>
            {DAYS_OF_WEEK.map((day) => (
              <th key={day} className="border border-black p-2 text-xs text-gray-500">
                {DAY_OF_WEEK_LABEL[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(periods ?? []).map((period) => {
            if (!period.is_selectable) {
              return (
                <tr key={period.period_number} style={{ backgroundColor: period.display_color + '30' }}>
                  <td
                    style={{ borderLeftColor: period.display_color }}
                    className="border border-black border-l-4 p-1.5 text-left w-20 min-w-[80px]"
                  >
                    <p className="text-xs font-semibold text-gray-700 leading-tight">{period.display_name}</p>
                    <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                      {fmtTime(period.start_time)}~{fmtTime(period.end_time)}
                    </p>
                    {period.duration_minutes != null && (
                      <p className="text-[10px] text-gray-400 leading-tight">{period.duration_minutes}분</p>
                    )}
                  </td>
                  <td colSpan={7} className="border border-black px-2 py-1 text-left">
                    <span className="text-xs text-gray-500">{categoryLabel(period.category)}</span>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={period.period_number}>
                <td
                  style={{ borderLeftColor: period.display_color }}
                  className="border border-black border-l-4 p-1.5 text-left w-20 min-w-[80px]"
                >
                  <p className="text-xs font-semibold text-gray-900 leading-tight">{period.display_name}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                    {fmtTime(period.start_time)}~{fmtTime(period.end_time)}
                  </p>
                  {period.duration_minutes != null && (
                    <p className="text-[10px] text-gray-400 leading-tight">{period.duration_minutes}분</p>
                  )}
                </td>
                {DAYS_OF_WEEK.map((day) => {
                  const key = cellKey(day, period.period_number);
                  const isSelected = visualSelected.has(key);
                  // 결석 승인(빨강) 우선, 없으면 조퇴 승인(주황)
                  const mark = (absenceCells?.has(key)
                    ? { label: '결석승인', btn: 'border-red-500 bg-red-50 text-red-600', text: 'text-red-600' }
                    : leaveCells?.has(key)
                      ? { label: '조퇴승인', btn: 'border-amber-500 bg-amber-50 text-amber-600', text: 'text-amber-600' }
                      : null) as { label: string; btn: string; text: string } | null;
                  return (
                    <td key={key} className="border border-black p-1">
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          type="button"
                          data-day={day}
                          data-period={period.period_number}
                          disabled={readOnly}
                          onMouseDown={(e) => startDrag(day, period.period_number, e)}
                          onMouseEnter={() => applyDragCell(day, period.period_number)}
                          onTouchStart={(e) => startDrag(day, period.period_number, e)}
                          onContextMenu={(e) => e.preventDefault()}
                          aria-pressed={isSelected}
                          title={mark ? `${mark.label}된 교시` : undefined}
                          className={cn(
                            'h-8 w-8 rounded-md border-2 text-xs transition-colors',
                            mark
                              ? cn('font-bold', mark.btn)
                              : isSelected
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-gray-400 bg-white text-transparent hover:border-brand-400',
                            readOnly && 'cursor-default opacity-70',
                            readOnly && !mark && 'hover:border-gray-400'
                          )}
                        >
                          {mark ? '✕' : isSelected ? '✓' : '·'}
                        </button>
                        {mark && (
                          <span className={cn('text-[8px] font-medium leading-none', mark.text)}>{mark.label}</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
