import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelRequest, createRequest, fetchMyRequests } from './api';
import type { RequestKind } from './types';
import type { RequestFormValues } from './schema';

export function useMyRequestsQuery(kind: RequestKind, studentId: string) {
  return useQuery({
    queryKey: ['requests', kind, studentId],
    queryFn: () => fetchMyRequests(kind, studentId),
  });
}

export function useCreateRequestMutation(kind: RequestKind, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: RequestFormValues) => createRequest(kind, studentId, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests', kind, studentId] });
    },
  });
}

export function useCancelRequestMutation(kind: RequestKind, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelRequest(kind, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests', kind, studentId] });
    },
  });
}
