import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchTodayBathroomLogs(studentId: string): Promise<Tables<'bathroom_logs'>[]> {
  const today = todayStr();
  const { data, error } = await supabase
    .from('bathroom_logs')
    .select('*')
    .eq('student_id', studentId)
    .gte('started_at', `${today}T00:00:00Z`)
    .lte('started_at', `${today}T23:59:59Z`)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchTodayAttendance(studentId: string): Promise<Tables<'attendance_records'>[]> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('student_id', studentId)
    .eq('class_date', todayStr());
  if (error) throw error;
  return data ?? [];
}

export async function fetchStudentRecentRequests(studentId: string, limit = 5) {
  const { data, error } = await supabase
    .from('request_logs')
    .select('id, request_type, status, new_value, reason, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchStudentWeekScheduleCells(studentId: string, weekStartDate: string) {
  const { data: schedule } = await supabase
    .from('weekly_schedules')
    .select('id, status')
    .eq('student_id', studentId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle();
  if (!schedule) return { cells: [] as { day_of_week: string; period_number: number }[], status: null };

  const { data: cells } = await supabase
    .from('schedule_items')
    .select('day_of_week, period_number')
    .eq('weekly_schedule_id', schedule.id);
  return { cells: cells ?? [], status: schedule.status };
}

export async function addManualWarning(studentId: string, issuedBy: string, note: string): Promise<void> {
  const { data: profile, error: pe } = await supabase
    .from('student_profiles')
    .select('current_penalty_points, warning_count')
    .eq('id', studentId)
    .single();
  if (pe) throw pe;

  const { error } = await supabase.from('warning_records').insert({
    student_id: studentId,
    warning_level: 1,
    triggered_penalty_total: profile.current_penalty_points,
    is_auto_generated: false,
    issued_by: issuedBy,
    note,
  });
  if (error) throw error;

  await supabase
    .from('student_profiles')
    .update({ warning_count: (profile.warning_count ?? 0) + 1 })
    .eq('id', studentId);
}

export async function fetchTodayAbsenceLeaveRequests(studentId: string) {
  const today = todayStr();
  const [abs, leave] = await Promise.all([
    supabase
      .from('absence_requests')
      .select('id, request_date, status, reason, created_at')
      .eq('student_id', studentId)
      .eq('request_date', today),
    supabase
      .from('leave_requests')
      .select('id, request_date, status, reason, created_at')
      .eq('student_id', studentId)
      .eq('request_date', today),
  ]);
  return {
    absences: abs.data ?? [],
    leaves: leave.data ?? [],
  };
}
