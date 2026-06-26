import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStudentsQuery } from '@/features/admin-students/hooks';
import {
  useScheduleForDateQuery,
  useWeeklySubmissionStatusesQuery,
  useScheduleUnlockRequestsQuery,
  useApproveScheduleUnlockMutation,
  useRejectScheduleUnlockMutation,
} from '@/features/admin-schedule/hooks';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { WeeklyScheduleGrid } from '@/features/schedule/components/WeeklyScheduleGrid';
import { cellKey } from '@/features/schedule/types';
import { formatWeekRangeLabel, getWeekStartDate } from '@/features/schedule/dates';
import { usePeriods } from '@/hooks/usePeriods';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import type { ScheduleUnlockRequest } from '@/features/admin-schedule/api';

type Tab = 'student' | 'date' | 'week' | 'unlock';

const TABS: { key: Tab; label: string }[] = [
  { key: 'student', label: '학생별 조회' },
  { key: 'date', label: '날짜별 조회' },
  { key: 'week', label: '주간 제출현황' },
  { key: 'unlock', label: '수정 요청' },
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

function UnlockTab() {
  const { user } = useAuth();
  const adminId = user!.id;

  const { data: requests, isLoading } = useScheduleUnlockRequestsQuery();
  const approve = useApproveScheduleUnlockMutation();
  const reject = useRejectScheduleUnlockMutation();

  const [actionTarget, setActionTarget] = useState<{
    req: ScheduleUnlockRequest;
    action: 'approve' | 'reject';
  } | null>(null);
  const [adminNote, setAdminNote] = useState('');

  const pendingCount = (requests ?? []).filter((r) => r.status === 'pending').length;

  const statusTone = (status: string) => {
    if (status === 'approved') return 'success' as const;
    if (status === 'rejected') return 'danger' as const;
    return 'warning' as const;
  };
  const statusLabel = (status: string) => {
    if (status === 'approved') return '승인';
    if (status === 'rejected') return '반려';
    return '대기';
  };

  async function handleConfirm() {
    if (!actionTarget) return;
    const { req, action } = actionTarget;
    if (action === 'approve') {
      await approve.mutateAsync({ requestId: req.id, adminId, adminNote: adminNote.trim() || undefined });
    } else {
      await reject.mutateAsync({ requestId: req.id, adminId, adminNote: adminNote.trim() || undefined });
    }
    setActionTarget(null);
    setAdminNote('');
  }

  if (isLoading) {
    return <div className="flex justify-center py-8"><Spinner /></div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">시간표 수정 권한 요청</span>
        {pendingCount > 0 && <Badge tone="warning">대기 {pendingCount}건</Badge>}
      </div>

      {!requests || requests.length === 0 ? (
        <EmptyState title="수정 권한 요청이 없습니다" />
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((req) => (
            <Card key={req.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{req.studentName}</span>
                    <Badge tone={statusTone(req.status)}>{statusLabel(req.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    대상 주차: <span className="font-medium">{formatWeekRangeLabel(req.weekStartDate)}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">사유: {req.reason}</p>
                  {req.adminNote && (
                    <p className="mt-0.5 text-sm text-red-500">관리자 메모: {req.adminNote}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    신청일: {new Date(req.createdAt).toLocaleDateString('ko-KR')}
                  </p>
                  {req.reviewedAt && (
                    <p className="text-xs text-gray-400">
                      처리일: {new Date(req.reviewedAt).toLocaleDateString('ko-KR')}
                    </p>
                  )}
                </div>
                {req.status === 'pending' && (
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="primary"
                      className="px-3 py-1 text-xs"
                      onClick={() => { setActionTarget({ req, action: 'approve' }); setAdminNote(''); }}
                    >
                      승인
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1 text-xs"
                      onClick={() => { setActionTarget({ req, action: 'reject' }); setAdminNote(''); }}
                    >
                      반려
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={actionTarget?.action === 'approve' ? '수정 권한 승인' : '수정 권한 반려'}
      >
        {actionTarget && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{actionTarget.req.studentName}</span>님의 시간표 수정 권한 요청을{' '}
              {actionTarget.action === 'approve' ? '승인' : '반려'}하겠습니까?
            </p>
            <p className="text-xs text-gray-500">
              대상 주: {formatWeekRangeLabel(actionTarget.req.weekStartDate)}
            </p>
            <FormField label="관리자 메모 (선택)" htmlFor="admin-note">
              <Input
                id="admin-note"
                placeholder={actionTarget.action === 'reject' ? '반려 사유를 입력하세요' : '메모 (선택)'}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setActionTarget(null)}>
                취소
              </Button>
              <Button
                variant={actionTarget.action === 'approve' ? 'primary' : 'danger'}
                className="flex-1"
                onClick={handleConfirm}
                disabled={approve.isPending || reject.isPending}
              >
                {approve.isPending || reject.isPending
                  ? '처리 중...'
                  : actionTarget.action === 'approve'
                  ? '승인'
                  : '반려'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function SchedulesPage() {
  const [tab, setTab] = useState<Tab>('student');

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-900">시간표 관리</h2>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'student' && <StudentTab />}
      {tab === 'date' && <DateTab />}
      {tab === 'week' && <WeekTab />}
      {tab === 'unlock' && <UnlockTab />}
    </div>
  );
}
