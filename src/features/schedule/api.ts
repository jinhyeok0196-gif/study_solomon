import { supabase } from '@/lib/supabase/client';
import type { Json, Tables, TablesInsert } from '@/lib/supabase/database.types';
import type { DayOfWeek, PeriodNumber } from '@/constants/periods';
import type { ScheduleCell } from './types';

export async function requestScheduleUnlock(
  studentId: string,
  weekStartDate: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.from('request_logs').insert({
    student_id: studentId,
    request_type: 'schedule_unlock',
    reason,
    new_value: weekStartDate,
  });
  if (error) throw error;

  await supabase.from('notifications').insert({
    recipient_id: null,
    recipient_role: 'admin',
    related_student_id: studentId,
    type: 'schedule_unlock_request',
    title: '시간표 수정 권한 요청',
    message: `시간표 수정 권한 요청이 접수되었습니다. (대상 주: ${weekStartDate})`,
  });
}

export async function fetchPendingScheduleUnlockRequest(
  studentId: string,
  weekStartDate: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('request_logs')
    .select('id')
    .eq('student_id', studentId)
    .eq('request_type', 'schedule_unlock')
    .eq('new_value', weekStartDate)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export interface WeeklyScheduleWithItems {
  schedule: Tables<'weekly_schedules'> | null;
  cells: ScheduleCell[];
}

export async function fetchWeeklySchedule(
  studentId: string,
  weekStartDate: string
): Promise<WeeklyScheduleWithItems> {
  const { data: schedule, error } = await supabase
    .from('weekly_schedules')
    .select('*')
    .eq('student_id', studentId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle();

  if (error) throw error;
  if (!schedule) return { schedule: null, cells: [] };

  const { data: items, error: itemsError } = await supabase
    .from('schedule_items')
    .select('day_of_week, period_number')
    .eq('weekly_schedule_id', schedule.id);

  if (itemsError) throw itemsError;

  return {
    schedule,
    cells: (items ?? []).map((item) => ({
      dayOfWeek: item.day_of_week as DayOfWeek,
      periodNumber: item.period_number as PeriodNumber,
    })),
  };
}

interface SaveWeeklyScheduleParams {
  studentId: string;
  weekStartDate: string;
  cells: ScheduleCell[];
  submit: boolean;
}

export async function saveWeeklySchedule({
  studentId,
  weekStartDate,
  cells,
  submit,
}: SaveWeeklyScheduleParams): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from('weekly_schedules')
    .select('id')
    .eq('student_id', studentId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle();

  if (existingError) throw existingError;

  let weeklyScheduleId = existing?.id;

  if (!weeklyScheduleId) {
    const { data: created, error: createError } = await supabase
      .from('weekly_schedules')
      .insert({ student_id: studentId, week_start_date: weekStartDate })
      .select('id')
      .single();
    if (createError) throw createError;
    weeklyScheduleId = created.id;
  }

  const { error: deleteError } = await supabase
    .from('schedule_items')
    .delete()
    .eq('weekly_schedule_id', weeklyScheduleId);
  if (deleteError) throw deleteError;

  if (cells.length > 0) {
    const rows: TablesInsert<'schedule_items'>[] = cells.map((cell) => ({
      weekly_schedule_id: weeklyScheduleId!,
      day_of_week: cell.dayOfWeek,
      period_number: cell.periodNumber,
    }));
    const { error: insertError } = await supabase.from('schedule_items').insert(rows);
    if (insertError) throw insertError;
  }

  if (submit) {
    const { error: submitError } = await supabase
      .from('weekly_schedules')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', weeklyScheduleId);
    if (submitError) throw submitError;
  }

  await supabase.from('activity_logs').insert({
    actor_id: studentId,
    actor_role: 'student',
    action: submit ? 'schedule.submit' : 'schedule.update',
    target_table: 'weekly_schedules',
    target_id: weeklyScheduleId,
    detail: { week_start_date: weekStartDate, cells } as unknown as Json,
  });
}
