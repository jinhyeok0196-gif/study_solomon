import { isSameMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePeriods } from '@/hooks/usePeriods';
import { getWeekStartDate, todayDayOfWeekKey } from '@/features/schedule/dates';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { useAttendanceRecordsQuery } from '@/features/attendance/hooks';
import { computeAttendanceStats } from '@/features/attendance/stats';
import { usePenaltyProfileQuery } from '@/features/penalty/hooks';
import { computeRiskLevel } from '@/features/penalty/risk';
import { STUDENT_PATHS } from '@/routes/paths';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

const QUICK_LINKS = [
  { to: STUDENT_PATHS.outing, label: '외출' },
  { to: STUDENT_PATHS.powerNap, label: '파워냅' },
  { to: STUDENT_PATHS.absenceRequest, label: '결석 신청' },
  { to: STUDENT_PATHS.leaveRequest, label: '조퇴 신청' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const studentId = user!.id;

  const { data: periods } = usePeriods();
  const { data: weeklySchedule } = useWeeklyScheduleQuery(studentId, getWeekStartDate(0));
  const { data: attendanceRecords } = useAttendanceRecordsQuery(studentId);
  const { data: penaltyProfile } = usePenaltyProfileQuery(studentId);

  const todayKey = todayDayOfWeekKey();
  const todayPeriodNumbers = (weeklySchedule?.cells ?? [])
    .filter((cell) => cell.dayOfWeek === todayKey)
    .map((cell) => cell.periodNumber)
    .sort((a, b) => a - b);

  const allRecords = attendanceRecords ?? [];
  const monthRecords = allRecords.filter((record) => isSameMonth(new Date(record.classDate), new Date()));
  const stats = computeAttendanceStats(allRecords, monthRecords);

  const risk = penaltyProfile ? computeRiskLevel(penaltyProfile.currentPenaltyPoints) : null;

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{user!.name}님, 안녕하세요</h2>
        <p className="text-sm text-gray-500">오늘도 솔로몬스터디카페에서 좋은 하루 보내세요.</p>
      </div>

      <Card>
        <p className="mb-2 text-sm font-semibold text-gray-700">오늘의 시간표</p>
        {todayPeriodNumbers.length === 0 ? (
          <EmptyState title="오늘 등록된 교시가 없습니다" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {todayPeriodNumbers.map((periodNumber) => {
              const label = periods?.find((p) => p.period_number === periodNumber)?.label ?? `${periodNumber}교시`;
              return <Badge key={periodNumber}>{label}</Badge>;
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-gray-500">이번달 출석률</p>
          <p className="text-2xl font-bold text-gray-900">{Math.round(stats.attendanceRate * 100)}%</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">현재 벌점</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-gray-900">{penaltyProfile?.currentPenaltyPoints ?? 0}점</p>
            {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center justify-center rounded-md border border-gray-200 bg-white py-3 text-xs font-medium text-gray-700 hover:border-brand-300"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
