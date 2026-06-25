import { useMemo, useState } from 'react';
import { useStudentsQuery } from '@/features/admin-students/hooks';
import { useScheduleForDateQuery, useWeeklySubmissionStatusesQuery } from '@/features/admin-schedule/hooks';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { WeeklyScheduleGrid } from '@/features/schedule/components/WeeklyScheduleGrid';
import { cellKey } from '@/features/schedule/types';
import { formatWeekRangeLabel, getWeekStartDate } from '@/features/schedule/dates';
import { usePeriods } from '@/hooks/usePeriods';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

type Tab = 'student' | 'date' | 'week';

const TABS: { key: Tab; label: string }[] = [
  { key: 'student', label: '학생별 조회' },
  { key: 'date', label: '날짜별 조회' },
  { key: 'week', label: '주간 제출현황' },
];

function StudentTab() {
  const { data: students } = useStudentsQuery();
  const [studentId, setStudentId] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStartDate = getWeekStartDate(weekOffset);
  const { data } = useWeeklyScheduleQuery(studentId, weekStartDate);

  const selected = new Set((data?.cells ?? []).map((cell) => cellKey(cell.dayOfWeek, cell.periodNumber)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">학생 선택</option>
          {(students ?? []).map((student) => (
            <option key={student.id} value={student.id}>
              {student.name} ({student.phone})
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => setWeekOffset((prev) => prev - 1)}>
          이전주
        </Button>
        <span className="text-sm text-gray-500">{formatWeekRangeLabel(weekStartDate)}</span>
        <Button variant="secondary" onClick={() => setWeekOffset((prev) => prev + 1)}>
          다음주
        </Button>
      </div>

      {!studentId ? (
        <EmptyState title="학생을 선택해주세요" />
      ) : (
        <>
          <Badge tone={data?.schedule?.status === 'submitted' ? 'success' : 'default'}>
            {data?.schedule?.status === 'submitted' ? '제출 완료' : '미제출/작성중'}
          </Badge>
          <WeeklyScheduleGrid selected={selected} readOnly />
        </>
      )}
    </div>
  );
}

function DateTab() {
  const { data: periods } = usePeriods();
  const { data: students } = useStudentsQuery();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: entries, isLoading } = useScheduleForDateQuery(date);

  const studentNameById = useMemo(
    () => new Map((students ?? []).map((student) => [student.id, student.name])),
    [students]
  );

  return (
    <div className="flex flex-col gap-4">
      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(periods ?? []).map((period) => {
            const studentIds = (entries ?? [])
              .filter((entry) => entry.periodNumber === period.period_number)
              .map((entry) => entry.studentId);
            return (
              <div key={period.period_number} className="rounded-md border border-gray-200 bg-white p-3">
                <p className="mb-2 text-sm font-semibold text-gray-700">
                  {period.label} ({studentIds.length}명)
                </p>
                {studentIds.length === 0 ? (
                  <p className="text-xs text-gray-400">신청 학생 없음</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {studentIds.map((id) => (
                      <Badge key={id}>{studentNameById.get(id) ?? id}</Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeekTab() {
  const { data: students } = useStudentsQuery();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStartDate = getWeekStartDate(weekOffset);
  const { data: statuses } = useWeeklySubmissionStatusesQuery(weekStartDate);

  const statusByStudentId = useMemo(
    () => new Map((statuses ?? []).map((entry) => [entry.studentId, entry.status])),
    [statuses]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => setWeekOffset((prev) => prev - 1)}>
          이전주
        </Button>
        <span className="text-sm text-gray-500">{formatWeekRangeLabel(weekStartDate)}</span>
        <Button variant="secondary" onClick={() => setWeekOffset((prev) => prev + 1)}>
          다음주
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">이름</th>
              <th className="px-3 py-2">제출 상태</th>
            </tr>
          </thead>
          <tbody>
            {(students ?? []).map((student) => {
              const status = statusByStudentId.get(student.id) ?? 'none';
              return (
                <tr key={student.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{student.name}</td>
                  <td className="px-3 py-2">
                    <Badge tone={status === 'submitted' ? 'success' : status === 'draft' ? 'warning' : 'danger'}>
                      {status === 'submitted' ? '제출 완료' : status === 'draft' ? '작성중' : '미제출'}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SchedulesPage() {
  const [tab, setTab] = useState<Tab>('student');

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-900">시간표 관리</h2>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <Button key={t.key} variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'student' && <StudentTab />}
      {tab === 'date' && <DateTab />}
      {tab === 'week' && <WeekTab />}
    </div>
  );
}
