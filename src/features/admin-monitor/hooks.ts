import { useQuery } from '@tanstack/react-query';
import { fetchSeatLayouts, fetchMonitorStudents, fetchRecentEvents } from './api';

export function useSeatLayoutsQuery() {
  return useQuery({
    queryKey: ['seat-layouts'],
    queryFn: fetchSeatLayouts,
    staleTime: Infinity, // 좌석 배치는 거의 변경되지 않음
  });
}

export function useMonitorStudentsQuery() {
  return useQuery({
    queryKey: ['admin-monitor-students'],
    queryFn: fetchMonitorStudents,
    staleTime: Infinity, // Realtime이 캐시 직접 관리
  });
}

export function useEventLogQuery() {
  return useQuery({
    queryKey: ['admin-monitor-events'],
    queryFn: () => fetchRecentEvents(40),
    staleTime: Infinity,
  });
}
