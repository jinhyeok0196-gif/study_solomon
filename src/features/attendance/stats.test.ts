import { describe, expect, it } from 'vitest';
import { computeAttendanceStats, recordStudyMinutes } from './stats';
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
  it('uses actual check-in/out duration when both are recorded', () => {
    const record = makeRecord({
      checkedInAt: '2026-06-01T09:00:00Z',
      checkedOutAt: '2026-06-01T09:50:00Z',
    });
    expect(recordStudyMinutes(record)).toBe(50);
  });

  it('falls back to the full period duration when present without check times', () => {
    expect(recordStudyMinutes(makeRecord({ status: 'present' }))).toBe(80);
  });

  it('returns 0 for absences', () => {
    expect(recordStudyMinutes(makeRecord({ status: 'absent' }))).toBe(0);
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

  it('handles zero records without dividing by zero', () => {
    const stats = computeAttendanceStats([], []);
    expect(stats.attendanceRate).toBe(0);
    expect(stats.absenceRate).toBe(0);
  });
});
