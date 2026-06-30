import { supabase } from '@/lib/supabase/client';
import type { MembershipRow } from './logic';

interface Row {
  id: string;
  membership_status: string;
  membership_type: string | null;
  membership_start_date: string | null;
  membership_end_date: string | null;
  auto_renew: boolean;
  users: { name: string; phone: string } | null;
}

/** 전체 학생의 이용권 정보를 만료일 오름차순(없으면 뒤)으로 조회한다. */
export async function fetchMembershipOverview(): Promise<MembershipRow[]> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select(
      'id, membership_status, membership_type, membership_start_date, membership_end_date, auto_renew, users(name, phone)'
    )
    .order('membership_end_date', { ascending: true, nullsFirst: false });
  if (error) throw error;

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.users?.name ?? '(알 수 없음)',
    phone: r.users?.phone ?? '',
    membershipStatus: r.membership_status,
    membershipType: r.membership_type,
    startDate: r.membership_start_date,
    endDate: r.membership_end_date,
    autoRenew: r.auto_renew,
  }));
}
