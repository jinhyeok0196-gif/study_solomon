import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { StudentBottomNav } from './StudentBottomNav';
import { FloatingNotificationProvider } from '@/components/FloatingNotification';
import { StudentChatNotifier } from '@/features/chat/components/ChatNotifier';
import { StudentNotificationNotifier } from '@/features/notifications/components/StudentNotificationNotifier';
import { STUDENT_PATHS } from '@/routes/paths';

export function StudentLayout() {
  return (
    <FloatingNotificationProvider>
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header title="솔로몬스터디카페" titleTo={STUDENT_PATHS.dashboard} />
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <Outlet />
        </main>
        <StudentBottomNav />
      </div>
      <StudentChatNotifier />
      <StudentNotificationNotifier />
    </FloatingNotificationProvider>
  );
}
