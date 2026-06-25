import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWeeklySchedule, saveWeeklySchedule } from './api';
import type { ScheduleCell } from './types';

export function useWeeklyScheduleQuery(studentId: string, weekStartDate: string) {
  return useQuery({
    queryKey: ['weekly-schedule', studentId, weekStartDate],
    queryFn: () => fetchWeeklySchedule(studentId, weekStartDate),
  });
}

export function useSaveWeeklyScheduleMutation(studentId: string, weekStartDate: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { cells: ScheduleCell[]; submit: boolean }) =>
      saveWeeklySchedule({ studentId, weekStartDate, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-schedule', studentId, weekStartDate] });
    },
  });
}
