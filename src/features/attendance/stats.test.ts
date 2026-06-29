import { describe, expect, it } from 'vitest';
import {
  attendedIntervalsFromRecords,
  awayDeductionMinutes,
  computeAttendanceStats,
  recordStudyMinutes,
} from './stats';
import type { AttendanceRecordWithPeriod } from './api';

function makeRecord(overrides: Partial<AttendanceRecordWithPeriod>): AttendanceRecordWithPeriod {
  return {
    classDate: '2026-06-01',
    periodNumber: 1,
    status: 'present',
    checkedInAt: null,
    checkedOutAt: null,
    periodStartTime: '09:00:00',
    periodEndTime: '10:20:00',
    ...overrides,
  };
}

describe('recordStudyMinutes', () => {
  it('counts the full period duration for present (ignores check-in/out span so breaks/meals are excluded)', () => {
    const record = makeRecord({
      status: 'present',
      checkedInAt: '2026-06-01T09:00:00Z',
      checkedOutAt: '2026-06-01T20:00:00Z', // 하원까지 전체 구간이어도 교시 시간(80분)만 집계
    });
    expect(recordStudyMinutes(record)).toBe(80);
  });

  it('counts the period duration for present and late', () => {
    expect(recordStudyMinutes(makeRecord({ status: 'present' }))).toBe(80);
    expect(recordStudyMinutes(makeRecord({ status: 'late' }))).toBe(80);
  });

  it('returns 0 for absences and early leave (skipped periods)', () => {
    expect(recordStudyMinutes(makeRecord({ status: 'absent' }))).toBe(0);
    expect(recordStudyMinutes(makeRecord({ status: 'early_leave' }))).toBe(0);
    expect(recordStudyMinutes(makeRecord({ status: 'excused_absence' }))).toBe(0);
  });
});

describe('computeAttendanceStats', () => {
  it('computes rates from the monthly subset and cumulative minutes from all records', () => {
    const monthRecords = [
      makeRecord({ status: 'present' }),
      makeRecord({ status: 'late' }),
      makeRecord({ status: 'absent' }),
      makeRecord({ status: 'absent' }),
    ];
    const allRecords = [...monthRecords, makeRecord({ status: 'present', classDate: '2026-01-01' })];

    const stats = computeAttendanceStats(allRecords, monthRecords);

    expect(stats.totalRecords).toBe(4);
    expect(stats.attendanceRate).toBe(0.5);
    expect(stats.absenceRate).toBe(0.5);
    expect(stats.lateCount).toBe(1);
    expect(stats.cumulativeStudyMinutes).toBe(80 * 3);
  });

  it('adds extra study minutes to cumulative study time', () => {
    const records = [makeRecord({ status: 'present' })];
    const stats = computeAttendanceStats(records, records, 45);
    expect(stats.cumulativeStudyMinutes).toBe(80 + 45);
  });

  it('subtracts away (outing/nap) deduction and clamps at 0', () => {
    const records = [makeRecord({ status: 'present' })]; // 80분
    expect(computeAttendanceStats(records, records, 0, 20).cumulativeStudyMinutes).toBe(60);
    expect(computeAttendanceStats(records, records, 0, 999).cumulativeStudyMinutes).toBe(0);
  });

  it('handles zero records without dividing by zero', () => {
    const stats = computeAttendanceStats([], []);
    expect(stats.attendanceRate).toBe(0);
    expect(stats.absenceRate).toBe(0);
  });
});

describe('awayDeductionMinutes', () => {
  const present = makeRecord({
    status: 'present',
    classDate: '2026-06-01',
    periodStartTime: '09:00:00',
    periodEndTime: '10:20:00',
  });

  it('deducts the overlap of away logs with attended class periods', () => {
    const intervals = attendedIntervalsFromRecords([present]);
    const away = [
      { startedAt: new Date(2026, 5, 1, 9, 10).toISOString(), endedAt: new Date(2026, 5, 1, 9, 30).toISOString() },
    ];
    expect(awayDeductionMinutes(intervals, away)).toBe(20);
  });

  it('does not deduct away time outside class periods', () => {
    const intervals = attendedIntervalsFromRecords([present]);
    const away = [
      { startedAt: new Date(2026, 5, 1, 12, 0).toISOString(), endedAt: new Date(2026, 5, 1, 12, 30).toISOString() },
    ];
    expect(awayDeductionMinutes(intervals, away)).toBe(0);
  });
});
