import { useQuery } from '@tanstack/react-query';
import { fetchActiveOuting, fetchActivePowerNap, fetchTodayAttendanceSummary } from './api';

export function useActiveOutingQuery() {
  return useQuery({
    queryKey: ['admin-monitor-outing'],
    queryFn: fetchActiveOuting,
    staleTime: Infinity,
  });
}

export function useActivePowerNapQuery() {
  return useQuery({
    queryKey: ['admin-monitor-powernap'],
    queryFn: fetchActivePowerNap,
    staleTime: Infinity,
  });
}

export function useTodayAttendanceSummaryQuery() {
  return useQuery({
    queryKey: ['admin-monitor-attendance-summary'],
    queryFn: fetchTodayAttendanceSummary,
    staleTime: Infinity,
  });
}
