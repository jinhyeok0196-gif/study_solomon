import { useCurrentTime } from '@/hooks/useCurrentTime';
import { formatElapsed } from '@/lib/time';

/** 시작 시각부터 현재까지 경과 시간(MM:SS)을 매초 갱신해 표시한다. (자체 타이머라 부모 재렌더 불필요) */
export function LiveElapsed({ startedAt, className }: { startedAt: string; className?: string }) {
  const now = useCurrentTime(1000);
  return <span className={className}>{formatElapsed(startedAt, now)}</span>;
}
