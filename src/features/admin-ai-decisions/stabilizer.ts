// =========================================================================
// Admin AI Dashboard — 프론트엔드 Stabilizer(read-derived)
// =========================================================================
// AIDecisionRow[] 를 입력받아 좌석별 "안정화된 AI 추정 후보"(StabilizedCandidate)를 계산.
// Python decision_stabilizer.py 와 판단 방향을 맞춘다(다수결 + 최신/신뢰 가중 + 보수 처리).
//
// ⚠️ read-derived 계산일 뿐 DB 저장/수정/삭제 없음. 학생 상태/출결/벌점/알림 변경 없음.
// =========================================================================

import { ACTIVITY_CONFIG, SEVERITY_CONFIG, type AIDecisionRow, type Activity } from './types';
import {
  DEFAULT_STABILIZER_OPTIONS,
  STABILIZED_STATUS_LABEL,
  type StabilizedCandidate,
  type StabilizedStatus,
  type StabilizerOptions,
} from './stabilizedTypes';

const REAL_ACTIVITIES: Activity[] = ['STUDYING', 'PHONE', 'SLEEPING', 'ABSENT'];
const WEAK_STATUS = new Set(['LOW_CONFIDENCE', 'FAILED', 'SKIPPED']);

// activity → 활동별 최소 횟수 옵션 키
const MIN_COUNT_KEY: Partial<Record<Activity, keyof StabilizerOptions['thresholds']>> = {
  PHONE: 'phoneMinCount',
  ABSENT: 'absentMinCount',
  SLEEPING: 'sleepingMinCount',
  STUDYING: 'studyingMinCount',
};

// activity → severity (Python activity_labels.ACTIVITY_SEVERITY 와 동일)
const ACTIVITY_SEVERITY: Record<Activity, keyof typeof SEVERITY_CONFIG> = {
  STUDYING: 'INFO',
  PHONE: 'WARNING',
  SLEEPING: 'WATCH',
  ABSENT: 'WARNING',
  UNKNOWN: 'INFO',
};

interface Norm {
  seatId: string;
  activity: string;
  confidence: number;
  status: string;
  decidedMs: number;
  uuid: string;
}

function normalize(row: AIDecisionRow): Norm | null {
  if (!row || !row.activity) return null;
  const ms = Date.parse(row.decided_at);
  return {
    seatId: row.seat_id ?? '',
    activity: String(row.activity).toUpperCase(),
    confidence: typeof row.confidence === 'number' ? row.confidence : 0,
    status: String(row.status ?? '').toUpperCase(),
    decidedMs: Number.isNaN(ms) ? 0 : ms,
    uuid: row.decision_uuid || row.id || '',
  };
}

function severityFor(activity: Activity, status: StabilizedStatus): keyof typeof SEVERITY_CONFIG {
  if (status !== 'STABLE') return 'INFO';
  const sev = ACTIVITY_SEVERITY[activity];
  // 수면은 motion score 없음 → WATCH 이하로 제한
  if (activity === 'SLEEPING' && sev !== 'INFO' && sev !== 'WATCH') return 'WATCH';
  return sev;
}

