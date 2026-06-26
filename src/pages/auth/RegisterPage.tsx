import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase/client';
import { createStudentProfile, signOutCurrentUser } from '@/features/auth/api';
import { useAuthContext } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import { isValidPhone } from '@/features/auth/phone';
import { STUDENT_PATHS } from '@/routes/paths';

const schema = z.object({
  name: z.string().min(1, '실명을 입력해주세요.'),
  phone: z
    .string()
    .min(1, '전화번호를 입력해주세요.')
    .refine(isValidPhone, '올바른 휴대폰 번호 형식이 아닙니다. (예: 01012345678)'),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthContext();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error('세션이 만료됐습니다. 다시 로그인해주세요.');

      const profile = await createStudentProfile(data.user.id, values.name, values.phone);
      setUser(profile);
      navigate(STUDENT_PATHS.dashboard, { replace: true });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '가입에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleCancel = async () => {
    await signOutCurrentUser();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">추가 정보 입력</h1>
        <p className="mt-1 text-sm text-gray-500">실명과 전화번호를 입력해주세요.</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="flex w-full max-w-sm flex-col gap-4">
        <FormField label="실명" htmlFor="name" error={errors.name?.message}>
          <Input id="name" type="text" placeholder="홍길동" autoComplete="off" {...register('name')} />
        </FormField>
        <FormField label="전화번호" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" placeholder="01012345678" {...register('phone')} />
        </FormField>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '가입 중...' : '가입 완료'}
        </Button>
        <Button type="button" variant="ghost" onClick={handleCancel}>
          취소
        </Button>
      </form>
    </div>
  );
}
