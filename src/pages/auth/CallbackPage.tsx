import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { fetchUserProfile } from '@/features/auth/api';
import { STUDENT_PATHS, ADMIN_PATHS } from '@/routes/paths';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !data.session) {
        setError('로그인에 실패했습니다. 다시 시도해주세요.');
        return;
      }

      const profile = await fetchUserProfile(data.session.user.id).catch(() => null);

      if (!profile) {
        navigate('/auth/register', { replace: true });
        return;
      }

      navigate(profile.role === 'admin' ? ADMIN_PATHS.dashboard : STUDENT_PATHS.dashboard, {
        replace: true,
      });
    }

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-sm text-red-600">{error}</p>
        <a href="/login" className="text-sm text-brand-600 underline">
          로그인 페이지로 돌아가기
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">로그인 처리 중...</p>
    </div>
  );
}
