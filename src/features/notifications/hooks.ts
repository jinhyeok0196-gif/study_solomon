import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAdminNotifications, markNotificationRead } from './api';

export function useAdminNotificationsQuery() {
  return useQuery({
    queryKey: ['admin-notifications'],
    queryFn: fetchAdminNotifications,
    refetchInterval: 60_000, // realtime sync covers live updates; this is a fallback if a channel drops
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });
}
