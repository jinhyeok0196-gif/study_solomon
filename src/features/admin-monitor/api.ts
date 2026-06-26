import { supabase } from '@/lib/supabase/client';
import type { ActiveOutingRow, ActivePowerNapRow, TodayAttendanceSummary } from './types';

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

interface OutingJoinRow {
  id: string;
  student_id: string;
  started_at: string;
  status: string;
  student_profiles: { users: { name: string } | null } | null;
}

export async function fetchActiveOuting(): Promise<ActiveOutingRow[]> {
  const { data, error } = await supabase
    .from('bathroom_logs')
    .select('id, student_id, started_at, status, student_profiles(users(name))')
    .eq('status', 'ongoing')
    .order('started_at', { ascending: true });
  if (error) throw error;

  return (data as unknown as OutingJoinRow[]).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_profiles?.users?.name ?? '(알 수 없음)',
    startedAt: row.started_at,
    status: row.status,
  }));
}

interface PowerNapJoinRow {
  id: string;
  student_id: string;
  started_at: string;
  planned_end_at: string;
  status: string;
  is_unauthorized: boolean;
  student_profiles: { users: { name: string } | null } | null;
}

export async function fetchActivePowerNap(): Promise<ActivePowerNapRow[]> {
  const { data, error } = await supabase
    .from('power_nap_logs')
    .select('id, student_id, started_at, planned_end_at, status, is_unauthorized, student_profiles(users(name))')
    .eq('status', 'ongoing')
    .eq('nap_date', todayDateString())
    .order('started_at', { ascending: true });
  if (error) throw error;

  return (data as unknown as PowerNapJoinRow[]).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_profiles?.users?.name ?? '(알 수 없음)',
    startedAt: row.started_at,
    plannedEndAt: row.planned_end_at,
    status: row.status,
    isUnauthorized: row.is_unauthorized,
  }));
}

export async function fetchTodayAttendanceSummary(): Promise<TodayAttendanceSummary> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('student_id, status')
    .eq('class_date', todayDateString());
  if (error) throw error;

  const rows = data ?? [];
  const unique = (status: string) =>
    new Set(rows.filter((r) => r.status === status).map((r) => r.student_id)).size;

  return {
    presentCount: unique('present'),
    lateCount: unique('late'),
    absentCount: unique('absent'),
    earlyLeaveCount: unique('early_leave'),
    excusedAbsenceCount: unique('excused_absence'),
    excusedEarlyLeaveCount: unique('excused_early_leave'),
  };
}
