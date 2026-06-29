import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

export type ExtraStudyLog = Tables<'extra_study_logs'>;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 진행 중인 교시외공부 세션 (없으면 null) */
export async function fetchOngoingExtraStudy(studentId: string): Promise<ExtraStudyLog | null> {
  const { data, error } = await supabase
    .from('extra_study_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'ongoing')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** 오늘 완료된 교시외공부 세션들 (순공시간 합산용) */
export async function fetchTodayExtraStudy(studentId: string): Promise<ExtraStudyLog[]> {
  const { data, error } = await supabase
    .from('extra_study_logs')
    .select('*')
    .eq('student_id', studentId)
    .eq('study_date', todayDateString())
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** 전체 교시외공부 세션 (누적 순공시간 합산용) */
export async function fetchAllExtraStudy(studentId: string): Promise<ExtraStudyLog[]> {
  const { data, error } = await supabase
    .from('extra_study_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function startExtraStudy(studentId: string): Promise<void> {
  const { error } = await supabase.from('extra_study_logs').insert({ student_id: studentId });
  if (error) throw new Error('교시외공부를 시작하지 못했습니다.');
}

export async function endExtraStudy(logId: string): Promise<void> {
  const { error } = await supabase
    .from('extra_study_logs')
    .update({ ended_at: new Date().toISOString(), status: 'completed' })
    .eq('id', logId);
  if (error) throw new Error('교시외공부를 종료하지 못했습니다.');
}

/** 완료된 세션들의 총 학습 분 (진행 중 세션은 현재까지로 계산) */
export function sumExtraStudyMinutes(logs: ExtraStudyLog[]): number {
  return logs.reduce((sum, log) => {
    const start = new Date(log.started_at).getTime();
    const end = log.ended_at ? new Date(log.ended_at).getTime() : Date.now();
    return sum + Math.max(0, Math.round((end - start) / 60000));
  }, 0);
}
