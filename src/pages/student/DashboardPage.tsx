import { isSameMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePeriods } from '@/hooks/usePeriods';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useScheduleStatus } from '@/hooks/useScheduleStatus';
import { useAttendanceRecordsQuery } from '@/features/attendance/hooks';
import { computeAttendanceStats } from '@/features/attendance/stats';
import { usePenaltyProfileQuery } from '@/features/penalty/hooks';
import { computeRiskLevel } from '@/features/penalty/risk';
import { STUDENT_PATHS } from '@/routes/paths';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CurrentPeriodCard } from '@/components/schedule/CurrentPeriodCard';
import { ScheduleTimeline } from '@/components/schedule/ScheduleTimeline';
import { StudentStatusBadge } from '@/components/schedule/StudentStatusBadge';

const QUICK_LINKS = [
  { to: STUDENT_PATHS.outing, label: '외출' },
  { to: STUDENT_PATHS.powerNap, label: '파워냅' },
  { to: STUDENT_PATHS.absenceRequest, label: '결석 신청' },
  { to: STUDENT_PATHS.leaveRequest, label: '조퇴 신청' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const now = useCurrentTime(1000);

  const { data: periods } = usePeriods();
  const { data: attendanceRecords } = useAttendanceRecordsQuery(studentId);
  const { data: penaltyProfile } = usePenaltyProfileQuery(studentId);

  const scheduleStatus = useScheduleStatus(periods, now);

  const allRecords = attendanceRecords ?? [];
  const monthRecords = allRecords.filter((record) =>
    isSameMonth(new Date(record.classDate), new Date())
  );
  const stats = computeAttendanceStats(allRecords, monthRecords);
  const risk = penaltyProfile ? computeRiskLevel(penaltyProfile.currentPenaltyPoints) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 인사 + 현재 상태 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{user!.name}님, 안녕하세요</h2>
          <p className="text-sm text-gray-500">솔로몬스터디카페</p>
        </div>
        <StudentStatusBadge currentSlot={scheduleStatus.currentSlot} />
      </div>

      {/* 현재 진행 중 + 남은 시간 + 다음 일정 */}
      <CurrentPeriodCard status={scheduleStatus} upcomingAlert={scheduleStatus.upcomingClassAlert} />

      {/* 통계 */}
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

      {/* 빠른 링크 */}
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

      {/* 오늘 일정 타임라인 */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-700">오늘 일정</p>
        <ScheduleTimeline timeline={scheduleStatus.timeline} />
      </div>
    </div>
  );
}
