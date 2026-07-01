// =========================================================================
// Admin AI Dashboard (Read-only) — 타입 정의
// =========================================================================
// ai_rule_decisions 테이블 1행 = RuleEngine v0.1 의 1차 판정(RuleDecision) 저장 결과.
// ⚠️ 읽기 전용. 이 타입을 쓰는 화면은 학생 상태/출결/벌점/알림을 절대 바꾸지 않는다.
// =========================================================================

export type Activity = 'STUDYING' | 'PHONE' | 'SLEEPING' | 'ABSENT' | 'UNKNOWN';
export type DecisionStatus = 'SUCCESS' | 'SKIPPED' | 'FAILED' | 'LOW_CONFIDENCE';
export type Severity = 'INFO' | 'WATCH' | 'WARNING' | 'CRITICAL';

/** ai_rule_decisions 테이블 1행(DB 컬럼명 그대로). */
export interface AIDecisionRow {
  id: string;
  decision_uuid: string;
  facts_uuid: string | null;
  burst_uuid: string | null;
  seat_id: string;
  period_id: string | null;
  period_name: string | null;
  decided_at: string;            // ISO
  activity: Activity;
  confidence: number | null;     // 0~1
  status: DecisionStatus;
  severity: Severity;
  reasons: string[];
  evidence: Record<string, unknown>;
  rule_hits: Array<Record<string, unknown>>;
  quality: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AIDecisionFilters {
  seatId?: string;
  activity?: Activity;
  status?: DecisionStatus;
  severity?: Severity;
  limit?: number;
}

// ── 화면 표시 설정(색상/라벨) — 기존 관리자 대시보드 톤에 맞춤 ──────────────

export interface ActivityConfig {
  label: string;
  emoji: string;
  cardClass: string;   // 카드 배경/테두리
  badgeClass: string;  // 뱃지 배경/글자
  dotClass: string;    // 상태 점
}

export const ACTIVITY_CONFIG: Record<Activity, ActivityConfig> = {
  STUDYING: {
    label: '공부 추정', emoji: '🟢',
    cardClass: 'bg-green-50 border-green-300',
    badgeClass: 'bg-green-100 text-green-700',
    dotClass: 'bg-green-500',
  },
  PHONE: {
    label: '휴대폰 추정', emoji: '🔴',
    cardClass: 'bg-red-50 border-red-300',
    badgeClass: 'bg-red-100 text-red-700',
    dotClass: 'bg-red-500',
  },
  SLEEPING: {
    label: '수면 추정', emoji: '🟣',
    cardClass: 'bg-purple-50 border-purple-300',
    badgeClass: 'bg-purple-100 text-purple-700',
    dotClass: 'bg-purple-500',
  },
  ABSENT: {
    label: '자리비움 추정', emoji: '⚫',
    cardClass: 'bg-slate-50 border-slate-300',
    badgeClass: 'bg-slate-200 text-slate-700',
    dotClass: 'bg-slate-500',
  },
  UNKNOWN: {
    label: '판정 불가', emoji: '⚪',
    cardClass: 'bg-gray-50 border-gray-200',
    badgeClass: 'bg-gray-100 text-gray-500',
    dotClass: 'bg-gray-300',
  },
};

export const SEVERITY_CONFIG: Record<Severity, { label: string; badgeClass: string }> = {
  INFO: { label: '정보', badgeClass: 'bg-gray-100 text-gray-600' },
  WATCH: { label: '주의', badgeClass: 'bg-amber-100 text-amber-700' },
  WARNING: { label: '경고', badgeClass: 'bg-orange-100 text-orange-700' },
  CRITICAL: { label: '심각', badgeClass: 'bg-red-100 text-red-700' },
};

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  SUCCESS: '판정 완료',
  SKIPPED: '건너뜀',
  FAILED: '실패',
  LOW_CONFIDENCE: '낮은 신뢰',
};

/** 현재 좌석 수(8석). 추후 설정값으로 분리 가능. */
export const SEAT_IDS: string[] = ['Seat1', 'Seat2', 'Seat3', 'Seat4', 'Seat5', 'Seat6', 'Seat7', 'Seat8'];

/** AI 판정이 "오래됨"으로 간주되는 기준(분). */
export const STALE_MINUTES = 10;
/** confidence 가 이 미만이면 "신뢰 낮음" 표시. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** 관리자 화면 공통 안내(자동 변경 아님). */
export const AI_DISCLAIMER =
  'AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.';

// ── 표시용 헬퍼 ──────────────────────────────────────────────────────────

export function confidencePercent(confidence: number | null): number {
  return Math.round(Math.max(0, Math.min(1, confidence ?? 0)) * 100);
}

export function overallQuality(row: AIDecisionRow): number | null {
  const v = (row.quality ?? {})['overall_quality'];
  return typeof v === 'number' ? v : null;
}

export function minutesSince(iso: string, nowMs: number): number {
  return Math.floor((nowMs - new Date(iso).getTime()) / 60000);
}

export function isStale(iso: string, nowMs: number): boolean {
  return minutesSince(iso, nowMs) >= STALE_MINUTES;
}

/**
 * UNKNOWN 판정의 원인을 "카메라 연결 성공 / 판정 신호 부족" 관점으로 구분한다.
 * (읽기 전용 보조 표시일 뿐 — 학생 상태/출결/벌점은 자동 변경되지 않는다.)
 *
 * 반환:
 *  - UNKNOWN 이 아니면 null
 *  - vision_quality > 0 (프레임·품질 성공) → '카메라 연결 성공 · 판정 신호 부족'
 *  - 그 외 → '판정 신호 부족'
 */
export function unknownSignalHint(row: AIDecisionRow): string | null {
  if (row.activity !== 'UNKNOWN') return null;
  const q = row.quality ?? {};
  const visionQ = q['vision_quality'];
  const cameraOk = typeof visionQ === 'number' && visionQ > 0;
  return cameraOk ? '카메라 연결 성공 · 판정 신호 부족' : '판정 신호 부족';
}
