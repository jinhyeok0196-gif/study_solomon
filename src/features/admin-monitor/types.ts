export interface ActiveOutingRow {
  id: string;
  studentId: string;
  studentName: string;
  startedAt: string;
  status: string;
}

export interface ActivePowerNapRow {
  id: string;
  studentId: string;
  studentName: string;
  startedAt: string;
  plannedEndAt: string;
  status: string;
  isUnauthorized: boolean;
}

export interface TodayAttendanceSummary {
  presentCount: number;
  lateCount: number;
  absentCount: number;
  earlyLeaveCount: number;
  excusedAbsenceCount: number;
  excusedEarlyLeaveCount: number;
}
