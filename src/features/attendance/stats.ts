import type { AttendanceRecordWithPeriod } from './api';

// 순공시간 = 실제 출석한 "수업 교시"의 교시 시간만 합산한다.
// (쉬는시간/식사시간은 교시가 아니므로 자동 제외되고, 체크인~체크아웃 전체 구간을
//  세지 않으므로 교시 사이 시간도 포함되지 않는다. 비수업 시간 공부는 extra_study_logs로 별도 합산.)
const STUDY_STATUSES = new Set(['present', 'late']);
const ABSENT_LIKE_STATUSES = new Set(['absent', 'excused_absence']);

function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function recordStudyMinutes(record: AttendanceRecordWithPeriod): number {
  if (STUDY_STATUSES.has(record.status)) {
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
  monthRecords: AttendanceRecordWithPeriod[],
  extraStudyMinutes = 0
): AttendanceStats {
  const totalRecords = monthRecords.length;
  const absentCount = monthRecords.filter((record) => ABSENT_LIKE_STATUSES.has(record.status)).length;
  const lateCount = monthRecords.filter((record) => record.status === 'late').length;

  return {
    totalRecords,
    attendanceRate: totalRecords === 0 ? 0 : (totalRecords - absentCount) / totalRecords,
    absenceRate: totalRecords === 0 ? 0 : absentCount / totalRecords,
    lateCount,
    cumulativeStudyMinutes:
      allRecords.reduce((sum, record) => sum + recordStudyMinutes(record), 0) + extraStudyMinutes,
  };
}
