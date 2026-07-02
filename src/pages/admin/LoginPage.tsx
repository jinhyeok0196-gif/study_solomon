import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PhoneLoginForm } from '@/features/auth/components/PhoneLoginForm';
import { GoogleLoginButton } from '@/features/auth/components/GoogleLoginButton';
import { STUDENT_PATHS, ADMIN_PATHS } from '@/routes/paths';
import { APP_NAME, APP_TAGLINE, TESTBED_LABEL } from '@/lib/brand';

export default function LoginPage() {
  const { user, isLoading } = useAuth();

  if (!isLoading && user) {
    return <Navigate to={user.role === 'admin' ? ADMIN_PATHS.dashboard : STUDENT_PATHS.dashboard} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-100 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-gray-600">{APP_TAGLINE}</p>
        <p className="mt-2 text-xs text-gray-400">{TESTBED_LABEL} · 관리자 전화번호로 로그인해주세요.</p>
      </div>
      <PhoneLoginForm
        expectedRole="admin"
        wrongRoleMessage="학생 계정입니다. 학생 로그인 페이지를 이용해주세요."
        redirectTo={ADMIN_PATHS.dashboard}
      />
      <div className="flex w-full max-w-sm items-center gap-3">
        <hr className="flex-1 border-gray-300" />
        <span className="text-xs text-gray-400">또는</span>
        <hr className="flex-1 border-gray-300" />
      </div>
      <div className="w-full max-w-sm">
        <GoogleLoginButton />
      </div>
    </div>
  );
}
