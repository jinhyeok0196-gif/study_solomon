import { supabase } from '@/lib/supabase/client';

export interface AdminOutingRow {
  id: string;
  studentId: string;
  studentName: string;
  startedAt: string;
  endedAt: string | null;
  status: string; // ongoing | completed | overdue
  reason: string | null;
}

interface Row {
  id: string;
  student_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  reason: string | null;
  student_profiles: { users: { name: string } | null } | null;
}

/** 전체 외출 기록을 최신순으로 (관리자용). */
export async function fetchAdminOutings(limit = 100): Promise<AdminOutingRow[]> {
  const { data, error } = await supabase
    .from('bathroom_logs')
    .select('id, student_id, started_at, ended_at, status, reason, student_profiles(users(name))')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_profiles?.users?.name ?? '(알 수 없음)',
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status,
    reason: r.reason,
  }));
}
