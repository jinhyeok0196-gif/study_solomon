import { supabase } from '@/lib/supabase/client';
import type { RequestLog } from '@/features/mypage/types';
import type { Tables } from '@/lib/supabase/database.types';

export interface RequestLogWithStudent extends RequestLog {
  studentName: string;
}

function mapRow(
  row: Tables<'request_logs'> & { student: { name: string } | null }
): RequestLogWithStudent {
  return {
    id: row.id,
    studentId: row.student_id,
    requestType: row.request_type as RequestLog['requestType'],
    status: row.status as RequestLog['status'],
    newValue: row.new_value,
    reason: row.reason,
    adminNote: row.admin_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    studentName: row.student?.name ?? '(알수없음)',
  };
}

export async function fetchAllRequestLogs(): Promise<RequestLogWithStudent[]> {
  const { data, error } = await supabase
    .from('request_logs')
    .select('*, student:users!request_logs_student_id_fkey(name)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRow as never);
}

export async function approveRequestLog(
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

export async function rejectRequestLog(
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
