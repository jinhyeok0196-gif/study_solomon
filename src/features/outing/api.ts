import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

export async function fetchOngoingOuting(studentId: string): Promise<Tables<'bathroom_logs'> | null> {
  const { data, error } = await supabase
    .from('bathroom_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'ongoing')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchRecentOutings(studentId: string, limit = 10): Promise<Tables<'bathroom_logs'>[]> {
  const { data, error } = await supabase
    .from('bathroom_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function startOuting(studentId: string): Promise<void> {
  const { error } = await supabase.from('bathroom_logs').insert({ student_id: studentId });
  if (error) throw error;
}

export async function endOuting(outingId: string): Promise<void> {
  const { error } = await supabase
    .from('bathroom_logs')
    .update({ ended_at: new Date().toISOString(), status: 'completed' })
    .eq('id', outingId);
  if (error) throw error;
}
