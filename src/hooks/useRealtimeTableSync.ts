import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export function useRealtimeTableSync(table: string, queryKeys: QueryKey[]) {
  const queryClient = useQueryClient();
  const keysSignature = JSON.stringify(queryKeys);

  useEffect(() => {
    const channel = supabase
      .channel(`realtime-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // keysSignature stands in for queryKeys so the effect only re-subscribes when the keys actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, keysSignature, queryClient]);
}
