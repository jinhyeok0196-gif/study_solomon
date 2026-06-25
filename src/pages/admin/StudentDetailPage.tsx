import { useNavigate, useParams } from 'react-router-dom';
import { useStudentDetailQuery, useDeleteStudentMutation } from '@/features/admin-students/hooks';
import { EditStudentForm } from '@/features/admin-students/components/EditStudentForm';
import { getWeekStartDate } from '@/features/schedule/dates';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { WeeklyScheduleGrid } from '@/features/schedule/components/WeeklyScheduleGrid';
import { cellKey } from '@/features/schedule/types';
import { usePenaltyRecordsQuery, useWarningRecordsQuery } from '@/features/penalty/hooks';
import { computeRiskLevel } from '@/features/penalty/risk';
import { PENALTY_REASON_LABEL, type PenaltyReasonCode } from '@/constants/penaltyRules';
import { ADMIN_PATHS } from '@/routes/paths';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

export default function StudentDetailPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const { data: student, isLoading } = useStudentDetailQuery(studentId!);
  const { data: weeklySchedule } = useWeeklyScheduleQuery(studentId!, getWeekStartDate(0));
  const { data: penaltyRecords } = usePenaltyRecordsQuery(studentId!);
  const { data: warningRecords } = useWarningRecordsQuery(studentId!);
  const deleteMutation = useDeleteStudentMutation();

  if (isLoading || !student) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const risk = computeRiskLevel(student.currentPenaltyPoints);
  const selectedCells = new Set(
    (weeklySchedule?.cells ?? []).map((cell) => cellKey(cell.dayOfWeek, cell.periodNumber))
  );

  const handleDelete = async () => {
    if (!window.confirm(`${student.name} 학생 계정을 완전히 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    await deleteMutation.mutateAsync(student.id);
    navigate(ADMIN_PATHS.students);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{student.name}</h2>
          <p className="text-sm text-gray-500">{student.phone}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={risk.tone}>{risk.label}</Badge>
          <Button variant="danger" disabled={deleteMutation.isPending} onClick={handleDelete}>
            학생 삭제
          </Button>
        </div>
      </div>

      <Card>
        <p className="mb-3 text-sm font-semibold text-gray-700">정보 수정</p>
        <EditStudentForm student={student} />
      </Card>

      <Card>
        <p className="mb-3 text-sm font-semibold text-gray-700">이번주 시간표</p>
        <WeeklyScheduleGrid selected={selectedCells} readOnly />
      </Card>

      <Card>
        <p className="mb-3 text-sm font-semibold text-gray-700">벌점 이력</p>
        {!penaltyRecords || penaltyRecords.length === 0 ? (
          <EmptyState title="벌점 이력이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {penaltyRecords.map((record) => (
              <li key={record.id} className="flex items-center justify-between text-sm">
                <span>
                  {PENALTY_REASON_LABEL[record.reason_code as PenaltyReasonCode] ?? record.reason_code} ·{' '}
                  {new Date(record.created_at).toLocaleDateString('ko-KR')}
                </span>
                <Badge tone={record.adjustment_type === 'add' ? 'danger' : 'success'}>
                  {record.adjustment_type === 'add' ? '+' : '-'}
                  {record.points}점
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-sm font-semibold text-gray-700">경고 이력</p>
        {!warningRecords || warningRecords.length === 0 ? (
          <EmptyState title="경고 이력이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {warningRecords.map((record) => (
              <li key={record.id} className="flex items-center justify-between text-sm">
                <span>{new Date(record.issued_at).toLocaleDateString('ko-KR')}</span>
                <Badge tone="danger">{record.warning_level === 3 ? '퇴원' : `${record.warning_level}차 경고`}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
