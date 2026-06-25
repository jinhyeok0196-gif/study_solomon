import { Routes, Route } from 'react-router-dom';
import { StudentLayout } from '@/components/layout/StudentLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';
import { RoleGuard } from '@/components/shared/RoleGuard';
import { NotFoundPage } from '@/components/shared/NotFoundPage';

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

import AdminLoginPage from '@/pages/admin/LoginPage';
import AdminDashboardPage from '@/pages/admin/DashboardPage';
import StudentsPage from '@/pages/admin/StudentsPage';
import StudentDetailPage from '@/pages/admin/StudentDetailPage';
import AdminSchedulesPage from '@/pages/admin/SchedulesPage';
import AdminAttendancePage from '@/pages/admin/AttendancePage';
import PenaltiesPage from '@/pages/admin/PenaltiesPage';
import WarningsPage from '@/pages/admin/WarningsPage';
import NotificationsPage from '@/pages/admin/NotificationsPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<StudentLoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <RoleGuard role="student">
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
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <RoleGuard role="admin">
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
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
