import { describe, expect, it } from 'vitest';
import {
  dayOfWeekKeyOf,
  formatWeekRangeLabel,
  getWeekStartDate,
  listRecentWeekStartDates,
  weekStartDateOf,
} from './dates';

describe('getWeekStartDate', () => {
  it('returns the Monday of the current week for offset 0', () => {
    // 2026-06-25 is a Thursday
    const thursday = new Date('2026-06-25T10:00:00');
    expect(getWeekStartDate(0, thursday)).toBe('2026-06-22');
  });

  it('shifts by whole weeks for non-zero offsets', () => {
    const thursday = new Date('2026-06-25T10:00:00');
    expect(getWeekStartDate(1, thursday)).toBe('2026-06-29');
    expect(getWeekStartDate(-1, thursday)).toBe('2026-06-15');
  });
});

describe('formatWeekRangeLabel', () => {
  it('formats a Monday-to-Sunday range', () => {
    expect(formatWeekRangeLabel('2026-06-22')).toBe('6/22 ~ 6/28');
  });
});

describe('listRecentWeekStartDates', () => {
  it('lists week start dates going backwards from the current week', () => {
    const thursday = new Date('2026-06-25T10:00:00');
    expect(listRecentWeekStartDates(3, thursday)).toEqual([
      '2026-06-22',
      '2026-06-15',
      '2026-06-08',
    ]);
  });
});

describe('weekStartDateOf', () => {
  it('returns the Monday of the week containing the given date', () => {
    expect(weekStartDateOf('2026-06-25')).toBe('2026-06-22');
    expect(weekStartDateOf('2026-06-22')).toBe('2026-06-22');
    expect(weekStartDateOf('2026-06-28')).toBe('2026-06-22');
  });
});

describe('dayOfWeekKeyOf', () => {
  it('maps a date string to its day-of-week key', () => {
    expect(dayOfWeekKeyOf('2026-06-22')).toBe('mon');
    expect(dayOfWeekKeyOf('2026-06-25')).toBe('thu');
    expect(dayOfWeekKeyOf('2026-06-28')).toBe('sun');
  });
});
