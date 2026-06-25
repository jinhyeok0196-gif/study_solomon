import type { DayOfWeek, PeriodNumber } from '@/constants/periods';

export interface ScheduleCell {
  dayOfWeek: DayOfWeek;
  periodNumber: PeriodNumber;
}

export function cellKey(dayOfWeek: DayOfWeek, periodNumber: number): string {
  return `${dayOfWeek}-${periodNumber}`;
}
