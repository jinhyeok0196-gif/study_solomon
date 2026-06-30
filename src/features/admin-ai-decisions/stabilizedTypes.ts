// =========================================================================
// Admin AI Dashboard — Stabilized Candidate(안정화 후보) 타입
// =========================================================================
// 최근 3~5개 ai_rule_decisions 를 프론트에서 묶어 계산한 "안정화된 AI 추정 후보".
// ⚠️ StabilizedCandidate 는 **실제 학생 상태가 아니다.** 안정화된 AI 추정 후보일 뿐이다.
//    DB 에 저장하지 않는다(read-derived). 학생 상태/출결/벌점/알림 변경 없음.
// =========================================================================

import type { Activity, Severity } from './types';

export type StabilizedStatus =
  | 'STABLE'
  | 'UNSTABLE'
  | 'INSUFFICIENT_DATA'
  | 'LOW_CONFIDENCE'
  | 'CONFLICTED';

export interface StabilizedCandidate {
  candidate_uuid: string;
  seat_id: string;
  activity: Activity;            // STABLE 일 때만 실제 활동, 그 외 UNKNOWN
  confidence: number;            // 0~1 (후보 activity 평균 신뢰도)
  status: StabilizedStatus;
  severity: Severity;
  window_size: number;
  decision_count: number;
  decided_from: string | null;   // ISO
  decided_to: string | null;     // ISO
  generated_at: string;          // ISO

  activity_counts: Record<string, number>;
  confidence_by_activity: Record<string, number>;
  source_decision_uuids: string[];
  reasons: string[];
  evidence: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ── 안정화 옵션(Python decision_stabilizer.py 와 방향 일치) ────────────────

export interface StabilizerOptions {
  window: { maxDecisions: number; minDecisions: number; maxAgeMinutes: number };
  thresholds: {
    stableRatio: number;
    minAverageConfidence: number;
    phoneMinCount: number;
    absentMinCount: number;
    sleepingMinCount: number;
    studyingMinCount: number;
    conflictMargin: number;
  };
  weights: { latestWeight: number; normalWeight: number; lowConfidencePenalty: number };
  /** 기준 시각(ms). 미지정 시 입력 중 가장 최근 decided_at 을 기준으로 한다. */
  nowMs?: number;
}

export const DEFAULT_STABILIZER_OPTIONS: StabilizerOptions = {
  window: { maxDecisions: 5, minDecisions: 3, maxAgeMinutes: 15 },
  thresholds: {
    stableRatio: 0.6,
    minAverageConfidence: 0.55,
    phoneMinCount: 2,
    absentMinCount: 2,
    sleepingMinCount: 2,
    studyingMinCount: 2,
    conflictMargin: 0.15,
  },
  weights: { latestWeight: 1.2, normalWeight: 1.0, lowConfidencePenalty: 0.5 },
};

/** 후보 status 한글 라벨(절대 "확정" 이라 하지 않는다 — "안정"/"보류"). */
export const STABILIZED_STATUS_LABEL: Record<StabilizedStatus, string> = {
  STABLE: '안정',
  UNSTABLE: '신호 섞임',
  INSUFFICIENT_DATA: '데이터 부족',
  LOW_CONFIDENCE: '낮은 신뢰',
  CONFLICTED: '판정 보류',
};
