import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

export interface PenaltyProfile {
  currentPenaltyPoints: number;
  warningCount: number;
}

export async function fetchPenaltyProfile(studentId: string): Promise<PenaltyProfile> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('current_penalty_points, warning_count')
    .eq('id', studentId)
    .single();

  if (error) throw error;
  return { currentPenaltyPoints: data.current_penalty_points, warningCount: data.warning_count };
}

export async function fetchPenaltyRecords(studentId: string): Promise<Tables<'penalty_records'>[]> {
  const { data, error } = await supabase
    .from('penalty_records')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchWarningRecords(studentId: string): Promise<Tables<'warning_records'>[]> {
  const { data, error } = await supabase
    .from('warning_records')
    .select('*')
    .eq('student_id', studentId)
    .order('issued_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
