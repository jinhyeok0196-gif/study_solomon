import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  endExtraStudy,
  fetchAllExtraStudy,
  fetchOngoingExtraStudy,
  fetchTodayExtraStudy,
  startExtraStudy,
} from './api';

export function useOngoingExtraStudyQuery(studentId: string) {
  return useQuery({
    queryKey: ['extra-study-ongoing', studentId],
    queryFn: () => fetchOngoingExtraStudy(studentId),
    enabled: !!studentId,
  });
}

export function useTodayExtraStudyQuery(studentId: string) {
  return useQuery({
    queryKey: ['extra-study-today', studentId],
    queryFn: () => fetchTodayExtraStudy(studentId),
    enabled: !!studentId,
  });
}

export function useAllExtraStudyQuery(studentId: string) {
  return useQuery({
    queryKey: ['extra-study-all', studentId],
    queryFn: () => fetchAllExtraStudy(studentId),
    enabled: !!studentId,
  });
}

export function useExtraStudyMutations(studentId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['extra-study-ongoing', studentId] });
    qc.invalidateQueries({ queryKey: ['extra-study-today', studentId] });
    qc.invalidateQueries({ queryKey: ['extra-study-all', studentId] });
  };

  const start = useMutation({
    mutationFn: () => startExtraStudy(studentId),
    onSuccess: invalidate,
  });

  const end = useMutation({
    mutationFn: (logId: string) => endExtraStudy(logId),
    onSuccess: invalidate,
  });

  return { start, end };
}
