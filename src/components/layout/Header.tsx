import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { LiveClock } from '@/components/schedule/LiveClock';
import { STUDENT_PATHS, ADMIN_PATHS } from '@/routes/paths';

interface HeaderProps {
  title: string;
  /** 제목 클릭 시 이동할 경로 (지정 시 제목이 링크가 된다) */
  titleTo?: string;
}

export function Header({ title, titleTo }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(user?.role === 'admin' ? ADMIN_PATHS.login : STUDENT_PATHS.login, { replace: true });
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
      {titleTo ? (
        <Link to={titleTo} className="text-base font-semibold text-gray-900 hover:text-brand-700">
          {title}
        </Link>
      ) : (
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      )}
      <div className="flex items-center gap-3">
        {user?.role === 'student' && <LiveClock />}
        {user && (
          <>
            <span className="hidden text-sm text-gray-500 sm:block">{user.name}님</span>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={handleLogout}>
              로그아웃
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
