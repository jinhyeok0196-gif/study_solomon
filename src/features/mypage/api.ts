import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';
import type { MyProfile, RequestLog, RequestType } from './types';

export async function fetchMyProfile(userId: string): Promise<MyProfile> {
  const [userRes, profileRes, authRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('student_profiles').select('*').eq('id', userId).single(),
    supabase.auth.getUser(),
  ]);

  if (userRes.error) throw userRes.error;
  if (profileRes.error) throw profileRes.error;

  const user = userRes.data;
  const profile = profileRes.data;

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: authRes.data.user?.email ?? '',
    createdAt: user.created_at,
    enrollmentDate: profile.enrollment_date,
    membershipStatus: profile.membership_status,
    membershipType: profile.membership_type,
    membershipStartDate: profile.membership_start_date,
    membershipEndDate: profile.membership_end_date,
    currentPenaltyPoints: profile.current_penalty_points,
    warningCount: profile.warning_count,
  };
}

function mapRequestLog(row: Tables<'request_logs'>): RequestLog {
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
  };
}

export async function fetchMyRequestLogs(studentId: string): Promise<RequestLog[]> {
  const { data, error } = await supabase
    .from('request_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRequestLog);
}

export async function submitRequestLog(
  studentId: string,
  requestType: RequestType,
  reason: string,
  newValue?: string
): Promise<void> {
  const { error } = await supabase.from('request_logs').insert({
    student_id: studentId,
    request_type: requestType,
    reason,
    new_value: newValue ?? null,
  });
  if (error) throw error;
}

export async function fetchStudentNotifications(
  studentId: string
): Promise<Tables<'notifications'>[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', studentId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

export async function markStudentNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
  if (error) throw error;
}
