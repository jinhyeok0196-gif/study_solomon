import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ADMIN_PATHS } from '@/routes/paths';

const NAV_GROUPS: { title: string; items: { to: string; label: string }[] }[] = [
  {
    title: '현황',
    items: [
      { to: ADMIN_PATHS.dashboard, label: '대시보드' },
      { to: ADMIN_PATHS.monitor, label: '실시간 관제' },
      { to: ADMIN_PATHS.checkinQr, label: '등하원 QR' },
    ],
  },
  {
    title: '학생·운영',
    items: [
      { to: ADMIN_PATHS.students, label: '학생 관리' },
      { to: ADMIN_PATHS.requests, label: '회원 요청 관리' },
      { to: ADMIN_PATHS.schedules, label: '시간표 관리' },
    ],
  },
  {
    title: '출결·상벌',
    items: [
      { to: ADMIN_PATHS.attendance, label: '출석 관리' },
      { to: ADMIN_PATHS.attendanceRequests, label: '결석·조퇴·외출' },
      { to: ADMIN_PATHS.penalties, label: '벌점·경고 관리' },
    ],
  },
  {
    title: '소통·게시',
    items: [
      { to: ADMIN_PATHS.notices, label: '공지사항·이용수칙' },
      { to: ADMIN_PATHS.board, label: '불만·건의 게시판' },
      { to: ADMIN_PATHS.chat, label: '학생 문의' },
      { to: ADMIN_PATHS.notifications, label: '알림' },
    ],
  },
];

export function AdminSidebar() {
  return (
    <aside className="hidden w-56 flex-col gap-4 border-r border-gray-200 bg-white p-4 md:flex">
      <p className="px-2 text-lg font-bold text-brand-700">솔로몬스터디카페</p>
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {group.title}
          </p>
          {group.items.map((item) => (
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
        </div>
      ))}
    </aside>
  );
}
