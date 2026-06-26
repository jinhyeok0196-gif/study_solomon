import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveScheduleUnlock,
  fetchScheduleForDate,
  fetchScheduleUnlockRequests,
  fetchWeeklySubmissionStatuses,
  rejectScheduleUnlock,
} from './api';

export function useScheduleForDateQuery(dateStr: string) {
  return useQuery({
    queryKey: ['admin-schedule-by-date', dateStr],
    queryFn: () => fetchScheduleForDate(dateStr),
  });
}

export function useWeeklySubmissionStatusesQuery(weekStartDate: string) {
  return useQuery({
    queryKey: ['admin-weekly-submission-statuses', weekStartDate],
    queryFn: () => fetchWeeklySubmissionStatuses(weekStartDate),
  });
}

const UNLOCK_REQUESTS_KEY = ['admin', 'schedule-unlock-requests'];

export function useScheduleUnlockRequestsQuery() {
  return useQuery({
    queryKey: UNLOCK_REQUESTS_KEY,
    queryFn: fetchScheduleUnlockRequests,
  });
}

export function useApproveScheduleUnlockMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      adminId,
      adminNote,
    }: {
      requestId: string;
      adminId: string;
      adminNote?: string;
    }) => approveScheduleUnlock(requestId, adminId, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: UNLOCK_REQUESTS_KEY }),
  });
}

export function useRejectScheduleUnlockMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      adminId,
      adminNote,
    }: {
      requestId: string;
      adminId: string;
      adminNote?: string;
    }) => rejectScheduleUnlock(requestId, adminId, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: UNLOCK_REQUESTS_KEY }),
  });
}
