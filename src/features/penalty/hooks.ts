import { useQuery } from '@tanstack/react-query';
import { fetchPenaltyProfile, fetchPenaltyRecords, fetchWarningRecords } from './api';

export function usePenaltyProfileQuery(studentId: string) {
  return useQuery({
    queryKey: ['penalty-profile', studentId],
    queryFn: () => fetchPenaltyProfile(studentId),
  });
}

export function usePenaltyRecordsQuery(studentId: string) {
  return useQuery({
    queryKey: ['penalty-records', studentId],
    queryFn: () => fetchPenaltyRecords(studentId),
  });
}

export function useWarningRecordsQuery(studentId: string) {
  return useQuery({
    queryKey: ['warning-records', studentId],
    queryFn: () => fetchWarningRecords(studentId),
  });
}
