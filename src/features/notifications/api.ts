import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

export async function fetchAdminNotifications(): Promise<Tables<'notifications'>[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_role', 'admin')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return data ?? [];
}

export async function fetchUnreadStudentNotifications(
  studentId: string
): Promise<Tables<'notifications'>[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', studentId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
  if (error) throw error;
}
