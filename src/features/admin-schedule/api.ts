import { supabase } from '@/lib/supabase/client';
import { dayOfWeekKeyOf, weekStartDateOf } from '@/features/schedule/dates';

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
