import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSeatLayouts,
  fetchMonitorStudents,
  fetchRecentEvents,
  fetchAssignableStudents,
  assignSeat,
  unassignSeat,
} from './api';

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

export function useAssignableStudentsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-monitor-assignable-students'],
    queryFn: fetchAssignableStudents,
    enabled,
    staleTime: 1000 * 30,
  });
}

export function useSeatAssignMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-monitor-students'] });
    qc.invalidateQueries({ queryKey: ['admin-monitor-assignable-students'] });
    qc.invalidateQueries({ queryKey: ['admin-students'] });
  };
  const assign = useMutation({
    mutationFn: ({ studentId, seatNumber }: { studentId: string; seatNumber: number }) =>
      assignSeat(studentId, seatNumber),
    onSuccess: invalidate,
  });
  const unassign = useMutation({
    mutationFn: (studentId: string) => unassignSeat(studentId),
    onSuccess: invalidate,
  });
  return { assign, unassign };
}
