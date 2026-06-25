import { describe, expect, it } from 'vitest';
import { computeRiskLevel } from './risk';

describe('computeRiskLevel', () => {
  it('returns safe below the first warning threshold', () => {
    expect(computeRiskLevel(0).label).toBe('안전');
    expect(computeRiskLevel(9).label).toBe('안전');
  });

  it('returns first warning stage at 10-19 points', () => {
    expect(computeRiskLevel(10).label).toBe('1차 경고 단계');
    expect(computeRiskLevel(19).label).toBe('1차 경고 단계');
  });

  it('returns second warning stage at 20-29 points', () => {
    expect(computeRiskLevel(20).label).toBe('2차 경고 단계');
  });

  it('returns expulsion risk at 30+ points', () => {
    expect(computeRiskLevel(30).tone).toBe('danger');
    expect(computeRiskLevel(30).label).toBe('퇴원 위험');
  });
});
