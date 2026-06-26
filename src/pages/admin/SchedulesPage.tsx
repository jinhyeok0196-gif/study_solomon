import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
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
import { usePeriods, type PeriodRow } from '@/hooks/usePeriods';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import type { ScheduleUnlockRequest } from '@/features/admin-schedule/api';

type Tab = 'student' | 'date' | 'week' | 'unlock' | 'periods';

const TABS: { key: Tab; label: string }[] = [
  { key: 'student', label: '학생별 조회' },
  { key: 'date', label: '날짜별 조회' },
  { key: 'week', label: '주간 제출현황' },
  { key: 'unlock', label: '수정 요청' },
  { key: 'periods', label: '교시 설정' },
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

const CATEGORY_LABEL: Record<string, string> = {
  class: '수업',
  meal: '식사',
  arrival: '등원',
  free: '자율학습',
};

function PeriodsTab() {
  const qc = useQueryClient();
  const { data: periods, isLoading } = usePeriods();
  const [editing, setEditing] = useState<PeriodRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<PeriodRow>>({});

  function openEdit(period: PeriodRow) {
    setEditing(period);
    setEditForm({ ...period });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('periods')
        .update({
          display_name: editForm.display_name,
          start_time: editForm.start_time,
          end_time: editForm.end_time,
          duration_minutes: editForm.duration_minutes,
          display_color: editForm.display_color,
          sort_order: editForm.sort_order,
          is_selectable: editForm.is_selectable,
        })
        .eq('period_number', editing.period_number);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['periods'] });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-8"><Spinner /></div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">교시 정보를 수정하면 시간표 UI에 즉시 반영됩니다.</p>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">순서</th>
              <th className="px-3 py-2">교시명</th>
              <th className="px-3 py-2">시간</th>
              <th className="px-3 py-2">시간(분)</th>
              <th className="px-3 py-2">구분</th>
              <th className="px-3 py-2">색상</th>
              <th className="px-3 py-2">선택가능</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(periods ?? []).map((period) => (
              <tr key={period.period_number} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-500">{period.sort_order}</td>
                <td className="px-3 py-2 font-medium">{period.display_name}</td>
                <td className="px-3 py-2 text-gray-600">
                  {period.start_time.slice(0, 5)}~{period.end_time.slice(0, 5)}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {period.duration_minutes != null ? `${period.duration_minutes}분` : '-'}
                </td>
                <td className="px-3 py-2">
                  <Badge>{CATEGORY_LABEL[period.category] ?? period.category}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <div
                      style={{ backgroundColor: period.display_color }}
                      className="w-4 h-4 rounded-full border border-gray-200 inline-block flex-shrink-0"
                    />
                    <span className="text-xs text-gray-500">{period.display_color}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {period.is_selectable ? (
                    <Badge tone="success">가능</Badge>
                  ) : (
                    <Badge tone="default">불가</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => openEdit(period)}>
                    수정
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="교시 설정 수정">
        {editing && (
          <div className="flex flex-col gap-3">
            <FormField label="교시명" htmlFor="edit-display-name">
              <Input
                id="edit-display-name"
                value={editForm.display_name ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="시작 시간 (HH:MM)" htmlFor="edit-start">
                <Input
                  id="edit-start"
                  value={editForm.start_time?.slice(0, 5) ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, start_time: e.target.value }))}
                  placeholder="09:00"
                />
              </FormField>
              <FormField label="종료 시간 (HH:MM)" htmlFor="edit-end">
                <Input
                  id="edit-end"
                  value={editForm.end_time?.slice(0, 5) ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, end_time: e.target.value }))}
                  placeholder="10:20"
                />
              </FormField>
            </div>
            <FormField label="수업 시간 (분)" htmlFor="edit-duration">
              <Input
                id="edit-duration"
                type="number"
                value={editForm.duration_minutes ?? ''}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    duration_minutes: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
              />
            </FormField>
            <FormField label="표시 색상" htmlFor="edit-color">
              <div className="flex items-center gap-2">
                <input
                  id="edit-color"
                  type="color"
                  value={editForm.display_color ?? '#16a34a'}
                  onChange={(e) => setEditForm((f) => ({ ...f, display_color: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded border border-gray-300 p-1"
                />
                <span className="text-sm text-gray-600">{editForm.display_color}</span>
              </div>
            </FormField>
            <FormField label="표시 순서" htmlFor="edit-sort">
              <Input
                id="edit-sort"
                type="number"
                value={editForm.sort_order ?? 0}
                onChange={(e) => setEditForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.is_selectable ?? false}
                onChange={(e) => setEditForm((f) => ({ ...f, is_selectable: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              학생 신청 가능 교시
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
                취소
              </Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
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
      {tab === 'periods' && <PeriodsTab />}
    </div>
  );
}
