import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { updateStudentSchema, type UpdateStudentFormValues } from '../schema';
import { useUpdateStudentMutation } from '../hooks';
import type { StudentSummary } from '../types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';

export function EditStudentForm({ student }: { student: StudentSummary }) {
  const mutation = useUpdateStudentMutation(student.id);
  const [message, setMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateStudentFormValues>({
    resolver: zodResolver(updateStudentSchema),
    defaultValues: {
      name: student.name,
      phone: student.phone,
      userStatus: student.userStatus as UpdateStudentFormValues['userStatus'],
      school: student.school ?? '',
      grade: student.grade ?? '',
      studentNumber: student.studentNumber ?? '',
      guardianPhone: student.guardianPhone ?? '',
      membershipStatus: student.membershipStatus as UpdateStudentFormValues['membershipStatus'],
      memo: student.memo ?? '',
    },
  });

  const onSubmit = async (values: UpdateStudentFormValues) => {
    setMessage(null);
    await mutation.mutateAsync({
      name: values.name,
      phone: values.phone,
      userStatus: values.userStatus,
      school: values.school ?? null,
      grade: values.grade ?? null,
      studentNumber: values.studentNumber ?? null,
      guardianPhone: values.guardianPhone ?? null,
      membershipStatus: values.membershipStatus,
      memo: values.memo ?? null,
    });
    setMessage('저장되었습니다.');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <FormField label="이름" htmlFor="name" error={errors.name?.message}>
        <Input id="name" {...register('name')} />
      </FormField>
      <FormField label="전화번호" htmlFor="phone" error={errors.phone?.message}>
        <Input id="phone" {...register('phone')} />
      </FormField>
      <FormField label="학교" htmlFor="school" error={errors.school?.message}>
        <Input id="school" {...register('school')} />
      </FormField>
      <FormField label="학년" htmlFor="grade" error={errors.grade?.message}>
        <Input id="grade" {...register('grade')} />
      </FormField>
      <FormField label="보호자 연락처" htmlFor="guardianPhone" error={errors.guardianPhone?.message}>
        <Input id="guardianPhone" {...register('guardianPhone')} />
      </FormField>
      <FormField label="회원 상태" htmlFor="membershipStatus" error={errors.membershipStatus?.message}>
        <select id="membershipStatus" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" {...register('membershipStatus')}>
          <option value="active">재원</option>
          <option value="paused">휴원</option>
          <option value="expelled">퇴원</option>
        </select>
      </FormField>
      <FormField label="메모" htmlFor="memo" error={errors.memo?.message}>
        <Input id="memo" {...register('memo')} />
      </FormField>
      {message && <p className="col-span-full text-sm text-brand-700">{message}</p>}
      <Button type="submit" disabled={isSubmitting} className="md:col-span-2">
        {isSubmitting ? '저장 중...' : '저장'}
      </Button>
    </form>
  );
}
