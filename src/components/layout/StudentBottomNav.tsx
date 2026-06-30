import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { STUDENT_PATHS } from '@/routes/paths';

const NAV_ITEMS = [
  { to: STUDENT_PATHS.dashboard, label: '홈', icon: '🏠' },
  { to: STUDENT_PATHS.schedule, label: '시간표', icon: '📅' },
  { to: STUDENT_PATHS.chat, label: '문의', icon: '💬' },
  { to: STUDENT_PATHS.mypage, label: 'MY', icon: '👤' },
];

export function StudentBottomNav({ restricted = false }: { restricted?: boolean }) {
  // 회원권 미설정/만료 시에는 문의(채팅)만 노출한다.
  const items = restricted
    ? NAV_ITEMS.filter((item) => item.to === STUDENT_PATHS.chat)
    : NAV_ITEMS;
  return (
    <nav
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="fixed bottom-0 left-0 right-0 z-40 grid border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(0,0,0,0.06)]"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === STUDENT_PATHS.dashboard}
          className={({ isActive }) =>
            cn(
              'relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
              isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700'
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-600" />
              )}
              <span className="text-xl leading-none">{item.icon}</span>
              <span className={cn(isActive && 'font-semibold')}>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
