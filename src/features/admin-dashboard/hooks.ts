import { useQuery } from '@tanstack/react-query';
import { fetchDashboardSummary } from './api';

export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: ['admin-dashboard-summary'],
    queryFn: fetchDashboardSummary,
    refetchInterval: 30_000,
  });
}
