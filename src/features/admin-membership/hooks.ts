import { useQuery } from '@tanstack/react-query';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import { fetchMembershipOverview } from './api';

export const MEMBERSHIP_OVERVIEW_KEY = ['admin-membership-overview'];

export function useMembershipOverviewQuery() {
  // 이용권 정보(student_profiles) 변경 시 자동 갱신
  useRealtimeTableSync('student_profiles', [MEMBERSHIP_OVERVIEW_KEY]);
  return useQuery({
    queryKey: MEMBERSHIP_OVERVIEW_KEY,
    queryFn: fetchMembershipOverview,
  });
}
