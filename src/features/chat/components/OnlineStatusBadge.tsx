import { cn } from '@/lib/utils';

interface Props {
  isOnline: boolean;
  lastSeenAt?: number | null;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

function formatLastSeen(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export function OnlineStatusBadge({ isOnline, lastSeenAt, showLabel = false, size = 'sm' }: Props) {
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <div className="flex items-center gap-1">
      <span
        className={cn(
          'rounded-full flex-shrink-0',
          dotSize,
          isOnline ? 'bg-green-400' : 'bg-gray-300'
        )}
      />
      {showLabel && (
        <span className="text-[10px] text-gray-400">
          {isOnline ? '온라인' : lastSeenAt ? formatLastSeen(lastSeenAt) : '오프라인'}
        </span>
      )}
    </div>
  );
}
