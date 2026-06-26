import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyProfile,
  fetchMyRequestLogs,
  fetchStudentNotifications,
  markStudentNotificationRead,
  submitRequestLog,
} from './api';
import type { RequestType } from './types';

export const mypageKeys = {
  profile: (id: string) => ['mypage', 'profile', id] as const,
  requestLogs: (id: string) => ['mypage', 'request-logs', id] as const,
  notifications: (id: string) => ['mypage', 'notifications', id] as const,
};

export function useMyProfileQuery(userId: string) {
  return useQuery({
    queryKey: mypageKeys.profile(userId),
    queryFn: () => fetchMyProfile(userId),
  });
}

export function useMyRequestLogsQuery(studentId: string) {
  return useQuery({
    queryKey: mypageKeys.requestLogs(studentId),
    queryFn: () => fetchMyRequestLogs(studentId),
  });
}

export function useSubmitRequestLogMutation(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestType,
      reason,
      newValue,
    }: {
      requestType: RequestType;
      reason: string;
      newValue?: string;
    }) => submitRequestLog(studentId, requestType, reason, newValue),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mypageKeys.requestLogs(studentId) });
    },
  });
}

export function useStudentNotificationsQuery(studentId: string) {
  return useQuery({
    queryKey: mypageKeys.notifications(studentId),
    queryFn: () => fetchStudentNotifications(studentId),
  });
}

export function useMarkStudentNotificationReadMutation(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markStudentNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mypageKeys.notifications(studentId) });
    },
  });
}
