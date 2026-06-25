import { useDashboardSummaryQuery } from '@/features/admin-dashboard/hooks';
import { useAdminNotificationsQuery } from '@/features/notifications/hooks';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

const SUMMARY_CARDS = [
  { key: 'expectedTodayCount', label: '오늘 출석 예정' },
  { key: 'presentNowCount', label: '현재 착석 인원' },
  { key: 'outingNowCount', label: '현재 외출 인원' },
  { key: 'powerNapNowCount', label: '현재 파워냅 인원' },
  { key: 'absentTodayCount', label: '오늘 결석' },
  { key: 'lateTodayCount', label: '오늘 지각' },
  { key: 'totalStudents', label: '총 회원 수' },
] as const;

export default function DashboardPage() {
  const { data: summary, isLoading } = useDashboardSummaryQuery();
  const { data: notifications } = useAdminNotificationsQuery();
  const recentNotifications = notifications?.slice(0, 5);

  if (isLoading || !summary) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-gray-900">관리자 대시보드</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <Card key={card.key}>
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className="text-2xl font-bold text-gray-900">{summary[card.key]}명</p>
          </Card>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">최근 알림</h3>
        {!recentNotifications || recentNotifications.length === 0 ? (
          <EmptyState title="최근 알림이 없습니다" description="실시간 알림은 6단계에서 연동됩니다." />
        ) : (
          <ul className="flex flex-col gap-2">
            {recentNotifications.map((notification) => (
              <li key={notification.id} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                <p className="font-medium text-gray-900">{notification.title}</p>
                <p className="text-gray-500">{notification.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
