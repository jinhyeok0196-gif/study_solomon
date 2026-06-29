import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createManualPenalty,
  createPenaltyRecord,
  fetchAllPenaltyRecords,
  type CreatePenaltyInput,
  type ManualPenaltyInput,
} from './api';

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

export function useCreateManualPenaltyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualPenaltyInput) => createManualPenalty(input),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-penalty-records'] });
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      queryClient.invalidateQueries({ queryKey: ['penalty-profile', vars.studentId] });
      queryClient.invalidateQueries({ queryKey: ['penalty-records', vars.studentId] });
    },
  });
}
