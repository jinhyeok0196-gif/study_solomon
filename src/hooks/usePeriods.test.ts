import { describe, expect, it } from 'vitest';
import { formatPeriodNumbers, type PeriodRow } from './usePeriods';

const periods: PeriodRow[] = [
  { period_number: 1, display_name: '1교시', label: '1교시', start_time: '09:00', end_time: '10:20', category: 'class', duration_minutes: 80, display_color: '#000', sort_order: 10, is_selectable: true },
  { period_number: 2, display_name: '2교시', label: '2교시', start_time: '10:30', end_time: '11:50', category: 'class', duration_minutes: 80, display_color: '#000', sort_order: 20, is_selectable: true },
  { period_number: 22, display_name: '저녁식사', label: '저녁식사', start_time: '18:10', end_time: '19:30', category: 'meal', duration_minutes: 80, display_color: '#000', sort_order: 70, is_selectable: false },
  { period_number: 23, display_name: '자율학습', label: '자율학습', start_time: '23:40', end_time: '08:30', category: 'free', duration_minutes: null, display_color: '#000', sort_order: 110, is_selectable: false },
];

describe('formatPeriodNumbers', () => {
  it('수업 교시는 N교시로', () => {
    expect(formatPeriodNumbers([1, 2], periods)).toBe('1교시, 2교시');
  });
  it('특수 교시는 이름으로 (23교시 대신 자율학습)', () => {
    expect(formatPeriodNumbers([23], periods)).toBe('자율학습');
    expect(formatPeriodNumbers([22], periods)).toBe('저녁식사');
  });
  it('섞이면 번호순 정렬 + 각자 라벨', () => {
    expect(formatPeriodNumbers([23, 1], periods)).toBe('1교시, 자율학습');
  });
  it('빈 목록은 -', () => {
    expect(formatPeriodNumbers([], periods)).toBe('-');
    expect(formatPeriodNumbers(null, periods)).toBe('-');
  });
  it('periods 없으면 PLACEHOLDER로 폴백', () => {
    expect(formatPeriodNumbers([23], undefined)).toBe('자율학습');
  });
});
