import { WARNING_THRESHOLDS } from '@/constants/penaltyRules';

export type RiskTone = 'success' | 'warning' | 'danger';

export interface RiskLevel {
  label: string;
  tone: RiskTone;
}

export function computeRiskLevel(currentPenaltyPoints: number): RiskLevel {
  if (currentPenaltyPoints >= WARNING_THRESHOLDS.EXPULSION) {
    return { label: '퇴원 위험', tone: 'danger' };
  }
  if (currentPenaltyPoints >= WARNING_THRESHOLDS.SECOND_WARNING) {
    return { label: '2차 경고 단계', tone: 'danger' };
  }
  if (currentPenaltyPoints >= WARNING_THRESHOLDS.FIRST_WARNING) {
    return { label: '1차 경고 단계', tone: 'warning' };
  }
  return { label: '안전', tone: 'success' };
}
