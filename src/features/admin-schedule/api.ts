import { supabase } from '@/lib/supabase/client';
import { dayOfWeekKeyOf, weekStartDateOf } from '@/features/schedule/dates';

export interface ScheduleUnlockRequest {
  id: string;
  studentId: string;
  studentName: string;
  weekStartDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export async function fetchScheduleUnlockRequests(): Promise<ScheduleUnlockRequest[]> {
  const { data, error } = await supabase
    .from('request_logs')
    .select('*, student:users!request_logs_student_id_fkey(name)')
    .eq('request_type', 'schedule_unlock')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown> & { student: { name: string } | null }) => ({
    id: row.id as string,
    studentId: row.student_id as string,
    studentName: row.student?.name ?? '(알수없음)',
    weekStartDate: (row.new_value as string) ?? '',
    reason: row.reason as string,
    status: row.status as ScheduleUnlockRequest['status'],
    adminNote: (row.admin_note as string | null) ?? null,
    createdAt: row.created_at as string,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
  }));
}

export async function approveScheduleUnlock(
  requestId: string,
  adminId: string,
  adminNote?: string
): Promise<void> {
  const { error } = await supabase.rpc('approve_request_log', {
    p_request_id: requestId,
    p_admin_id: adminId,
    p_admin_note: adminNote,
  });
  if (error) throw error;
}

export async function rejectScheduleUnlock(
  requestId: string,
  adminId: string,
  adminNote?: string
): Promise<void> {
  const { error } = await supabase.rpc('reject_request_log', {
    p_request_id: requestId,
    p_admin_id: adminId,
    p_admin_note: adminNote,
  });
  if (error) throw error;
}

export interface DateScheduleEntry {
  periodNumber: number;
  studentId: string;
}

interface ScheduleItemWithWeekly {
  period_number: number;
  weekly_schedules: { student_id: string } | null;
}

export async function fetchScheduleForDate(dateStr: string): Promise<DateScheduleEntry[]> {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('period_number, weekly_schedules!inner(student_id, week_start_date)')
    .eq('day_of_week', dayOfWeekKeyOf(dateStr))
    .eq('weekly_schedules.week_start_date', weekStartDateOf(dateStr));

  if (error) throw error;

  return (data as unknown as ScheduleItemWithWeekly[])
    .filter((row) => row.weekly_schedules)
    .map((row) => ({ periodNumber: row.period_number, studentId: row.weekly_schedules!.student_id }));
}

export interface WeeklySubmissionStatus {
  studentId: string;
  status: 'submitted' | 'draft' | 'none';
}

export async function fetchWeeklySubmissionStatuses(weekStartDate: string): Promise<WeeklySubmissionStatus[]> {
  const { data, error } = await supabase
    .from('weekly_schedules')
    .select('student_id, status')
    .eq('week_start_date', weekStartDate);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    studentId: row.student_id,
    status: row.status as WeeklySubmissionStatus['status'],
  }));
}
