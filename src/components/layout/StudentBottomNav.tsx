import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { STUDENT_PATHS } from '@/routes/paths';

const NAV_ITEMS = [
  { to: STUDENT_PATHS.dashboard, label: '홈' },
  { to: STUDENT_PATHS.schedule, label: '시간표' },
  { to: STUDENT_PATHS.chat, label: '문의' },
  { to: STUDENT_PATHS.mypage, label: 'MY' },
];

export function StudentBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 grid grid-cols-4 border-t border-gray-200 bg-white">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === STUDENT_PATHS.dashboard}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-1 py-2 text-xs',
              isActive ? 'font-semibold text-brand-600' : 'text-gray-500'
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
