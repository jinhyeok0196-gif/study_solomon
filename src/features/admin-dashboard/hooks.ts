import { useQuery } from '@tanstack/react-query';
import { fetchDashboardSummary } from './api';

export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: ['admin-dashboard-summary'],
    queryFn: fetchDashboardSummary,
    refetchInterval: 60_000, // realtime sync covers live updates; this is a fallback if a channel drops
  });
}
