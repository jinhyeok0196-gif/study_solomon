import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllWarningRecords, manualExpelStudent } from './api';

export function useWarningRecordsFeedQuery() {
  return useQuery({
    queryKey: ['admin-warning-records'],
    queryFn: () => fetchAllWarningRecords(),
  });
}

export function useManualExpelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: manualExpelStudent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-warning-records'] });
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
    },
  });
}
