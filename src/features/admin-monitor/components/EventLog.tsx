import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { EventLogEntry } from '../types';
import { EVENT_EMOJI } from '../types';

interface Props {
  events: EventLogEntry[];
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const TYPE_COLOR: Record<string, string> = {
  outing_start: 'text-orange-500',
  outing_end:   'text-green-500',
  nap_start:    'text-purple-500',
  nap_end:      'text-green-500',
  penalty:      'text-red-500',
  attendance:   'text-blue-500',
};

function EventLogInner({ events }: Props) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-2">
        <p className="text-xs font-semibold text-gray-500">실시간 이벤트</p>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 280 }}>
        {events.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400">오늘 이벤트가 없습니다</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50">
                <span className="mt-0.5 text-[10px] text-gray-400 w-10 flex-shrink-0 tabular-nums">
                  {formatTime(event.time)}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-gray-700 truncate block">
                    {event.studentName}
                  </span>
                  <span className={cn('text-[11px]', TYPE_COLOR[event.type] ?? 'text-gray-500')}>
                    {EVENT_EMOJI[event.type]} {event.label}
                  </span>
                  {event.detail && (
                    <span className="ml-1 text-[10px] text-gray-400">{event.detail}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const EventLog = memo(EventLogInner);
