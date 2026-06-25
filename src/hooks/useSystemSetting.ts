import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export function useSystemSetting<T>(key: string, fallback: T) {
  return useQuery({
    queryKey: ['system-setting', key],
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return data ? (data.value as T) : fallback;
    },
    staleTime: 1000 * 60 * 60,
  });
}
