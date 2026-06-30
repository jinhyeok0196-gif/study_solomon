import { useAuth } from '@/hooks/useAuth';
import { useOngoingOutingQuery } from '@/features/outing/hooks';
import { useTodayNapQuery } from '@/features/powernap/hooks';
import { useOngoingExtraStudyQuery } from '@/features/extra-study/hooks';
import type { ScheduleSlot } from '@/hooks/useScheduleStatus';
import { cn } from '@/lib/utils';

interface Props {
  currentSlot: ScheduleSlot | null;
  /** QR 등원(체크인)했고 아직 하원하지 않았는지 */
  isCheckedIn: boolean;
  /** 현재 본인이 신청한 수업 교시 시간인지 (= 실제 순공 집계 중) */
  isRegisteredClass: boolean;
}

export function StudentStatusBadge({ currentSlot, isCheckedIn, isRegisteredClass }: Props) {
  const { user } = useAuth();
  const studentId = user!.id;
  const { data: outing } = useOngoingOutingQuery(studentId);
  const { data: nap } = useTodayNapQuery(studentId);
  const { data: extraStudy } = useOngoingExtraStudyQuery(studentId);

  // 기본값: 미등원 (회색). 등원 후 활동에 따라 아래에서 덮어쓴다.
  let icon = '⚪';
  let label = '미등원';
  let colorClass = 'bg-gray-50 text-gray-500 border-gray-200';

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
    // 교시외공부 진행 중 → 등원 여부와 무관하게(집 공부 포함) '교시외 공부중'
    icon = '📖';
    label = '교시외 공부중';
    colorClass = 'bg-green-50 text-green-700 border-green-200';
  } else if (!isCheckedIn) {
    // 등원(체크인) 전 → 미등원 (기본값 유지)
  } else if (isRegisteredClass) {
    // 등원 + 현재 신청한 교시 시간 → 실제 순공 집계 중
    icon = '🟢';
    label = '공부 중';
    colorClass = 'bg-green-50 text-green-700 border-green-200';
  } else if (currentSlot?.category === 'meal') {
    icon = '🍽';
    label = '식사 시간';
    colorClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
  } else if (currentSlot?.category === 'break') {
    icon = '⏸';
    label = '쉬는시간';
    colorClass = 'bg-gray-50 text-gray-600 border-gray-200';
  } else {
    // 등원했지만 신청 교시 전/후·교시 사이 등 → '등원'
    icon = '🏫';
    label = '등원';
    colorClass = 'bg-blue-50 text-blue-700 border-blue-200';
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
