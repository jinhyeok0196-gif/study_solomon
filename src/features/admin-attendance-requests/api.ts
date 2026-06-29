import { supabase } from '@/lib/supabase/client';
import type { RequestKind } from '@/features/requests/types';

export interface AttendanceRequestRow {
  id: string;
  kind: RequestKind; // 'absence' | 'leave'
  studentName: string;
  requestDate: string;
  periodNumbers: number[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  request_date: string;
  period_numbers: number[];
  reason: string;
  status: string;
  reviewed_at: string | null;
  created_at: string;
  student_profiles: { users: { name: string } | null } | null;
}

const SELECT =
  'id, request_date, period_numbers, reason, status, reviewed_at, created_at, student_profiles(users(name))';

function mapRow(kind: RequestKind, row: Row): AttendanceRequestRow {
  return {
    id: row.id,
    kind,
    studentName: row.student_profiles?.users?.name ?? '(알 수 없음)',
    requestDate: row.request_date,
    periodNumbers: row.period_numbers ?? [],
    reason: row.reason,
    status: row.status as AttendanceRequestRow['status'],
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

/** 결석·조퇴 신청을 모두 모아 최신순으로 반환한다. */
export async function fetchAttendanceRequests(): Promise<AttendanceRequestRow[]> {
  const [absence, leave] = await Promise.all([
    supabase.from('absence_requests').select(SELECT).order('created_at', { ascending: false }),
    supabase.from('leave_requests').select(SELECT).order('created_at', { ascending: false }),
  ]);
  if (absence.error) throw absence.error;
  if (leave.error) throw leave.error;

  return [
    ...(absence.data ?? []).map((r) => mapRow('absence', r as unknown as Row)),
    ...(leave.data ?? []).map((r) => mapRow('leave', r as unknown as Row)),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 신청 승인/거절 (status + reviewed_by/at 갱신). RLS상 관리자만 가능. */
export async function reviewAttendanceRequest(
  kind: RequestKind,
  requestId: string,
  status: 'approved' | 'rejected',
  adminId: string
): Promise<void> {
  const table = kind === 'absence' ? 'absence_requests' : 'leave_requests';
  const { error } = await supabase
    .from(table)
    .update({ status, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
}
