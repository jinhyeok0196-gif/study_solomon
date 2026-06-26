import { cn } from '@/lib/utils';
import type { ChatMessageLocal } from '../types';

interface Props {
  message: ChatMessageLocal;
  isOwn: boolean;
  isRead?: boolean;
  onRetry?: () => void;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? '오후' : '오전';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ampm} ${displayH}:${m}`;
}

function ReadReceipt({
  isPending,
  isFailed,
  isRead,
  onRetry,
}: {
  isPending?: boolean;
  isFailed?: boolean;
  isRead?: boolean;
  onRetry?: () => void;
}) {
  if (isFailed) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-[10px] text-red-500 hover:underline flex items-center gap-0.5"
      >
        <span>전송 실패</span>
        <span>↺</span>
      </button>
    );
  }
  if (isPending) {
    return <span className="text-[10px] text-gray-300 animate-pulse">전송 중</span>;
  }
  if (isRead) {
    return <span className="text-[10px] text-blue-400">읽음</span>;
  }
  return <span className="text-[10px] text-gray-300">✓</span>;
}

export function ChatBubble({ message, isOwn, isRead, onRetry }: Props) {
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

  const { _isPending: isPending, _isFailed: isFailed } = message;

  return (
    <div className={cn('flex gap-2 px-3 py-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cn('flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
        {message.content.startsWith('__IMG__:') ? (
          <div
            className={cn(
              'max-w-[200px] rounded-2xl overflow-hidden',
              isOwn ? 'rounded-tr-sm' : 'rounded-tl-sm'
            )}
          >
            <img
              src={message.content.replace('__IMG__:', '')}
              alt="첨부 이미지"
              className="w-full object-contain"
            />
          </div>
        ) : (
          <div
            className={cn(
              'max-w-[240px] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words',
              isOwn
                ? 'rounded-tr-sm bg-brand-500 text-white'
                : 'rounded-tl-sm bg-gray-100 text-gray-900',
              isPending && 'opacity-60',
              isFailed && 'opacity-40'
            )}
          >
            {message.content}
          </div>
        )}
        <div className={cn('flex items-center gap-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
          {isOwn && (
            <ReadReceipt
              isPending={isPending}
              isFailed={isFailed}
              isRead={isRead}
              onRetry={onRetry}
            />
          )}
          <span className="text-[10px] text-gray-400">{formatTime(message.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
