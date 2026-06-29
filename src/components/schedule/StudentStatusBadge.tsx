import { useAuth } from '@/hooks/useAuth';
import { useOngoingOutingQuery } from '@/features/outing/hooks';
import { useTodayNapQuery } from '@/features/powernap/hooks';
import { useOngoingExtraStudyQuery } from '@/features/extra-study/hooks';
import type { ScheduleSlot } from '@/hooks/useScheduleStatus';
import { cn } from '@/lib/utils';

interface Props {
  currentSlot: ScheduleSlot | null;
}

export function StudentStatusBadge({ currentSlot }: Props) {
  const { user } = useAuth();
  const studentId = user!.id;
  const { data: outing } = useOngoingOutingQuery(studentId);
  const { data: nap } = useTodayNapQuery(studentId);
  const { data: extraStudy } = useOngoingExtraStudyQuery(studentId);

  let icon = '🟢';
  let label = '공부 중';
  let colorClass = 'bg-green-50 text-green-700 border-green-200';

  // power_nap_logs.status values: 'active' is set on insert (default), 'completed' on end
  if (nap && nap.status !== 'completed') {
    icon = '😴';
    label = '파워냅';
    colorClass = 'bg-purple-50 text-purple-700 border-purple-200';
  } else if (outing) {
    icon = '🚶';
    label = '외출 중';
    colorClass = 'bg-orange-50 text-orange-700 border-orange-200';
  } else if (extraStudy) {
    // 교시외공부 진행 중 → 비수업 시간이어도 '공부 중'
    icon = '📖';
    label = '공부 중';
    colorClass = 'bg-green-50 text-green-700 border-green-200';
  } else if (currentSlot?.category === 'meal') {
    icon = '🍽';
    label = '식사 시간';
    colorClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
  } else if (currentSlot?.category === 'free') {
    icon = '📖';
    label = '자율학습';
    colorClass = 'bg-green-50 text-green-700 border-green-200';
  } else if (currentSlot?.category === 'arrival') {
    icon = '🏫';
    label = '등원';
    colorClass = 'bg-gray-50 text-gray-600 border-gray-200';
  } else if (currentSlot?.category === 'break') {
    icon = '⏸';
    label = '쉬는시간';
    colorClass = 'bg-gray-50 text-gray-600 border-gray-200';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium',
        colorClass
      )}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}
