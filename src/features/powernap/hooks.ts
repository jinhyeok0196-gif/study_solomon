import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endNap, fetchTodayNap, startNap } from './api';

export function useTodayNapQuery(studentId: string) {
  return useQuery({
    queryKey: ['power-nap-today', studentId],
    queryFn: () => fetchTodayNap(studentId),
  });
}

export function useNapMutations(studentId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['power-nap-today', studentId] });

  const start = useMutation({
    mutationFn: (maxMinutes: number) => startNap(studentId, maxMinutes),
    onSuccess: invalidate,
  });

  const end = useMutation({
    mutationFn: (napId: string) => endNap(napId),
    onSuccess: invalidate,
  });

  return { start, end };
}
