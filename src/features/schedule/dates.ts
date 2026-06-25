import { addWeeks, format, startOfWeek } from 'date-fns';
import type { DayOfWeek } from '@/constants/periods';

const JS_DAY_INDEX_TO_KEY: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function todayDayOfWeekKey(date: Date = new Date()): DayOfWeek {
  return JS_DAY_INDEX_TO_KEY[date.getDay()];
}

export function getWeekStartDate(offsetWeeks: number, base: Date = new Date()): string {
  const monday = startOfWeek(base, { weekStartsOn: 1 });
  return format(addWeeks(monday, offsetWeeks), 'yyyy-MM-dd');
}

export function formatWeekRangeLabel(weekStartDate: string): string {
  const start = new Date(`${weekStartDate}T00:00:00`);
  const end = addWeeks(start, 0);
  end.setDate(start.getDate() + 6);
  return `${format(start, 'M/d')} ~ ${format(end, 'M/d')}`;
}

export function listRecentWeekStartDates(count: number, base: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, index) => getWeekStartDate(-index, base));
}

export function weekStartDateOf(dateStr: string): string {
  return format(startOfWeek(new Date(`${dateStr}T00:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function dayOfWeekKeyOf(dateStr: string): DayOfWeek {
  return todayDayOfWeekKey(new Date(`${dateStr}T00:00:00`));
}
