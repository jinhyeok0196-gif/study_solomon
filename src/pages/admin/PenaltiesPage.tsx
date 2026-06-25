import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { useStudentsQuery } from '@/features/admin-students/hooks';
import { useCreatePenaltyMutation, usePenaltyRecordsFeedQuery } from '@/features/admin-penalty/hooks';
import { createPenaltySchema, type CreatePenaltyFormValues } from '@/features/admin-penalty/schema';
import { PENALTY_POINTS, PENALTY_REASON_LABEL, type PenaltyReasonCode } from '@/constants/penaltyRules';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';

const REASON_CODES = Object.keys(PENALTY_POINTS) as PenaltyReasonCode[];

export default function PenaltiesPage() {
  const { user } = useAuth();
  const { data: students } = useStudentsQuery();
  const { data: records } = usePenaltyRecordsFeedQuery();
  const mutation = useCreatePenaltyMutation();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreatePenaltyFormValues>({
    resolver: zodResolver(createPenaltySchema),
    defaultValues: { adjustmentType: 'add' },
  });

  const selectedReasonCode = watch('reasonCode');

  const onSubmit = async (values: CreatePenaltyFormValues) => {
    await mutation.mutateAsync({ ...values, createdBy: user!.id });
    reset({ adjustmentType: 'add' });
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-gray-900">벌점 관리</h2>

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="학생" htmlFor="studentId" error={errors.studentId?.message}>
            <select id="studentId" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" {...register('studentId')}>
              <option value="">학생 선택</option>
              {(students ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} ({student.phone})
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="구분" htmlFor="adjustmentType" error={errors.adjustmentType?.message}>
            <select id="adjustmentType" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" {...register('adjustmentType')}>
              <option value="add">벌점 추가</option>
              <option value="subtract">벌점 차감</option>
            </select>
          </FormField>

          <FormField label="사유" htmlFor="reasonCode" error={errors.reasonCode?.message}>
            <select id="reasonCode" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" {...register('reasonCode')}>
              <option value="">사유 선택</option>
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {PENALTY_REASON_LABEL[code]} ({PENALTY_POINTS[code]}점)
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="상세 메모(선택)" htmlFor="description" error={errors.description?.message}>
            <input
              id="description"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              {...register('description')}
            />
          </FormField>

          {selectedReasonCode && (
            <p className="col-span-full text-sm text-gray-500">
              적용 점수: {PENALTY_POINTS[selectedReasonCode as PenaltyReasonCode]}점
            </p>
          )}

          <Button type="submit" disabled={isSubmitting} className="md:col-span-2">
            {isSubmitting ? '처리 중...' : '적용'}
          </Button>
        </form>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">최근 벌점 내역</h3>
        {!records || records.length === 0 ? (
          <EmptyState title="벌점 내역이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {records.map((record) => (
              <li
                key={record.id}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">{record.studentName}</p>
                  <p className="text-xs text-gray-500">
                    {PENALTY_REASON_LABEL[record.reasonCode as PenaltyReasonCode] ?? record.reasonCode} ·{' '}
                    {new Date(record.createdAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <Badge tone={record.adjustmentType === 'add' ? 'danger' : 'success'}>
                  {record.adjustmentType === 'add' ? '+' : '-'}
                  {record.points}점
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
