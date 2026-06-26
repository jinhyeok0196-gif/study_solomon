import { useRef, useEffect } from 'react';
import type { ScheduleSlotStatus } from '@/hooks/useScheduleStatus';
import { cn } from '@/lib/utils';

function fmtTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

interface Props {
  timeline: ScheduleSlotStatus[];
}

export function ScheduleTimeline({ timeline }: Props) {
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col">
      {timeline.map((slot, idx) => {
        const isCurrent = slot.status === 'current';
        const isPast = slot.status === 'past';
        const isLast = idx === timeline.length - 1;

        return (
          <div key={slot.id} ref={isCurrent ? currentRef : undefined} className="flex gap-3">
            <div className="flex w-6 flex-shrink-0 flex-col items-center">
              <div
                className={cn(
                  'z-10 mt-3 h-3 w-3 flex-shrink-0 rounded-full border-2',
                  isPast && 'border-gray-300 bg-gray-300',
                  isCurrent && 'border-blue-500 bg-blue-500 ring-4 ring-blue-100',
                  !isPast && !isCurrent && 'border-gray-300 bg-white'
                )}
              />
              {!isLast && (
                <div className={cn('mt-0.5 w-0.5 flex-1', isPast ? 'bg-gray-200' : 'bg-gray-100')} />
              )}
            </div>

            <div
              className={cn(
                'mb-0.5 flex-1 rounded-lg px-2 py-2 pb-3',
                isCurrent && 'border border-blue-200 bg-blue-50',
                isPast && 'opacity-50'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isPast && <span className="text-xs text-green-500">✓</span>}
                  {isCurrent && <span className="text-xs font-bold text-blue-500">▶</span>}
                  <span
                    className={cn(
                      'text-sm font-medium',
                      isCurrent ? 'text-blue-800' : isPast ? 'text-gray-400' : 'text-gray-700'
                    )}
                  >
                    {slot.label}
                  </span>
                  {slot.type === 'break' && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
                      쉬는시간
                    </span>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <span
                    className={cn(
                      'text-xs',
                      isCurrent ? 'font-medium text-blue-600' : 'text-gray-400'
                    )}
                  >
                    {fmtTime(slot.startMinutes)}~{fmtTime(slot.endMinutes)}
                  </span>
                  {slot.durationMinutes != null && (
                    <p className="text-[10px] text-gray-400">{slot.durationMinutes}분</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
