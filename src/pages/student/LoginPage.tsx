import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PhoneLoginForm } from '@/features/auth/components/PhoneLoginForm';
import { STUDENT_PATHS, ADMIN_PATHS } from '@/routes/paths';

export default function LoginPage() {
  const { user, isLoading } = useAuth();

  if (!isLoading && user) {
    return <Navigate to={user.role === 'admin' ? ADMIN_PATHS.dashboard : STUDENT_PATHS.dashboard} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">솔로몬스터디카페</h1>
        <p className="mt-1 text-sm text-gray-500">전화번호로 로그인해주세요.</p>
      </div>
      <PhoneLoginForm
        expectedRole="student"
        wrongRoleMessage="관리자 계정입니다. 관리자 로그인 페이지를 이용해주세요."
        redirectTo={STUDENT_PATHS.dashboard}
      />
    </div>
  );
}
