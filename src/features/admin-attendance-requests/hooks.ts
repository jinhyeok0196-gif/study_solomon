import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RequestKind } from '@/features/requests/types';
import { fetchAttendanceRequests, reviewAttendanceRequest } from './api';

const QUERY_KEY = ['admin', 'attendance-requests'];

export function useAttendanceRequestsQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAttendanceRequests,
  });
}

export function useReviewAttendanceRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      requestId,
      status,
      adminId,
    }: {
      kind: RequestKind;
      requestId: string;
      status: 'approved' | 'rejected';
      adminId: string;
    }) => reviewAttendanceRequest(kind, requestId, status, adminId),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
