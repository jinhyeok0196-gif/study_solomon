import type { AttendanceRecordWithPeriod } from './api';

const PRESENT_LIKE_STATUSES = new Set(['present', 'late', 'early_leave']);
const ABSENT_LIKE_STATUSES = new Set(['absent', 'excused_absence']);

function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function isoToMinutes(iso: string): number {
  return new Date(iso).getTime() / (1000 * 60);
}

export function recordStudyMinutes(record: AttendanceRecordWithPeriod): number {
  if (record.checkedInAt && record.checkedOutAt) {
    return Math.max(0, isoToMinutes(record.checkedOutAt) - isoToMinutes(record.checkedInAt));
  }
  if (PRESENT_LIKE_STATUSES.has(record.status)) {
    return Math.max(
      0,
      timeStringToMinutes(record.periodEndTime) - timeStringToMinutes(record.periodStartTime)
    );
  }
  return 0;
}

export interface AttendanceStats {
  totalRecords: number;
  attendanceRate: number;
  absenceRate: number;
  lateCount: number;
  cumulativeStudyMinutes: number;
}

export function computeAttendanceStats(
  allRecords: AttendanceRecordWithPeriod[],
  monthRecords: AttendanceRecordWithPeriod[]
): AttendanceStats {
  const totalRecords = monthRecords.length;
  const absentCount = monthRecords.filter((record) => ABSENT_LIKE_STATUSES.has(record.status)).length;
  const lateCount = monthRecords.filter((record) => record.status === 'late').length;

  return {
    totalRecords,
    attendanceRate: totalRecords === 0 ? 0 : (totalRecords - absentCount) / totalRecords,
    absenceRate: totalRecords === 0 ? 0 : absentCount / totalRecords,
    lateCount,
    cumulativeStudyMinutes: allRecords.reduce((sum, record) => sum + recordStudyMinutes(record), 0),
  };
}
