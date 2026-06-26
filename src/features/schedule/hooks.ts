import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPendingScheduleUnlockRequest,
  fetchWeeklySchedule,
  requestScheduleUnlock,
  saveWeeklySchedule,
} from './api';
import type { ScheduleCell } from './types';

export function useWeeklyScheduleQuery(studentId: string, weekStartDate: string) {
  return useQuery({
    queryKey: ['weekly-schedule', studentId, weekStartDate],
    queryFn: () => fetchWeeklySchedule(studentId, weekStartDate),
    enabled: Boolean(studentId),
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

export function usePendingScheduleUnlockQuery(studentId: string, weekStartDate: string) {
  return useQuery({
    queryKey: ['schedule-unlock-pending', studentId, weekStartDate],
    queryFn: () => fetchPendingScheduleUnlockRequest(studentId, weekStartDate),
    enabled: Boolean(studentId),
  });
}

export function useRequestScheduleUnlockMutation(studentId: string, weekStartDate: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => requestScheduleUnlock(studentId, weekStartDate, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-unlock-pending', studentId, weekStartDate] });
    },
  });
}
