import { isSameMonth } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { useAttendanceRecordsQuery } from '@/features/attendance/hooks';
import {
  attendedIntervalsFromRecords,
  awayDeductionMinutes,
  computeAttendanceStats,
} from '@/features/attendance/stats';
import { useAllExtraStudyQuery } from '@/features/extra-study/hooks';
import { sumExtraStudyMinutes } from '@/features/extra-study/api';
import { useAllOutingsQuery } from '@/features/outing/hooks';
import { useRecentNapsQuery } from '@/features/powernap/hooks';
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/labels';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { data: records, isLoading } = useAttendanceRecordsQuery(user!.id);
  const { data: extraStudyLogs } = useAllExtraStudyQuery(user!.id);
  const { data: outingLogs } = useAllOutingsQuery(user!.id);
  const { data: napLogs } = useRecentNapsQuery(user!.id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const allRecords = records ?? [];
  const now = new Date();
  const monthRecords = allRecords.filter((record) => isSameMonth(new Date(record.classDate), now));
  const awayDeduction = awayDeductionMinutes(
    attendedIntervalsFromRecords(allRecords),
    [...(outingLogs ?? []), ...(napLogs ?? [])].map((l) => ({
      startedAt: l.started_at,
      endedAt: l.ended_at,
    }))
  );
  const stats = computeAttendanceStats(
    allRecords,
    monthRecords,
    sumExtraStudyMinutes(extraStudyLogs ?? []),
    awayDeduction
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold text-gray-900">출석 현황</h2>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-gray-500">이번달 출석률</p>
          <p className="text-2xl font-bold text-gray-900">{Math.round(stats.attendanceRate * 100)}%</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">이번달 결석률</p>
          <p className="text-2xl font-bold text-gray-900">{Math.round(stats.absenceRate * 100)}%</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">이번달 지각 횟수</p>
          <p className="text-2xl font-bold text-gray-900">{stats.lateCount}회</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">누적 공부시간</p>
          <p className="text-2xl font-bold text-gray-900">{formatHours(stats.cumulativeStudyMinutes)}시간</p>
        </Card>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-gray-700">최근 출결 내역</h3>
      {allRecords.length === 0 ? (
        <EmptyState title="출결 기록이 없습니다" />
      ) : (
        <ul className="flex flex-col gap-2">
          {allRecords.slice(0, 30).map((record) => (
            <li
              key={`${record.classDate}-${record.periodNumber}`}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <span>
                {record.classDate} · {record.periodNumber}교시
              </span>
              <Badge tone={record.status === 'present' ? 'success' : record.status === 'late' ? 'warning' : 'danger'}>
                {ATTENDANCE_STATUS_LABEL[record.status] ?? record.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
