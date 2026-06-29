import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ADMIN_PATHS } from '@/routes/paths';

const NAV_ITEMS = [
  { to: ADMIN_PATHS.dashboard, label: '대시보드' },
  { to: ADMIN_PATHS.monitor, label: '실시간 관제' },
  { to: ADMIN_PATHS.checkinQr, label: '등하원 QR' },
  { to: ADMIN_PATHS.students, label: '학생 관리' },
  { to: ADMIN_PATHS.schedules, label: '시간표 관리' },
  { to: ADMIN_PATHS.attendance, label: '출석 관리' },
  { to: ADMIN_PATHS.penalties, label: '벌점 관리' },
  { to: ADMIN_PATHS.warnings, label: '경고 관리' },
  { to: ADMIN_PATHS.notifications, label: '알림' },
  { to: ADMIN_PATHS.requests, label: '회원 요청 관리' },
  { to: ADMIN_PATHS.chat, label: '학생 문의' },
];

export function AdminSidebar() {
  return (
    <aside className="hidden w-56 flex-col gap-1 border-r border-gray-200 bg-white p-4 md:flex">
      <p className="mb-4 px-2 text-lg font-bold text-brand-700">솔로몬스터디카페</p>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === ADMIN_PATHS.dashboard}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-2 text-sm font-medium',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </aside>
  );
}
