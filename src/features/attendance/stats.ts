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

// ── 재실시간 기반 순공시간(초 단위) ───────────────────────────────────────
// 순공시간 = (등원~하원/현재 '재실 구간' ∩ 신청한 수업 교시) − 교시 중 외출/파워냅
//            + 교시외공부.
//
// 왜 교시별 출석(present) 레코드가 아니라 '재실 구간'을 쓰나:
//   QR 등원은 그날 '첫 교시'에만 present 레코드를 만들고(checkin_by_qr), 중간 교시는
//   레코드가 없거나 크론이 absent로 찍는다. 따라서 present 교시만 세면 첫 교시 뒤로
//   순공시간이 멈춘다. 대신 checked_in_at(등원)~checked_out_at(하원, 없으면 현재)을
//   '실제 자리에 있던 구간'으로 보고, 그날 신청한 수업 교시와 겹치는 시간을 센다.
//   → 교시 도중에 확인해도, 첫 교시 이후에도 매초 올라가고, 비수업 시간(쉬는시간/식사)
//     이나 외출/파워냅 중에는 올라가지 않는다.
//
// TODO(추후): 교시 시작 후 5분 / 종료 전 5분에 카메라+AI로 재실 여부를 판정해
//   '실제 재실 교시'를 확정하고 무단결석을 가려낼 예정. 그때는 attendedClassIntervals를
//   AI 재실 판정 결과로 교체/보강한다. (현재는 카메라/AI 미연동)
export interface LiveStudyLog {
  startedAt: string;
  endedAt: string | null;
}

export interface PresenceSpan {
  start: number; // 등원(checked_in_at) epoch ms
  end: number | null; // 하원(checked_out_at) epoch ms, 아직 재실 중이면 null
}

/** 그날 출결 레코드들에서 재실 구간(등원~하원)을 도출한다. 등원 기록이 없으면 null. */
export function presenceSpanFromRecords(records: AttendanceRecordWithPeriod[]): PresenceSpan | null {
  let start = Infinity;
  let end = -Infinity;
  let hasOut = false;
  for (const r of records) {
    if (r.checkedInAt) {
      const t = new Date(r.checkedInAt).getTime();
      if (Number.isFinite(t) && t < start) start = t;
    }
    if (r.checkedOutAt) {
      const t = new Date(r.checkedOutAt).getTime();
      if (Number.isFinite(t) && t > end) {
        end = t;
        hasOut = true;
      }
    }
  }
  if (!Number.isFinite(start)) return null;
  return { start, end: hasOut ? end : null };
}

/** 재실 구간 ∩ 신청한 수업 교시 = 실제로 공부한 구간들. (status 무관, 등원했으면 인정) */
export function attendedClassIntervals(
  records: AttendanceRecordWithPeriod[],
  nowMs: number
): StudyInterval[] {
  const span = presenceSpanFromRecords(records);
  if (!span) return [];
  const spanEnd = span.end ?? nowMs;
  if (spanEnd <= span.start) return [];
  const intervals: StudyInterval[] = [];
  for (const r of records) {
    const ps = new Date(`${r.classDate}T${r.periodStartTime}`).getTime();
    const pe = new Date(`${r.classDate}T${r.periodEndTime}`).getTime();
    if (!Number.isFinite(ps) || !Number.isFinite(pe) || pe <= ps) continue;
    const s = Math.max(span.start, ps);
    const e = Math.min(spanEnd, pe);
    if (e > s) intervals.push({ start: s, end: e });
  }
  return intervals;
}

/** 하루치 순공시간(초). 오늘이면 nowMs로 매초 증가, 과거면 확정값. */
export function studySecondsForDay(
  records: AttendanceRecordWithPeriod[],
  extraLogs: LiveStudyLog[],
  awayLogs: AwayLog[],
  nowMs: number
): number {
  const intervals = attendedClassIntervals(records, nowMs);

  let seconds = 0;
  for (const iv of intervals) seconds += (iv.end - iv.start) / 1000;

  // 교시(재실) 중 외출/파워냅 차감 (진행 중이면 현재 시각까지)
  for (const log of awayLogs) {
    const ls = new Date(log.startedAt).getTime();
    const le = log.endedAt ? new Date(log.endedAt).getTime() : nowMs;
    if (!Number.isFinite(ls) || le <= ls) continue;
    for (const iv of intervals) {
      const s = Math.max(ls, iv.start);
      const e = Math.min(le, iv.end);
      if (e > s) seconds -= (e - s) / 1000;
    }
  }

  // 교시외공부(비수업 시간 공부) 가산 (진행 중이면 현재 시각까지)
  for (const log of extraLogs) {
    const s = new Date(log.startedAt).getTime();
    const e = log.endedAt ? new Date(log.endedAt).getTime() : nowMs;
    if (Number.isFinite(s) && e > s) seconds += (e - s) / 1000;
  }

  return Math.max(0, Math.floor(seconds));
}

/**
 * 라이브(오늘) 순공시간(초). 교시 구간을 '출결 레코드'가 아니라 '신청한 수업 교시 시간표'
 * (classIntervals)로 직접 받는다 → 아직 레코드가 없는 진행 중 교시도 재실 구간과 겹치면
 * 매초 카운팅된다. studySecondsForDay(레코드 기반)는 과거 확정일용으로 유지.
 */
export function liveStudySecondsFromSchedule(
  classIntervals: StudyInterval[],
  presence: PresenceSpan | null,
  extraLogs: LiveStudyLog[],
  awayLogs: AwayLog[],
  nowMs: number
): number {
  // 재실 구간 ∩ 수업 교시 = 실제 공부 구간
  const attended: StudyInterval[] = [];
  if (presence) {
    const presEnd = presence.end ?? nowMs;
    for (const iv of classIntervals) {
      const s = Math.max(presence.start, iv.start);
      const e = Math.min(presEnd, iv.end);
      if (e > s) attended.push({ start: s, end: e });
    }
  }

  let seconds = 0;
  for (const iv of attended) seconds += (iv.end - iv.start) / 1000;

  // 교시 중 외출/파워냅 차감 (진행 중이면 현재 시각까지)
  for (const log of awayLogs) {
    const ls = new Date(log.startedAt).getTime();
    const le = log.endedAt ? new Date(log.endedAt).getTime() : nowMs;
    if (!Number.isFinite(ls) || le <= ls) continue;
    for (const iv of attended) {
      const s = Math.max(ls, iv.start);
      const e = Math.min(le, iv.end);
      if (e > s) seconds -= (e - s) / 1000;
    }
  }

  // 교시외공부(비수업 시간 공부) 가산 (진행 중이면 현재 시각까지)
  for (const log of extraLogs) {
    const s = new Date(log.startedAt).getTime();
    const e = log.endedAt ? new Date(log.endedAt).getTime() : nowMs;
    if (Number.isFinite(s) && e > s) seconds += (e - s) / 1000;
  }

  return Math.max(0, Math.floor(seconds));
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