/** 단일 좌석(혹은 한 묶음)의 AIDecisionRow[] → StabilizedCandidate. */
export function stabilizeAIDecisions(
  rows: AIDecisionRow[],
  options: StabilizerOptions = DEFAULT_STABILIZER_OPTIONS,
  seatId?: string
): StabilizedCandidate {
  const { window, thresholds, weights } = options;
  const norms = (rows ?? []).map(normalize).filter((n): n is Norm => n !== null);
  const seat = seatId ?? dominantSeat(norms);
  const total = norms.length;
  const generatedAt = safeNowIso();

  // 1) 입력 없음
  if (total === 0) {
    return build(seat, 'UNKNOWN', 0, 'INSUFFICIENT_DATA', generatedAt, [], total, 0,
      ['입력 판정이 없음'], {}, options);
  }

  // 2) 오래된 판정 제외(기준 = nowMs 또는 가장 최근 판정)
  const ref = options.nowMs ?? Math.max(...norms.map((n) => n.decidedMs));
  const cutoff = ref - window.maxAgeMinutes * 60_000;
  const fresh = norms.filter((n) => n.decidedMs >= cutoff);
  const agedOut = total - fresh.length;

  // 3) 최신순 + 윈도우 상한
  fresh.sort((a, b) => b.decidedMs - a.decidedMs);
  const win = fresh.slice(0, window.maxDecisions);

  // 4) 최소 개수 미만
  if (win.length < window.minDecisions) {
    return build(seat, 'UNKNOWN', 0, 'INSUFFICIENT_DATA', generatedAt, win, total, agedOut,
      [`유효 판정 ${win.length}개 < 최소 ${window.minDecisions}개`], {}, options);
  }

  // 5) 집계
  const counts: Record<string, number> = {};
  const confSum: Record<string, number> = {};
  const weighted: Record<string, number> = {};
  let allConf = 0;
  win.forEach((n, idx) => {
    let w = idx === 0 ? weights.latestWeight : weights.normalWeight;
    if (WEAK_STATUS.has(n.status)) w *= weights.lowConfidencePenalty;
    counts[n.activity] = (counts[n.activity] ?? 0) + 1;
    confSum[n.activity] = (confSum[n.activity] ?? 0) + n.confidence;
    weighted[n.activity] = (weighted[n.activity] ?? 0) + w;
    allConf += n.confidence;
  });
  const confByActivity: Record<string, number> = {};
  for (const a of Object.keys(counts)) confByActivity[a] = round(confSum[a] / counts[a]);
  const avgConfWindow = round(allConf / win.length);

  const latestActivity = win[0].activity;
  const [consecutiveActivity, consecutiveCount] = frontRun(win);

  // 6) 우세 후보(실제 activity 중 가중치 최대)
  const realScores = REAL_ACTIVITIES
    .filter((a) => (counts[a] ?? 0) > 0)
    .map((a) => [a, weighted[a] ?? 0] as [Activity, number]);
  const totalWeight = Object.values(weighted).reduce((s, v) => s + v, 0) || 1;

  const evidence = (conflict: boolean) => ({
    total_decisions: total,
    valid_decisions: win.length,
    ignored_decisions: total - win.length,
    aged_out: agedOut,
    activity_counts: { ...counts },
    activity_ratios: ratios(counts, win.length),
    average_confidence: avgConfWindow,
    latest_activity: latestActivity,
    consecutive_activity: { activity: consecutiveActivity, count: consecutiveCount },
    conflict_detected: conflict,
    source_decision_uuids: win.map((n) => n.uuid),
  });

  if (realScores.length === 0) {
    return build(seat, 'UNKNOWN', 0, 'LOW_CONFIDENCE', generatedAt, win, total, agedOut,
      ['실제 활동 신호 없음(모두 UNKNOWN)'], evidence(false), options, counts, confByActivity);
  }

  realScores.sort((a, b) => b[1] - a[1]);
  const [candidate, candWeight] = realScores[0];
  const candRatio = candWeight / totalWeight;
  const candCount = counts[candidate] ?? 0;
  const candConf = confByActivity[candidate] ?? 0;

  // 7) 충돌
  if (realScores.length >= 2) {
    const [second, secondW] = realScores[1];
    if ((candWeight - secondW) / totalWeight < thresholds.conflictMargin) {
      return build(seat, 'UNKNOWN', round(candConf), 'CONFLICTED', generatedAt, win, total, agedOut,
        [`${candidate}과 ${second} 신호가 충돌하여 판정 보류 ` +
          `(${candidate} ${counts[candidate] ?? 0}회 vs ${second} ${counts[second] ?? 0}회)`],
        evidence(true), options, counts, confByActivity);
    }
  }

  const reasons: string[] = [
    `최근 ${win.length}개 판정 중 ${candidate} ${candCount}회`,
    `${candidate} 평균 신뢰도 ${round2(candConf)}`,
  ];
  if (consecutiveActivity === candidate && consecutiveCount >= 2) {
    reasons.push(`최근 판정 ${consecutiveCount}회 연속 ${candidate}`);
  }

  // 8) 최소 횟수 미달
  const minKey = MIN_COUNT_KEY[candidate];
  const minCount = minKey ? thresholds[minKey] : 2;
  if (candCount < minCount) {
    return build(seat, 'UNKNOWN', round(candConf), 'UNSTABLE', generatedAt, win, total, agedOut,
      [...reasons, `${candidate} ${candCount}회 < 최소 ${minCount}회 → 보수적 보류`],
      evidence(false), options, counts, confByActivity);
  }

  // 9) 평균 신뢰도 부족
  if (candConf < thresholds.minAverageConfidence) {
    return build(seat, 'UNKNOWN', round(candConf), 'LOW_CONFIDENCE', generatedAt, win, total, agedOut,
      [...reasons, `평균 신뢰도 ${round2(candConf)} < ${thresholds.minAverageConfidence}`],
      evidence(false), options, counts, confByActivity);
  }

  // 10) 우세 비율 부족
  if (candRatio < thresholds.stableRatio) {
    return build(seat, 'UNKNOWN', round(candConf), 'UNSTABLE', generatedAt, win, total, agedOut,
      [...reasons, `우세 비율 ${round2(candRatio)} < ${thresholds.stableRatio} → 신호 섞임`],
      evidence(false), options, counts, confByActivity);
  }

  // 11) STABLE
  reasons.push(`우세 비율 ${round2(candRatio)} ≥ ${thresholds.stableRatio} → 안정`);
  return build(seat, candidate, round(candConf), 'STABLE', generatedAt, win, total, agedOut,
    reasons, evidence(false), options, counts, confByActivity);
}

