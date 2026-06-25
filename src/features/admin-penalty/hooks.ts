import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPenaltyRecord, fetchAllPenaltyRecords, type CreatePenaltyInput } from './api';

export function usePenaltyRecordsFeedQuery() {
  return useQuery({
    queryKey: ['admin-penalty-records'],
    queryFn: () => fetchAllPenaltyRecords(),
  });
}

export function useCreatePenaltyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePenaltyInput) => createPenaltyRecord(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-penalty-records'] });
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
    },
  });
}
