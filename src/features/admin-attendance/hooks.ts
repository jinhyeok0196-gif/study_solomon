import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAttendanceForDate, upsertAttendance } from './api';

export function useAttendanceForDateQuery(date: string) {
  return useQuery({
    queryKey: ['admin-attendance-by-date', date],
    queryFn: () => fetchAttendanceForDate(date),
  });
}

export function useUpsertAttendanceMutation(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertAttendance,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-attendance-by-date', date] }),
  });
}
