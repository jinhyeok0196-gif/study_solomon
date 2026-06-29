import { describe, expect, it } from 'vitest';
import {
  attendedIntervalsFromRecords,
  awayDeductionMinutes,
  computeAttendanceStats,
  studySecondsForDay,
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

describe('studySecondsForDay', () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 5, 1, h, m, s).getTime();
  const iso = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();
  // 09:00 등원, 09:00~10:20 교시
  const checkedIn = makeRecord({
    status: 'present',
    classDate: '2026-06-01',
    periodStartTime: '09:00:00',
    periodEndTime: '10:20:00',
    checkedInAt: iso(9, 0),
  });

  it('counts elapsed presence within the in-progress period (live)', () => {
    // 09:00 등원, 09:30 시점 → 재실 ∩ 교시 = 30분 = 1800초
    expect(studySecondsForDay([checkedIn], [], [], at(9, 30))).toBe(1800);
  });

  it('keeps counting later periods after the first ends (presence-based, status 무관)', () => {
    // 1교시 09:00~10:00 (present, 등원기록), 2교시 10:10~11:10 (크론이 absent로 찍어도 인정)
    const p1 = makeRecord({ periodNumber: 1, status: 'present', periodStartTime: '09:00:00', periodEndTime: '10:00:00', checkedInAt: iso(9, 0) });
    const p2 = makeRecord({ periodNumber: 2, status: 'absent', periodStartTime: '10:10:00', periodEndTime: '11:10:00' });
    // 10:30 시점 → 1교시 60분(3600) + 2교시 10:10~10:30 20분(1200) = 4800
    expect(studySecondsForDay([p1, p2], [], [], at(10, 30))).toBe(4800);
  });

  it('freezes while an ongoing outing overlaps the period', () => {
    // 09:20부터 외출(진행 중), 현재 09:50 → 09:00~09:20 20분만 인정 = 1200초
    const away = [{ startedAt: iso(9, 20), endedAt: null }];
    expect(studySecondsForDay([checkedIn], [], away, at(9, 50))).toBe(20 * 60);
  });

  it('stops at checkout time', () => {
    // 09:00 등원, 09:40 하원 → 11:00에 봐도 40분(2400초)에서 확정
    const rec = makeRecord({ status: 'present', periodStartTime: '09:00:00', periodEndTime: '10:20:00', checkedInAt: iso(9, 0), checkedOutAt: iso(9, 40) });
    expect(studySecondsForDay([rec], [], [], at(11, 0))).toBe(40 * 60);
  });

  it('adds ongoing extra study time up to now', () => {
    const extra = [{ startedAt: iso(13, 0), endedAt: null }];
    // 교시 종료(80분=4800) + 진행 중 교시외공부 10분(600) = 5400초
    expect(studySecondsForDay([checkedIn], extra, [], at(13, 10))).toBe(5400);
  });

  it('returns 0 when the student never checked in (no presence)', () => {
    const noCheckin = makeRecord({ status: 'present', periodStartTime: '09:00:00', periodEndTime: '10:20:00' });
    expect(studySecondsForDay([noCheckin], [], [], at(9, 30))).toBe(0);
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
