import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { DEFAULT_PERIODS } from '@/constants/periods';

const PLACEHOLDER_PERIODS = DEFAULT_PERIODS.map((period) => ({
  period_number: period.period,
  label: period.label,
  start_time: period.startTime,
  end_time: period.endTime,
}));

export function usePeriods() {
  return useQuery({
    queryKey: ['periods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('periods')
        .select('period_number, label, start_time, end_time')
        .eq('is_active', true)
        .order('period_number');
      if (error) throw error;
      return data;
    },
    staleTime: 1000 * 60 * 60,
    placeholderData: PLACEHOLDER_PERIODS,
  });
}
