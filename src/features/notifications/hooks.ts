import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAdminNotifications, markNotificationRead } from './api';

export function useAdminNotificationsQuery() {
  return useQuery({
    queryKey: ['admin-notifications'],
    queryFn: fetchAdminNotifications,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });
}
