import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOuting, fetchOngoingOuting, fetchRecentOutings, startOuting } from './api';

export function useOngoingOutingQuery(studentId: string) {
  return useQuery({
    queryKey: ['outing-ongoing', studentId],
    queryFn: () => fetchOngoingOuting(studentId),
  });
}

export function useRecentOutingsQuery(studentId: string) {
  return useQuery({
    queryKey: ['outing-recent', studentId],
    queryFn: () => fetchRecentOutings(studentId),
  });
}

export function useAllOutingsQuery(studentId: string) {
  return useQuery({
    queryKey: ['outing-all', studentId],
    queryFn: () => fetchRecentOutings(studentId, 500),
    enabled: !!studentId,
  });
}

export function useOutingMutations(studentId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['outing-ongoing', studentId] });
    queryClient.invalidateQueries({ queryKey: ['outing-recent', studentId] });
  };

  const start = useMutation({
    mutationFn: (reason?: string) => startOuting(studentId, reason),
    onSuccess: invalidate,
  });

  const end = useMutation({
    mutationFn: (outingId: string) => endOuting(outingId),
    onSuccess: invalidate,
  });

  return { start, end };
}
