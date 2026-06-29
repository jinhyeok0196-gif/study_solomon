import type { AttendanceRecordWithPeriod } from '@/features/attendance/api';
import type { Tables } from '@/lib/supabase/database.types';
import {
  attendedIntervalsFromRecords,
  awayDeductionMinutes,
  recordStudyMinutes,
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

function logMinutes(start: string, end: string | null): number {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((e - s) / 60000));
}

/**
 * 날짜(YYYY-MM-DD)별 순공시간(분) 맵.
 * = 출석 교시 시간 + 교시외공부 − (교시 중 외출/파워냅), 0 미만 방지.
 */
export function buildDailyStudyMinutes(
  attendance: AttendanceRecordWithPeriod[],
  extraLogs: Tables<'extra_study_logs'>[],
  outings: Tables<'bathroom_logs'>[],
  naps: Tables<'power_nap_logs'>[]
): Map<string, number> {
  const attendanceByDay = new Map<string, AttendanceRecordWithPeriod[]>();
  attendance.forEach((a) => {
    const list = attendanceByDay.get(a.classDate) ?? [];
    list.push(a);
    attendanceByDay.set(a.classDate, list);
  });

  const extraByDay = new Map<string, number>();
  extraLogs.forEach((e) => {
    extraByDay.set(e.study_date, (extraByDay.get(e.study_date) ?? 0) + logMinutes(e.started_at, e.ended_at));
  });

  const awayByDay = new Map<string, { startedAt: string; endedAt: string | null }[]>();
  const pushAway = (day: string, log: { startedAt: string; endedAt: string | null }) => {
    const list = awayByDay.get(day) ?? [];
    list.push(log);
    awayByDay.set(day, list);
  };
  outings.forEach((o) => pushAway(toLocalDateKey(o.started_at), { startedAt: o.started_at, endedAt: o.ended_at }));
  naps.forEach((n) => pushAway(n.nap_date, { startedAt: n.started_at, endedAt: n.ended_at }));

  const result = new Map<string, number>();
  const days = new Set<string>([...attendanceByDay.keys(), ...extraByDay.keys()]);
  for (const day of days) {
    const recs = attendanceByDay.get(day) ?? [];
    const periodMin = recs.reduce((sum, r) => sum + recordStudyMinutes(r), 0);
    const extraMin = extraByDay.get(day) ?? 0;
    const away = awayDeductionMinutes(attendedIntervalsFromRecords(recs), awayByDay.get(day) ?? []);
    const total = Math.max(0, periodMin + extraMin - away);
    if (total > 0) result.set(day, total);
  }
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