/** 좌석별로 묶어 각각 안정화. rows 는 여러 좌석이 섞여 있어도 된다. */
export function stabilizeAIDecisionsBySeat(
  rows: AIDecisionRow[],
  seatIds: string[],
  options: StabilizerOptions = DEFAULT_STABILIZER_OPTIONS
): Record<string, StabilizedCandidate> {
  const bySeat = new Map<string, AIDecisionRow[]>();
  for (const row of rows ?? []) {
    const arr = bySeat.get(row.seat_id) ?? [];
    arr.push(row);
    bySeat.set(row.seat_id, arr);
  }
  const result: Record<string, StabilizedCandidate> = {};
  for (const seat of seatIds) {
    result[seat] = stabilizeAIDecisions(bySeat.get(seat) ?? [], options, seat);
  }
  return result;
}

// ── 표시 헬퍼 ─────────────────────────────────────────────────────────────

/** 후보 라벨. STABLE 이면 활동명, 그 외엔 status 라벨(절대 "확정" 아님). */
export function getCandidateLabel(candidate: StabilizedCandidate): string {
  if (candidate.status === 'STABLE') return ACTIVITY_CONFIG[candidate.activity].label;
  return STABILIZED_STATUS_LABEL[candidate.status];
}

/** 후보 뱃지 색상. STABLE 이면 활동 색, 그 외엔 회색 톤. */
export function getCandidateBadgeClass(candidate: StabilizedCandidate): string {
  if (candidate.status === 'STABLE') return ACTIVITY_CONFIG[candidate.activity].badgeClass;
  if (candidate.status === 'CONFLICTED') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────

function build(
  seat: string, activity: Activity, confidence: number, status: StabilizedStatus,
  generatedAt: string, win: Norm[], total: number, agedOut: number,
  reasons: string[], evidence: Record<string, unknown>, options: StabilizerOptions,
  counts: Record<string, number> = {}, confByActivity: Record<string, number> = {}
): StabilizedCandidate {
  const decidedTo = win.length ? new Date(win[0].decidedMs).toISOString() : null;
  const decidedFrom = win.length ? new Date(win[win.length - 1].decidedMs).toISOString() : null;
  return {
    candidate_uuid: `${seat}:${decidedTo ?? 'na'}:${status}:${activity}`,
    seat_id: seat,
    activity,
    confidence,
    status,
    severity: severityFor(activity, status),
    window_size: options.window.maxDecisions,
    decision_count: win.length,
    decided_from: decidedFrom,
    decided_to: decidedTo,
    generated_at: generatedAt,
    activity_counts: { ...counts },
    confidence_by_activity: { ...confByActivity },
    source_decision_uuids: win.map((n) => n.uuid),
    reasons,
    evidence,
    metadata: { engine: 'frontend-stabilizer-v0.1', total_decisions: total, aged_out: agedOut },
  };
}

function dominantSeat(norms: Norm[]): string {
  const counts: Record<string, number> = {};
  for (const n of norms) if (n.seatId) counts[n.seatId] = (counts[n.seatId] ?? 0) + 1;
  let best = '';
  let bestN = -1;
  for (const [s, c] of Object.entries(counts)) if (c > bestN) { best = s; bestN = c; }
  return best;
}

function frontRun(win: Norm[]): [string | null, number] {
  if (!win.length) return [null, 0];
  const a = win[0].activity;
  let c = 0;
  for (const n of win) { if (n.activity === a) c += 1; else break; }
  return [a, c];
}

function ratios(counts: Record<string, number>, total: number): Record<string, number> {
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [a, c] of Object.entries(counts)) out[a] = round2(c / total);
  return out;
}

function round(v: number): number { return Math.round(v * 10000) / 10000; }
function round2(v: number): number { return Math.round(v * 100) / 100; }

// new Date() 는 vitest 환경에서도 안전. 결정성에 영향 주지 않는 표시용 타임스탬프.
function safeNowIso(): string {
  try { return new Date().toISOString(); } catch { return ''; }
}
