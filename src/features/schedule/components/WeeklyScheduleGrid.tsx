import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAYS_OF_WEEK, DAY_OF_WEEK_LABEL, type DayOfWeek } from '@/constants/periods';
import { usePeriods } from '@/hooks/usePeriods';
import { cn } from '@/lib/utils';
import { cellKey } from '../types';

interface WeeklyScheduleGridProps {
  selected: ReadonlySet<string>;
  onCellChange?: (dayOfWeek: DayOfWeek, periodNumber: number, selected: boolean) => void;
  readOnly?: boolean;
}

interface DragState {
  isDragging: boolean;
  targetSelected: boolean;
  affectedKeys: Set<string>;
}

export function WeeklyScheduleGrid({ selected, onCellChange, readOnly = false }: WeeklyScheduleGridProps) {
  const { data: periods } = usePeriods();
  const containerRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<DragState>({
    isDragging: false,
    targetSelected: false,
    affectedKeys: new Set(),
  });

  // Use ref to always access latest onCellChange in stable callbacks
  const onCellChangeRef = useRef(onCellChange);
  onCellChangeRef.current = onCellChange;

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
    e.preventDefault();
    const key = cellKey(day, period);
    const target = !selected.has(key);
    dragRef.current = { isDragging: true, targetSelected: target, affectedKeys: new Set([key]) };
    setDraggingState({ keys: new Set([key]), targetSelected: target });
  };

  return (
    <div ref={containerRef} className="overflow-x-auto select-none">
      <table className="w-full min-w-[480px] border-collapse text-center text-sm">
        <thead>
          <tr>
            <th className="w-16 border-b border-gray-200 p-2 text-xs text-gray-500">교시</th>
            {DAYS_OF_WEEK.map((day) => (
              <th key={day} className="border-b border-gray-200 p-2 text-xs text-gray-500">
                {DAY_OF_WEEK_LABEL[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(periods ?? []).map((period) => (
            <tr key={period.period_number}>
              <td className="border-b border-gray-100 p-2 text-xs text-gray-500">
                {period.label}
              </td>
              {DAYS_OF_WEEK.map((day) => {
                const key = cellKey(day, period.period_number);
                const isSelected = visualSelected.has(key);
                return (
                  <td key={key} className="border-b border-gray-100 p-1">
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
                      className={cn(
                        'h-8 w-8 rounded-md border text-xs transition-colors',
                        isSelected
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-gray-200 bg-white text-transparent hover:border-brand-300',
                        readOnly && 'cursor-default opacity-70 hover:border-gray-200'
                      )}
                    >
                      {isSelected ? '✓' : '·'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
