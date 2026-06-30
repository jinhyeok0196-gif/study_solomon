import { Outlet } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { Header } from './Header';
import { FloatingNotificationProvider } from '@/components/FloatingNotification';
import { AdminChatNotifier } from '@/features/chat/components/ChatNotifier';
import { ApprovalPopup } from '@/features/admin-approvals/components/ApprovalPopup';

export function AdminLayout() {
  return (
    <FloatingNotificationProvider>
      <div className="flex min-h-screen bg-gray-100">
        <AdminSidebar />
        <div className="flex flex-1 flex-col">
          <Header title="관리자" />
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <AdminChatNotifier />
      <ApprovalPopup />
    </FloatingNotificationProvider>
  );
}
