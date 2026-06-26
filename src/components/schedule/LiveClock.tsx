import { useCurrentTime } from '@/hooks/useCurrentTime';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function LiveClock() {
  const now = useCurrentTime(1000);

  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const dayStr = DAY_LABELS[now.getDay()];
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  return (
    <div className="text-right leading-tight">
      <p className="text-[10px] text-gray-500">{dateStr} ({dayStr})</p>
      <p className="text-sm font-mono font-semibold text-gray-800">{timeStr}</p>
    </div>
  );
}
