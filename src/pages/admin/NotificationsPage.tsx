import { useAdminNotificationsQuery, useMarkNotificationReadMutation } from '@/features/notifications/hooks';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

const NOTIFICATIONS_KEY = ['admin-notifications'];

export default function NotificationsPage() {
  const { data: notifications, isLoading } = useAdminNotificationsQuery();
  const markReadMutation = useMarkNotificationReadMutation();

  useRealtimeTableSync('notifications', [NOTIFICATIONS_KEY]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-900">알림 센터</h2>
      <p className="text-sm text-gray-500">
        외출/복귀, 파워냅 시작/종료, 무단결석, 경고/퇴원 발생 시 알림이 실시간으로 도착합니다.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !notifications || notifications.length === 0 ? (
        <EmptyState title="알림이 없습니다" />
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900">{notification.title}</p>
                  {!notification.is_read && <Badge tone="warning">읽지 않음</Badge>}
                </div>
                <p className="text-gray-500">{notification.message}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {new Date(notification.created_at).toLocaleString('ko-KR')}
                </p>
              </div>
              {!notification.is_read && (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={markReadMutation.isPending}
                  onClick={() => markReadMutation.mutate(notification.id)}
                >
                  읽음 처리
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
