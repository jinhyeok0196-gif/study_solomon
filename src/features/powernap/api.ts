import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchTodayNap(studentId: string): Promise<Tables<'power_nap_logs'> | null> {
  const { data, error } = await supabase
    .from('power_nap_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('nap_date', todayDateString())
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchRecentNaps(studentId: string, limit = 200): Promise<Tables<'power_nap_logs'>[]> {
  const { data, error } = await supabase
    .from('power_nap_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function startNap(studentId: string, maxMinutes: number): Promise<void> {
  const plannedEndAt = new Date(Date.now() + maxMinutes * 60 * 1000).toISOString();
  const { error } = await supabase.from('power_nap_logs').insert({
    student_id: studentId,
    nap_date: todayDateString(),
    planned_end_at: plannedEndAt,
  });
  if (error) throw error;
}

export async function endNap(napId: string): Promise<void> {
  const { error } = await supabase
    .from('power_nap_logs')
    .update({ ended_at: new Date().toISOString(), status: 'completed' })
    .eq('id', napId);
  if (error) throw error;
}
