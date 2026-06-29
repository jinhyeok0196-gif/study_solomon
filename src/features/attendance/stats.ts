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

// ── 외출/파워냅 차감 ───────────────────────────────────────────────────────
// 출석한 수업 교시 시간과 겹치는 외출(bathroom_logs)·파워냅(power_nap_logs) 시간을
// 순공시간에서 차감한다. (예: 1교시 80분 중 파워냅 20분 → 순공 60분)
export interface StudyInterval {
  start: number; // epoch ms
  end: number;
}

export interface AwayLog {
  startedAt: string;
  endedAt: string | null;
}

/** 출석(present/late)한 교시의 실제 시각 구간 목록 */
export function attendedIntervalsFromRecords(records: AttendanceRecordWithPeriod[]): StudyInterval[] {
  return records
    .filter((r) => STUDY_STATUSES.has(r.status))
    .map((r) => ({
      start: new Date(`${r.classDate}T${r.periodStartTime}`).getTime(),
      end: new Date(`${r.classDate}T${r.periodEndTime}`).getTime(),
    }))
    .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start);
}

/** 외출/파워냅 구간이 교시 구간과 겹치는 총 분(차감 대상) */
export function awayDeductionMinutes(
  periodIntervals: StudyInterval[],
  awayLogs: AwayLog[]
): number {
  let total = 0;
  for (const log of awayLogs) {
    const ls = new Date(log.startedAt).getTime();
    const le = log.endedAt ? new Date(log.endedAt).getTime() : Date.now();
    if (!Number.isFinite(ls) || le <= ls) continue;
    for (const pv of periodIntervals) {
      const s = Math.max(ls, pv.start);
      const e = Math.min(le, pv.end);
      if (e > s) total += (e - s) / 60000;
    }
  }
  return Math.round(total);
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
  extraStudyMinutes = 0,
  awayDeduction = 0
): AttendanceStats {
  const totalRecords = monthRecords.length;
  const absentCount = monthRecords.filter((record) => ABSENT_LIKE_STATUSES.has(record.status)).length;
  const lateCount = monthRecords.filter((record) => record.status === 'late').length;

  const periodMinutes = allRecords.reduce((sum, record) => sum + recordStudyMinutes(record), 0);

  return {
    totalRecords,
    attendanceRate: totalRecords === 0 ? 0 : (totalRecords - absentCount) / totalRecords,
    absenceRate: totalRecords === 0 ? 0 : absentCount / totalRecords,
    lateCount,
    // 교시 시간 + 교시외공부 − (교시 중 외출/파워냅), 0 미만 방지
    cumulativeStudyMinutes: Math.max(0, periodMinutes + extraStudyMinutes - awayDeduction),
  };
}
