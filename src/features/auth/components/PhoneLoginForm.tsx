import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { loginSchema, type LoginFormValues } from '@/features/auth/schema';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import type { UserRole } from '@/types/domain';

interface PhoneLoginFormProps {
  expectedRole: UserRole;
  wrongRoleMessage: string;
  redirectTo: string;
}

export function PhoneLoginForm({ expectedRole, wrongRoleMessage, redirectTo }: PhoneLoginFormProps) {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginFormValues) => {
    setFormError(null);
    try {
      const user = await login(values.phone, values.password);
      if (user.role !== expectedRole) {
        await logout();
        setFormError(wrongRoleMessage);
        return;
      }
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '로그인에 실패했습니다.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex w-full max-w-sm flex-col gap-4">
      <FormField label="전화번호" htmlFor="phone" error={errors.phone?.message}>
        <Input id="phone" type="tel" placeholder="01012345678" autoComplete="tel" {...register('phone')} />
      </FormField>
      <FormField label="비밀번호" htmlFor="password" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
        />
      </FormField>
      {formError && <p className="text-sm text-red-600">{formError}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? '로그인 중...' : '로그인'}
      </Button>
    </form>
  );
}
