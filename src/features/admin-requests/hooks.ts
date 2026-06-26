import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveRequestLog, fetchAllRequestLogs, rejectRequestLog } from './api';

const QUERY_KEY = ['admin', 'request-logs'];

export function useAllRequestLogsQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAllRequestLogs,
  });
}

export function useApproveRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      adminId,
      adminNote,
    }: {
      requestId: string;
      adminId: string;
      adminNote?: string;
    }) => approveRequestLog(requestId, adminId, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useRejectRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      adminId,
      adminNote,
    }: {
      requestId: string;
      adminId: string;
      adminNote?: string;
    }) => rejectRequestLog(requestId, adminId, adminNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
