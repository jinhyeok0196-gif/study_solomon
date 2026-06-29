import type { AttendanceRecordWithPeriod } from '@/features/attendance/api';
import type { Tables } from '@/lib/supabase/database.types';
import {
  studySecondsForDay,
  type AwayLog,
  type LiveStudyLog,
} from '@/features/attendance/stats';

export interface DayActivity {
  attendance: AttendanceRecordWithPeriod[];
  penalties: Tables<'penalty_records'>[];
  warnings: Tables<'warning_records'>[];
  naps: Tables<'power_nap_logs'>[];
}

export function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 출결/벌점/경고/파워냅을 날짜(YYYY-MM-DD)별로 묶는다. */
export function buildActivityMap(
  attendance: AttendanceRecordWithPeriod[],
  penalties: Tables<'penalty_records'>[],
  warnings: Tables<'warning_records'>[],
  naps: Tables<'power_nap_logs'>[]
): Map<string, DayActivity> {
  const map = new Map<string, DayActivity>();
  const ensure = (key: string): DayActivity => {
    let entry = map.get(key);
    if (!entry) {
      entry = { attendance: [], penalties: [], warnings: [], naps: [] };
      map.set(key, entry);
    }
    return entry;
  };

  attendance.forEach((a) => ensure(a.classDate).attendance.push(a));
  penalties.forEach((p) => ensure(toLocalDateKey(p.created_at)).penalties.push(p));
  warnings.forEach((w) => ensure(toLocalDateKey(w.issued_at)).warnings.push(w));
  naps.forEach((n) => ensure(n.nap_date).naps.push(n));

  return map;
}

/**
 * 날짜(YYYY-MM-DD)별 순공시간(초) 맵.
 * = (재실 구간 ∩ 신청 수업 교시) − (교시 중 외출/파워냅) + 교시외공부.
 * 오늘분은 nowMs 기준으로 실시간 증가하고, 과거분은 하원 시각까지의 확정값이다.
 */
export function buildDailyStudySeconds(
  attendance: AttendanceRecordWithPeriod[],
  extraLogs: Tables<'extra_study_logs'>[],
  outings: Tables<'bathroom_logs'>[],
  naps: Tables<'power_nap_logs'>[],
  nowMs: number
): Map<string, number> {
  const attendanceByDay = new Map<string, AttendanceRecordWithPeriod[]>();
  attendance.forEach((a) => {
    const list = attendanceByDay.get(a.classDate) ?? [];
    list.push(a);
    attendanceByDay.set(a.classDate, list);
  });

  const extraByDay = new Map<string, LiveStudyLog[]>();
  extraLogs.forEach((e) => {
    const list = extraByDay.get(e.study_date) ?? [];
    list.push({ startedAt: e.started_at, endedAt: e.ended_at });
    extraByDay.set(e.study_date, list);
  });

  const awayByDay = new Map<string, AwayLog[]>();
  const pushAway = (day: string, log: AwayLog) => {
    const list = awayByDay.get(day) ?? [];
    list.push(log);
    awayByDay.set(day, list);
  };
  outings.forEach((o) => pushAway(toLocalDateKey(o.started_at), { startedAt: o.started_at, endedAt: o.ended_at }));
  naps.forEach((n) => pushAway(n.nap_date, { startedAt: n.started_at, endedAt: n.ended_at }));

  const result = new Map<string, number>();
  const days = new Set<string>([...attendanceByDay.keys(), ...extraByDay.keys()]);
  for (const day of days) {
    const sec = studySecondsForDay(
      attendanceByDay.get(day) ?? [],
      extraByDay.get(day) ?? [],
      awayByDay.get(day) ?? [],
      nowMs
    );
    if (sec > 0) result.set(day, sec);
  }
  return result;
}

/** 날짜별 순공시간(분) 맵 — 캘린더 셀 표기용. buildDailyStudySeconds의 분 환산 래퍼. */
export function buildDailyStudyMinutes(
  attendance: AttendanceRecordWithPeriod[],
  extraLogs: Tables<'extra_study_logs'>[],
  outings: Tables<'bathroom_logs'>[],
  naps: Tables<'power_nap_logs'>[],
  nowMs: number = Date.now()
): Map<string, number> {
  const seconds = buildDailyStudySeconds(attendance, extraLogs, outings, naps, nowMs);
  const result = new Map<string, number>();
  for (const [day, sec] of seconds) result.set(day, Math.round(sec / 60));
  return result;
}

export type AttendanceTone = 'absent' | 'late' | 'present';

/** 그날 출결 중 가장 강조해야 할 상태 (결석 > 지각 > 출석) */
export function attendanceTone(records: AttendanceRecordWithPeriod[]): AttendanceTone | null {
  if (records.some((r) => r.status === 'absent' || r.status === 'excused_absence')) return 'absent';
  if (records.some((r) => r.status === 'late')) return 'late';
  if (records.length > 0) return 'present';
  return null;
}
