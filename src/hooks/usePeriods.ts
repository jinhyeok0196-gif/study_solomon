import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export interface PeriodRow {
  period_number: number;
  display_name: string;
  label: string;
  start_time: string;
  end_time: string;
  category: 'class' | 'meal' | 'arrival' | 'free';
  duration_minutes: number | null;
  display_color: string;
  sort_order: number;
  is_selectable: boolean;
}

const PLACEHOLDER: PeriodRow[] = [
  { period_number: 0,  display_name: '0교시',   label: '0교시',   start_time: '08:30', end_time: '09:00', category: 'arrival', duration_minutes: 30,   display_color: '#9ca3af', sort_order: 5,   is_selectable: false },
  { period_number: 1,  display_name: '1교시',   label: '1교시',   start_time: '09:00', end_time: '10:20', category: 'class',   duration_minutes: 80,   display_color: '#16a34a', sort_order: 10,  is_selectable: true },
  { period_number: 2,  display_name: '2교시',   label: '2교시',   start_time: '10:40', end_time: '12:20', category: 'class',   duration_minutes: 100,  display_color: '#16a34a', sort_order: 20,  is_selectable: true },
  { period_number: 21, display_name: '점심식사', label: '점심식사', start_time: '12:20', end_time: '13:40', category: 'meal',    duration_minutes: 80,   display_color: '#eab308', sort_order: 30,  is_selectable: false },
  { period_number: 3,  display_name: '3교시',   label: '3교시',   start_time: '13:40', end_time: '15:00', category: 'class',   duration_minutes: 80,   display_color: '#16a34a', sort_order: 40,  is_selectable: true },
  { period_number: 4,  display_name: '4교시',   label: '4교시',   start_time: '15:20', end_time: '16:40', category: 'class',   duration_minutes: 80,   display_color: '#16a34a', sort_order: 50,  is_selectable: true },
  { period_number: 5,  display_name: '5교시',   label: '5교시',   start_time: '17:00', end_time: '18:10', category: 'class',   duration_minutes: 70,   display_color: '#16a34a', sort_order: 60,  is_selectable: true },
  { period_number: 22, display_name: '저녁식사', label: '저녁식사', start_time: '18:10', end_time: '19:30', category: 'meal',    duration_minutes: 80,   display_color: '#eab308', sort_order: 70,  is_selectable: false },
  { period_number: 6,  display_name: '6교시',   label: '6교시',   start_time: '19:30', end_time: '20:50', category: 'class',   duration_minutes: 80,   display_color: '#16a34a', sort_order: 80,  is_selectable: true },
  { period_number: 7,  display_name: '7교시',   label: '7교시',   start_time: '21:00', end_time: '22:00', category: 'class',   duration_minutes: 60,   display_color: '#16a34a', sort_order: 90,  is_selectable: true },
  { period_number: 8,  display_name: '8교시',   label: '8교시',   start_time: '22:20', end_time: '23:40', category: 'class',   duration_minutes: 80,   display_color: '#4ade80', sort_order: 100, is_selectable: true },
  { period_number: 23, display_name: '자율학습', label: '자율학습', start_time: '23:40', end_time: '08:30', category: 'free',    duration_minutes: null, display_color: '#bbf7d0', sort_order: 110, is_selectable: false },
];

/**
 * 교시 번호 목록을 보기 좋은 라벨로 변환한다.
 * 수업 교시는 'N교시', 특수 교시는 이름(자율학습/점심식사/저녁식사/0교시 등) 그대로.
 * (예전 데이터로 자율학습(23)·식사(22)가 '23교시'처럼 뜨던 문제 해결)
 */
export function formatPeriodNumbers(
  periodNumbers: number[] | null | undefined,
  periods: PeriodRow[] | undefined
): string {
  if (!periodNumbers || periodNumbers.length === 0) return '-';
  const byNum = new Map((periods ?? PLACEHOLDER).map((p) => [p.period_number, p]));
  return [...periodNumbers]
    .sort((a, b) => a - b)
    .map((n) => byNum.get(n)?.display_name || `${n}교시`)
    .join(', ');
}

export function usePeriods() {
  return useQuery({
    queryKey: ['periods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('periods')
        .select('period_number, label, display_name, start_time, end_time, category, duration_minutes, display_color, sort_order, is_selectable')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        display_name: row.display_name ?? row.label,
        category: (row.category ?? 'class') as PeriodRow['category'],
      })) as PeriodRow[];
    },
    staleTime: 1000 * 60 * 60,
    placeholderData: PLACEHOLDER,
  });
}
