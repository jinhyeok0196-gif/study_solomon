import { useMemo, useState } from 'react';
import { usePeriods } from '@/hooks/usePeriods';
import { useStudentsQuery } from '@/features/admin-students/hooks';
import { useScheduleForDateQuery } from '@/features/admin-schedule/hooks';
import { useAttendanceForDateQuery, useUpsertAttendanceMutation } from '@/features/admin-attendance/hooks';
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/labels';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

const QUICK_STATUSES = ['present', 'late', 'absent', 'early_leave'] as const;

export default function AttendancePage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: periods } = usePeriods();
  const { data: students } = useStudentsQuery();
  const { data: scheduleEntries, isLoading: isScheduleLoading } = useScheduleForDateQuery(date);
  const { data: attendanceRecords } = useAttendanceForDateQuery(date);
  const upsertMutation = useUpsertAttendanceMutation(date);

  useRealtimeTableSync('attendance_records', [['admin-attendance-by-date', date]]);

  const studentNameById = useMemo(
    () => new Map((students ?? []).map((student) => [student.id, student.name])),
    [students]
  );

  const statusByKey = useMemo(() => {
    const map = new Map<string, string>();
    (attendanceRecords ?? []).forEach((record) => {
      map.set(`${record.student_id}-${record.period_number}`, record.status);
    });
    return map;
  }, [attendanceRecords]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-900">출석 관리</h2>

      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      {isScheduleLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(periods ?? []).map((period) => {
            const studentIds = (scheduleEntries ?? [])
              .filter((entry) => entry.periodNumber === period.period_number)
              .map((entry) => entry.studentId);

            return (
              <div key={period.period_number} className="rounded-md border border-gray-200 bg-white p-3">
                <p className="mb-2 text-sm font-semibold text-gray-700">{period.label}</p>
                {studentIds.length === 0 ? (
                  <EmptyState title="신청 학생 없음" />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {studentIds.map((studentId) => {
                      const currentStatus = statusByKey.get(`${studentId}-${period.period_number}`);
                      return (
                        <li key={studentId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-medium text-gray-900">
                            {studentNameById.get(studentId) ?? studentId}
                          </span>
                          <div className="flex items-center gap-1">
                            {currentStatus && (
                              <Badge tone={currentStatus === 'present' ? 'success' : currentStatus === 'late' ? 'warning' : 'danger'}>
                                {ATTENDANCE_STATUS_LABEL[currentStatus] ?? currentStatus}
                              </Badge>
                            )}
                            {QUICK_STATUSES.map((status) => (
                              <Button
                                key={status}
                                variant="secondary"
                                className={cn(
                                  'px-2 py-1 text-xs',
                                  currentStatus === status && 'border-brand-600 bg-brand-50 text-brand-700'
                                )}
                                disabled={upsertMutation.isPending}
                                onClick={() =>
                                  upsertMutation.mutate({
                                    studentId,
                                    classDate: date,
                                    periodNumber: period.period_number,
                                    status,
                                  })
                                }
                              >
                                {ATTENDANCE_STATUS_LABEL[status]}
                              </Button>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
