import { supabase } from '@/lib/supabase/client';
import type { RequestKind, RequestRecord } from './types';
import type { RequestFormValues } from './schema';

function mapRow(row: {
  id: string;
  request_date: string;
  period_numbers: number[];
  reason: string;
  status: string;
  created_at: string;
}): RequestRecord {
  return {
    id: row.id,
    requestDate: row.request_date,
    periodNumbers: row.period_numbers,
    reason: row.reason,
    status: row.status as RequestRecord['status'],
    createdAt: row.created_at,
  };
}

export async function fetchMyRequests(kind: RequestKind, studentId: string): Promise<RequestRecord[]> {
  const query =
    kind === 'absence'
      ? supabase.from('absence_requests').select('*').eq('student_id', studentId)
      : supabase.from('leave_requests').select('*').eq('student_id', studentId);

  const { data, error } = await query.order('request_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createRequest(
  kind: RequestKind,
  studentId: string,
  values: RequestFormValues
): Promise<void> {
  const payload = {
    student_id: studentId,
    request_date: values.requestDate,
    period_numbers: values.periodNumbers,
    reason: values.reason,
  };

  const { error } =
    kind === 'absence'
      ? await supabase.from('absence_requests').insert(payload)
      : await supabase.from('leave_requests').insert(payload);

  if (error) throw error;
}

export async function cancelRequest(kind: RequestKind, requestId: string): Promise<void> {
  const { error } =
    kind === 'absence'
      ? await supabase.from('absence_requests').delete().eq('id', requestId)
      : await supabase.from('leave_requests').delete().eq('id', requestId);

  if (error) throw error;
}
