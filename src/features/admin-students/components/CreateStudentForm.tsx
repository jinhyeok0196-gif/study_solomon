import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { createStudentSchema, type CreateStudentFormValues } from '../schema';
import { useCreateStudentMutation } from '../hooks';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';

export function CreateStudentForm({ onCreated }: { onCreated?: () => void }) {
  const mutation = useCreateStudentMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateStudentFormValues>({ resolver: zodResolver(createStudentSchema) });

  const onSubmit = async (values: CreateStudentFormValues) => {
    setFormError(null);
    try {
      await mutation.mutateAsync(values);
      reset();
      onCreated?.();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '학생 등록에 실패했습니다.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <FormField label="이름" htmlFor="name" error={errors.name?.message}>
        <Input id="name" {...register('name')} />
      </FormField>
      <FormField label="전화번호" htmlFor="phone" error={errors.phone?.message}>
        <Input id="phone" placeholder="01012345678" {...register('phone')} />
      </FormField>
      <FormField label="초기 비밀번호" htmlFor="password" error={errors.password?.message}>
        <Input id="password" type="password" {...register('password')} />
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
      {formError && <p className="col-span-full text-sm text-red-600">{formError}</p>}
      <Button type="submit" disabled={isSubmitting} className="md:col-span-2">
        {isSubmitting ? '등록 중...' : '학생 등록'}
      </Button>
    </form>
  );
}
