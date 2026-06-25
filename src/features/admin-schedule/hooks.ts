import { useQuery } from '@tanstack/react-query';
import { fetchScheduleForDate, fetchWeeklySubmissionStatuses } from './api';

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
