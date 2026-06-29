import { useQuery } from '@tanstack/react-query';
import { fetchAdminOutings } from './api';

export function useAdminOutingsQuery() {
  return useQuery({
    queryKey: ['admin', 'outings'],
    queryFn: () => fetchAdminOutings(),
  });
}
