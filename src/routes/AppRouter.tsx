import { Routes, Route } from 'react-router-dom';
import { StudentLayout } from '@/components/layout/StudentLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';
import { RoleGuard } from '@/components/shared/RoleGuard';
import { NotFoundPage } from '@/components/shared/NotFoundPage';
import { STUDENT_PATHS, ADMIN_PATHS } from '@/routes/paths';

import StudentLoginPage from '@/pages/student/LoginPage';
import StudentDashboardPage from '@/pages/student/DashboardPage';
import SchedulePage from '@/pages/student/SchedulePage';
import ScheduleHistoryPage from '@/pages/student/ScheduleHistoryPage';
import StudentAttendancePage from '@/pages/student/AttendancePage';
import AbsenceRequestPage from '@/pages/student/AbsenceRequestPage';
import LeaveRequestPage from '@/pages/student/LeaveRequestPage';
import OutingPage from '@/pages/student/OutingPage';
import PowerNapPage from '@/pages/student/PowerNapPage';
import PenaltyPage from '@/pages/student/PenaltyPage';
import MyPage from '@/pages/student/MyPage';
import StudentChatPage from '@/pages/student/ChatPage';

import AuthCallbackPage from '@/pages/auth/CallbackPage';
import AuthRegisterPage from '@/pages/auth/RegisterPage';
import AdminLoginPage from '@/pages/admin/LoginPage';
import AdminDashboardPage from '@/pages/admin/DashboardPage';
import StudentsPage from '@/pages/admin/StudentsPage';
import StudentDetailPage from '@/pages/admin/StudentDetailPage';
import AdminSchedulesPage from '@/pages/admin/SchedulesPage';
import AdminAttendancePage from '@/pages/admin/AttendancePage';
import PenaltiesPage from '@/pages/admin/PenaltiesPage';
import WarningsPage from '@/pages/admin/WarningsPage';
import NotificationsPage from '@/pages/admin/NotificationsPage';
import RequestsPage from '@/pages/admin/RequestsPage';
import AdminChatPage from '@/pages/admin/ChatPage';
import AdminMonitorPage from '@/pages/admin/MonitorPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<StudentLoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/register" element={<AuthRegisterPage />} />

      <Route
        element={
          <ProtectedRoute redirectTo={STUDENT_PATHS.login}>
            <RoleGuard role="student" fallback={ADMIN_PATHS.dashboard}>
              <StudentLayout />
            </RoleGuard>
          </ProtectedRoute>
        }
      >
        <Route index element={<StudentDashboardPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/schedule/history" element={<ScheduleHistoryPage />} />
        <Route path="/attendance" element={<StudentAttendancePage />} />
        <Route path="/absence-requests/new" element={<AbsenceRequestPage />} />
        <Route path="/leave-requests/new" element={<LeaveRequestPage />} />
        <Route path="/outing" element={<OutingPage />} />
        <Route path="/power-nap" element={<PowerNapPage />} />
        <Route path="/penalty" element={<PenaltyPage />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="/chat" element={<StudentChatPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute redirectTo={ADMIN_PATHS.login}>
            <RoleGuard role="admin" fallback={STUDENT_PATHS.dashboard}>
              <AdminLayout />
            </RoleGuard>
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="students/:studentId" element={<StudentDetailPage />} />
        <Route path="schedules" element={<AdminSchedulesPage />} />
        <Route path="attendance" element={<AdminAttendancePage />} />
        <Route path="penalties" element={<PenaltiesPage />} />
        <Route path="warnings" element={<WarningsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="chat" element={<AdminChatPage />} />
        <Route path="monitor" element={<AdminMonitorPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
