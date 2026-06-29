import type { AttendanceRecordWithPeriod } from '@/features/attendance/api';
import type { Tables } from '@/lib/supabase/database.types';

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

export type AttendanceTone = 'absent' | 'late' | 'present';

/** 그날 출결 중 가장 강조해야 할 상태 (결석 > 지각 > 출석) */
export function attendanceTone(records: AttendanceRecordWithPeriod[]): AttendanceTone | null {
  if (records.some((r) => r.status === 'absent' || r.status === 'excused_absence')) return 'absent';
  if (records.some((r) => r.status === 'late')) return 'late';
  if (records.length > 0) return 'present';
  return null;
}
