import { cn } from '@/lib/utils';
import type { ChatMessage } from '../types';

interface Props {
  message: ChatMessage;
  isOwn: boolean;
  isRead?: boolean;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? '오후' : '오전';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ampm} ${displayH}:${m}`;
}

export function ChatBubble({ message, isOwn, isRead }: Props) {
  if (message.message_type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500 text-center max-w-xs">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.message_type === 'announcement') {
    return (
      <div className="mx-2 my-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs font-semibold text-blue-700 mb-1">📢 공지</p>
        <p className="text-sm text-blue-800">{message.content}</p>
        <p className="text-xs text-blue-500 mt-1 text-right">{formatTime(message.created_at)}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-2 px-3 py-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cn('flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'max-w-[240px] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words',
            isOwn
              ? 'rounded-tr-sm bg-brand-500 text-white'
              : 'rounded-tl-sm bg-gray-100 text-gray-900'
          )}
        >
          {message.content}
        </div>
        <div className={cn('flex items-center gap-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
          {isOwn && isRead && <span className="text-[10px] text-gray-400">읽음</span>}
          <span className="text-[10px] text-gray-400">{formatTime(message.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
