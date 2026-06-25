export const STUDENT_PATHS = {
  login: '/login',
  dashboard: '/',
  schedule: '/schedule',
  scheduleHistory: '/schedule/history',
  attendance: '/attendance',
  absenceRequest: '/absence-requests/new',
  leaveRequest: '/leave-requests/new',
  outing: '/outing',
  powerNap: '/power-nap',
  penalty: '/penalty',
} as const;

export const ADMIN_PATHS = {
  login: '/admin/login',
  dashboard: '/admin',
  students: '/admin/students',
  studentDetail: (studentId: string) => `/admin/students/${studentId}`,
  schedules: '/admin/schedules',
  attendance: '/admin/attendance',
  penalties: '/admin/penalties',
  warnings: '/admin/warnings',
  notifications: '/admin/notifications',
} as const;
