# Solomon Admin Dashboard Stabilized Candidate Read-only v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: 관리자 대시보드에 **단발 AI 판정**과 최근 3~5개를 묶은 **안정화된 추정 후보**(`StabilizedCandidate`)를 좌석별로 **구분** 표시.
> 프론트 **read-derived 계산**(DB 저장/write 없음), SELECT 전용 + 관리자 RLS, service role 미사용.
> **STABLE 도 "확정" 아님** — 학생 상태/출결/벌점/알림 자동 변경 없음. **type-check 클린, 신규 19 테스트 포함 전체 80 PASS.**

---

## 1. 전체 프로젝트 트리

```
codespaces-react/src/features/admin-ai-decisions/
├── types.ts                         # (기존) AIDecisionRow / ACTIVITY_CONFIG / SEAT_IDS ...
├── stabilizedTypes.ts               # ★신규 StabilizedCandidate / StabilizerOptions / 라벨
├── stabilizer.ts                    # ★신규 프론트 안정화 계산(decision_stabilizer.py TS 포팅)
├── api.ts                           # ✎수정 getRecentAIDecisionsForStabilization 추가(SELECT)
├── hooks.ts                         # ✎수정 useStabilizedCandidatesQuery + STABILIZED_KEY + realtime
├── components/
│   ├── AIDecisionSeatCard.tsx       # ✎수정 단발 AI + 안정화 후보 2층 표시
│   ├── AIDecisionSeatGrid.tsx       # ✎수정 candidatesBySeat 전달
│   ├── AIDecisionSection.tsx        # ✎수정 안정화 쿼리/패널/상세 통합
│   ├── AIDecisionLogTable.tsx       # (기존)
│   ├── AIDecisionDetailDrawer.tsx   # (기존)
│   ├── StabilizedCandidateBadge.tsx # ★신규 "안정화된 추정" 뱃지
│   ├── StabilizedCandidatePanel.tsx # ★신규 좌석별 안정화 후보 패널
│   └── StabilizedCandidateDetail.tsx# ★신규 안정화 후보 상세 Drawer
└── __tests__/
    ├── aiDecisionsApi.test.ts          # ✎수정 export 집합에 신규 함수 반영
    ├── AIDecisionComponents.test.tsx   # (기존)
    ├── stabilizer.test.ts              # ★신규 안정화 로직 테스트
    └── stabilizedComponents.test.tsx   # ★신규 안정화 컴포넌트 테스트
```

★ = 신규, ✎ = 수정. (DB migration/파이썬 무관 — 순수 프론트엔드 read-derived. ai_rule_decisions 읽기만.)

---

## 2. 신규 파일 전체 코드

### 2-1. `stabilizedTypes.ts`

```typescript
// =========================================================================
// Admin AI Dashboard — Stabilized Candidate(안정화 후보) 타입
// =========================================================================
// 최근 3~5개 ai_rule_decisions 를 프론트에서 묶어 계산한 "안정화된 AI 추정 후보".
// ⚠️ StabilizedCandidate 는 **실제 학생 상태가 아니다.** 안정화된 AI 추정 후보일 뿐이다.
//    DB 에 저장하지 않는다(read-derived). 학생 상태/출결/벌점/알림 변경 없음.
// =========================================================================

import type { Activity, Severity } from './types';

export type StabilizedStatus =
  | 'STABLE' | 'UNSTABLE' | 'INSUFFICIENT_DATA' | 'LOW_CONFIDENCE' | 'CONFLICTED';

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

export interface StabilizerOptions {
  window: { maxDecisions: number; minDecisions: number; maxAgeMinutes: number };
  thresholds: {
    stableRatio: number; minAverageConfidence: number;
    phoneMinCount: number; absentMinCount: number;
    sleepingMinCount: number; studyingMinCount: number; conflictMargin: number;
  };
  weights: { latestWeight: number; normalWeight: number; lowConfidencePenalty: number };
  nowMs?: number;   // 기준 시각(ms). 미지정 시 가장 최근 decided_at 기준.
}

export const DEFAULT_STABILIZER_OPTIONS: StabilizerOptions = {
  window: { maxDecisions: 5, minDecisions: 3, maxAgeMinutes: 15 },
  thresholds: {
    stableRatio: 0.6, minAverageConfidence: 0.55,
    phoneMinCount: 2, absentMinCount: 2, sleepingMinCount: 2, studyingMinCount: 2,
    conflictMargin: 0.15,
  },
  weights: { latestWeight: 1.2, normalWeight: 1.0, lowConfidencePenalty: 0.5 },
};

/** 후보 status 한글 라벨(절대 "확정" 이라 하지 않는다 — "안정"/"보류"). */
export const STABILIZED_STATUS_LABEL: Record<StabilizedStatus, string> = {
  STABLE: '안정', UNSTABLE: '신호 섞임', INSUFFICIENT_DATA: '데이터 부족',
  LOW_CONFIDENCE: '낮은 신뢰', CONFLICTED: '판정 보류',
};
```

### 2-2. `stabilizer.ts` (decision_stabilizer.py TS 포팅)

```typescript
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
  DEFAULT_STABILIZER_OPTIONS, STABILIZED_STATUS_LABEL,
  type StabilizedCandidate, type StabilizedStatus, type StabilizerOptions,
} from './stabilizedTypes';

const REAL_ACTIVITIES: Activity[] = ['STUDYING', 'PHONE', 'SLEEPING', 'ABSENT'];
const WEAK_STATUS = new Set(['LOW_CONFIDENCE', 'FAILED', 'SKIPPED']);

const MIN_COUNT_KEY: Partial<Record<Activity, keyof StabilizerOptions['thresholds']>> = {
  PHONE: 'phoneMinCount', ABSENT: 'absentMinCount',
  SLEEPING: 'sleepingMinCount', STUDYING: 'studyingMinCount',
};

const ACTIVITY_SEVERITY: Record<Activity, keyof typeof SEVERITY_CONFIG> = {
  STUDYING: 'INFO', PHONE: 'WARNING', SLEEPING: 'WATCH', ABSENT: 'WARNING', UNKNOWN: 'INFO',
};

interface Norm { seatId: string; activity: string; confidence: number; status: string; decidedMs: number; uuid: string; }

function normalize(row: AIDecisionRow): Norm | null {
  if (!row || !row.activity) return null;
  const ms = Date.parse(row.decided_at);
  return {
    seatId: row.seat_id ?? '', activity: String(row.activity).toUpperCase(),
    confidence: typeof row.confidence === 'number' ? row.confidence : 0,
    status: String(row.status ?? '').toUpperCase(),
    decidedMs: Number.isNaN(ms) ? 0 : ms, uuid: row.decision_uuid || row.id || '',
  };
}

function severityFor(activity: Activity, status: StabilizedStatus): keyof typeof SEVERITY_CONFIG {
  if (status !== 'STABLE') return 'INFO';
  const sev = ACTIVITY_SEVERITY[activity];
  if (activity === 'SLEEPING' && sev !== 'INFO' && sev !== 'WATCH') return 'WATCH';
  return sev;
}

export function stabilizeAIDecisions(
  rows: AIDecisionRow[], options: StabilizerOptions = DEFAULT_STABILIZER_OPTIONS, seatId?: string
): StabilizedCandidate {
  const { window, thresholds, weights } = options;
  const norms = (rows ?? []).map(normalize).filter((n): n is Norm => n !== null);
  const seat = seatId ?? dominantSeat(norms);
  const total = norms.length;
  const generatedAt = safeNowIso();

  if (total === 0) {
    return build(seat, 'UNKNOWN', 0, 'INSUFFICIENT_DATA', generatedAt, [], total, 0,
      ['입력 판정이 없음'], {}, options);
  }

  const ref = options.nowMs ?? Math.max(...norms.map((n) => n.decidedMs));
  const cutoff = ref - window.maxAgeMinutes * 60_000;
  const fresh = norms.filter((n) => n.decidedMs >= cutoff);
  const agedOut = total - fresh.length;

  fresh.sort((a, b) => b.decidedMs - a.decidedMs);
  const win = fresh.slice(0, window.maxDecisions);

  if (win.length < window.minDecisions) {
    return build(seat, 'UNKNOWN', 0, 'INSUFFICIENT_DATA', generatedAt, win, total, agedOut,
      [`유효 판정 ${win.length}개 < 최소 ${window.minDecisions}개`], {}, options);
  }

  const counts: Record<string, number> = {}; const confSum: Record<string, number> = {};
  const weighted: Record<string, number> = {}; let allConf = 0;
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

  const realScores = REAL_ACTIVITIES.filter((a) => (counts[a] ?? 0) > 0)
    .map((a) => [a, weighted[a] ?? 0] as [Activity, number]);
  const totalWeight = Object.values(weighted).reduce((s, v) => s + v, 0) || 1;

  const evidence = (conflict: boolean) => ({
    total_decisions: total, valid_decisions: win.length, ignored_decisions: total - win.length,
    aged_out: agedOut, activity_counts: { ...counts }, activity_ratios: ratios(counts, win.length),
    average_confidence: avgConfWindow, latest_activity: latestActivity,
    consecutive_activity: { activity: consecutiveActivity, count: consecutiveCount },
    conflict_detected: conflict, source_decision_uuids: win.map((n) => n.uuid),
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
  if (consecutiveActivity === candidate && consecutiveCount >= 2)
    reasons.push(`최근 판정 ${consecutiveCount}회 연속 ${candidate}`);

  const minKey = MIN_COUNT_KEY[candidate];
  const minCount = minKey ? thresholds[minKey] : 2;
  if (candCount < minCount)
    return build(seat, 'UNKNOWN', round(candConf), 'UNSTABLE', generatedAt, win, total, agedOut,
      [...reasons, `${candidate} ${candCount}회 < 최소 ${minCount}회 → 보수적 보류`],
      evidence(false), options, counts, confByActivity);

  if (candConf < thresholds.minAverageConfidence)
    return build(seat, 'UNKNOWN', round(candConf), 'LOW_CONFIDENCE', generatedAt, win, total, agedOut,
      [...reasons, `평균 신뢰도 ${round2(candConf)} < ${thresholds.minAverageConfidence}`],
      evidence(false), options, counts, confByActivity);

  if (candRatio < thresholds.stableRatio)
    return build(seat, 'UNKNOWN', round(candConf), 'UNSTABLE', generatedAt, win, total, agedOut,
      [...reasons, `우세 비율 ${round2(candRatio)} < ${thresholds.stableRatio} → 신호 섞임`],
      evidence(false), options, counts, confByActivity);

  reasons.push(`우세 비율 ${round2(candRatio)} ≥ ${thresholds.stableRatio} → 안정`);
  return build(seat, candidate, round(candConf), 'STABLE', generatedAt, win, total, agedOut,
    reasons, evidence(false), options, counts, confByActivity);
}

export function stabilizeAIDecisionsBySeat(
  rows: AIDecisionRow[], seatIds: string[], options: StabilizerOptions = DEFAULT_STABILIZER_OPTIONS
): Record<string, StabilizedCandidate> {
  const bySeat = new Map<string, AIDecisionRow[]>();
  for (const row of rows ?? []) {
    const arr = bySeat.get(row.seat_id) ?? []; arr.push(row); bySeat.set(row.seat_id, arr);
  }
  const result: Record<string, StabilizedCandidate> = {};
  for (const seat of seatIds) result[seat] = stabilizeAIDecisions(bySeat.get(seat) ?? [], options, seat);
  return result;
}

export function getCandidateLabel(candidate: StabilizedCandidate): string {
  if (candidate.status === 'STABLE') return ACTIVITY_CONFIG[candidate.activity].label;
  return STABILIZED_STATUS_LABEL[candidate.status];
}

export function getCandidateBadgeClass(candidate: StabilizedCandidate): string {
  if (candidate.status === 'STABLE') return ACTIVITY_CONFIG[candidate.activity].badgeClass;
  if (candidate.status === 'CONFLICTED') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
}

// ── 내부 헬퍼: build / dominantSeat / frontRun / ratios / round / safeNowIso ──
// (build 는 candidate_uuid="seat:decided_to:status:activity"(결정적), decided_from/to,
//  severityFor 적용; 전체 코드는 src/features/admin-ai-decisions/stabilizer.ts 참고)
```

> 내부 헬퍼(build/dominantSeat/frontRun/ratios/round/safeNowIso)는 실제 파일에 포함. `candidate_uuid` 는
> `seat:decided_to:status:activity` 로 **결정적** 생성(랜덤 없음 → 테스트 안정).

### 2-3. `components/StabilizedCandidateBadge.tsx`

```tsx
import { cn } from '@/lib/utils';
import { confidencePercent } from '../types';
import { STABILIZED_STATUS_LABEL, type StabilizedCandidate } from '../stabilizedTypes';
import { getCandidateLabel, getCandidateBadgeClass } from '../stabilizer';

interface Props { candidate: StabilizedCandidate; onClick?: (c: StabilizedCandidate) => void; className?: string; }

/** "안정화된 추정" 뱃지(읽기 전용). 절대 "확정" 이라 표현하지 않는다. */
export function StabilizedCandidateBadge({ candidate, onClick, className }: Props) {
  const label = getCandidateLabel(candidate);
  const badgeClass = getCandidateBadgeClass(candidate);
  const isStable = candidate.status === 'STABLE';
  const pct = confidencePercent(candidate.confidence);
  const topCount = isStable ? (candidate.activity_counts[candidate.activity] ?? 0) : 0;
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper {...(onClick ? { type: 'button', onClick: () => onClick(candidate) } : {})}
      className={cn('flex w-full flex-col items-start gap-0.5 rounded-md border border-gray-100 bg-white/60 px-2 py-1 text-left',
        onClick && 'hover:bg-white', className)}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">안정화된 추정</span>
      <span className="flex flex-wrap items-center gap-1">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', badgeClass)}>
          {label}{isStable && ` ${pct}%`}
        </span>
        {isStable && (
          <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500">
            {STABILIZED_STATUS_LABEL[candidate.status]}
          </span>
        )}
      </span>
      {isStable ? (
        <span className="text-[10px] text-gray-400">최근 {candidate.decision_count}개 중 {topCount}회</span>
      ) : (
        <span className="text-[10px] text-gray-400">관리자 확인 필요</span>
      )}
    </Wrapper>
  );
}
```

### 2-4. `components/StabilizedCandidatePanel.tsx` (요지)
좌석별(Seat1~8) 안정화 후보 테이블: 좌석/안정화 후보(뱃지)/상태/신뢰/판정수/이유 첫 줄/상세 버튼.
데이터 없는 좌석은 "안정화 데이터 없음". **수정/삭제/상태반영 버튼 없음**, 상세 버튼만.

### 2-5. `components/StabilizedCandidateDetail.tsx` (요지)
우측 Drawer. 상단 "안정화된 추정" + 후보 라벨. 본문 상단에 **"안정화된 AI 추정 후보입니다. 학생 상태,
출결, 벌점은 자동 변경되지 않습니다."** 고정. status/confidence/activity/severity/decision_count/
decided_from·to + reasons 목록 + `activity_counts`/`confidence_by_activity`/`evidence`/`source_decision_uuids`/`metadata`
를 **읽기 전용 JSON** 으로 표시.

### 2-6. 테스트 — `stabilizer.test.ts`(13) / `stabilizedComponents.test.tsx`(6) (요지)
§9 참고.

---

## 3. 수정된 파일 (변경 부분)

### 3-1. `api.ts` — 안정화용 SELECT 함수 추가

```typescript
/** 안정화 계산용 최근 판정 조회(좌석별 최근 N개 확보). 그룹핑/계산은 프론트에서. */
export async function getRecentAIDecisionsForStabilization(
  seatIds?: string[], limitPerSeat = 5
): Promise<AIDecisionRow[]> {
  const seatCount = seatIds?.length ?? 8;
  const scan = Math.min(LATEST_SCAN_LIMIT, Math.max(40, seatCount * limitPerSeat * 4));
  const { data, error } = await fromDecisions()
    .select(COLUMNS).order('decided_at', { ascending: false }).limit(scan);
  if (error) throw error;
  const rows = (data ?? []) as AIDecisionRow[];
  if (!seatIds) return rows;
  return rows.filter((r) => seatIds.includes(r.seat_id));
}
```
> 여전히 SELECT 전용. insert/update/delete 없음.

### 3-2. `hooks.ts` — 안정화 쿼리 + Realtime 키 추가

```typescript
export const STABILIZED_KEY = ['ai-decisions-stabilized'] as const;

/** 좌석별 안정화 후보(read-derived). 최근 판정 조회 후 프론트에서 계산. DB write 없음. */
export function useStabilizedCandidatesQuery(seatIds: string[] = SEAT_IDS) {
  return useQuery({
    queryKey: [...STABILIZED_KEY, seatIds],
    queryFn: async () => {
      const rows = await getRecentAIDecisionsForStabilization(seatIds, 5);
      return stabilizeAIDecisionsBySeat(rows, seatIds);
    },
    staleTime: 1000 * 30,
  });
}

export function useAIDecisionsRealtime() {
  useRealtimeTableSync('ai_rule_decisions', [SEAT_DECISIONS_KEY, RECENT_DECISIONS_KEY, STABILIZED_KEY]);
}
```

### 3-3. `AIDecisionSeatCard.tsx` — 2층(단발 AI + 안정화) 표시
- props 에 `candidate?: StabilizedCandidate | null`, `onOpenCandidate?` 추가.
- 기존 activity 뱃지 위에 **"단발 AI"** 라벨, 카드 하단에 구분선 + `<StabilizedCandidateBadge>` (INSUFFICIENT_DATA 면 생략).

### 3-4. `AIDecisionSeatGrid.tsx` — `candidatesBySeat` / `onOpenCandidate` 를 카드에 전달.

### 3-5. `AIDecisionSection.tsx`
- `useStabilizedCandidatesQuery(SEAT_IDS)` 추가 → 카드(candidatesBySeat)·**StabilizedCandidatePanel**·**StabilizedCandidateDetail** 연결.
- 배너에 "단발 AI 판정과 '안정화된 추정'은 모두 보조 지표이며, STABLE 도 확정이 아닙니다." 보강.
- 새로고침이 `STABILIZED_KEY` 도 invalidate.

### 3-6. `__tests__/aiDecisionsApi.test.ts` — export 집합에 `getRecentAIDecisionsForStabilization` 반영.

---

## 4. Admin Dashboard Stabilized Candidate 구조도

```
   ai_rule_decisions (관리자 RLS SELECT, anon/auth client — service role 아님)
            │  getRecentAIDecisionsForStabilization(SEAT_IDS, 5)   ← SELECT only
            ▼
   useStabilizedCandidatesQuery (react-query)
            │  stabilizeAIDecisionsBySeat(rows, SEAT_IDS)  ← 프론트 계산(DB write 없음)
            ▼
   Record<seatId, StabilizedCandidate>
            │
            ├─► AIDecisionSeatGrid → AIDecisionSeatCard (2층)
            │        ┌ 단발 AI: 최근 RuleDecision 1개 (기존)
            │        └ 안정화된 추정: StabilizedCandidateBadge
            ├─► StabilizedCandidatePanel (좌석별 후보 테이블)
            └─► StabilizedCandidateDetail (상세 Drawer: reasons/evidence/...)

   Realtime: ai_rule_decisions INSERT → STABILIZED_KEY invalidate → 재계산
   ── 어떤 경로도 DB write / 학생 상태 변경 / 알림 으로 가지 않음 ──
```

**핵심 설계 원칙**
- **read-derived**: 안정화는 프론트 계산, **DB 저장 안 함**(MVP 검증). SELECT 전용 + 관리자 RLS.
- **단발 vs 안정화 구분**: 카드 2층 + "단발 AI"/"안정화된 추정" 라벨 → 혼동 방지.
- **확정 금지**: STABLE 도 "안정"(확정 아님). "관리자 확인 필요" 명시.
- **파이썬과 방향 일치**: `stabilizer.ts` ≈ `decision_stabilizer.py`(동일 임계/가중/우선순위).

---

## 5. 단발 AI 판정과 안정화 후보의 차이

| | 단발 AI 판정(RuleDecision) | 안정화된 추정(StabilizedCandidate) |
|--|---------------------------|-----------------------------------|
| 근거 | **한 Burst** 스냅샷 1개 | 최근 **3~5개** 판정 묶음 |
| 변동성 | 깜빡임/오탐 잦음 | 다수결+가중으로 완화 |
| 계산 위치 | 서버(RuleEngine) → 저장 | **프론트 read-derived**(미저장) |
| 표시 | 카드 1층 "단발 AI" | 카드 2층 "안정화된 추정" + 패널 |
| 상태값 | SUCCESS/SKIPPED/FAILED/LOW_CONFIDENCE | STABLE/UNSTABLE/CONFLICTED/LOW_CONFIDENCE/INSUFFICIENT_DATA |
| 공통 | **둘 다 보조 지표. 확정 아님. 자동 상태 변경 없음.** | |

---

## 6. StabilizedCandidate 타입 설명

| 필드 | 의미 |
|------|------|
| `candidate_uuid` | 결정적 식별자(`seat:decided_to:status:activity`) |
| `seat_id` | 좌석 |
| `activity` | STABLE 일 때만 실제 활동, 그 외 UNKNOWN |
| `confidence` | 후보 activity 평균 신뢰도(0~1) |
| `status` | STABLE/UNSTABLE/INSUFFICIENT_DATA/LOW_CONFIDENCE/CONFLICTED |
| `severity` | INFO/WATCH/WARNING/CRITICAL (STABLE 아니면 INFO, SLEEPING WATCH 이하) |
| `window_size` / `decision_count` | 설정 윈도우 / 실제 사용 판정 수 |
| `decided_from` / `decided_to` | 윈도우 최이른/최늦은 decided_at(ISO) |
| `activity_counts` / `confidence_by_activity` | 활동별 횟수 / 평균 신뢰도 |
| `source_decision_uuids` | 사용한 RuleDecision uuid |
| `reasons` / `evidence` / `metadata` | 사람용 이유 / 집계 근거 / trace |

> **후보 ≠ 상태**: 어떤 status 든 "AI 추정 후보". 실제 학생 상태로 만드는 것은 사람·정책(다음 단계 이후).

---

## 7. 안정화 계산 규칙 설명

**우선순위**: INSUFFICIENT_DATA → (실제 신호 없음 LOW_CONFIDENCE) → CONFLICTED → 최소횟수 UNSTABLE → 평균신뢰 LOW_CONFIDENCE → 우세비율 UNSTABLE → STABLE.

- **가중치**: 최신 `latestWeight`(1.2), 그 외 `normalWeight`(1.0), 약한 status(LOW_CONFIDENCE/FAILED/SKIPPED) `× lowConfidencePenalty`(0.5).
- **PHONE**: PHONE ≥ 2 + 평균신뢰 ≥ 0.55 + 우세비율 ≥ 0.6 → STABLE PHONE(WARNING).
- **STUDYING**: STUDYING 다수 + PHONE/ABSENT 약함 → STABLE STUDYING(INFO).
- **ABSENT**: 보수적 — UNKNOWN/LOW_CONFIDENCE 섞이면 우세비율 미달로 UNSTABLE.
- **SLEEPING**: SLEEPING 다수면 STABLE 가능, severity **WATCH 이하** 강제(motion score 부재).
- **충돌**: 상위 두 실제 activity (가중치차/총가중치) < `conflictMargin`(0.15) → CONFLICTED UNKNOWN.
- 모든 임계/가중은 `StabilizerOptions`(DEFAULT_STABILIZER_OPTIONS) — 파이썬 `stabilizer.yaml` 과 동일 값.

---

## 8. 대시보드 표시 예시

```
관리자 대시보드 ▸ AI 판정 현황                                   [새로고침]
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠️ AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지     │
│    않습니다. 단발 AI 판정과 "안정화된 추정"은 모두 보조 지표이며,        │
│    STABLE 도 확정이 아닙니다.                                           │
└──────────────────────────────────────────────────────────────────────┘
┌─ Seat1 ─────────┐ ┌─ Seat2 ─────────┐ ┌─ Seat3 ─────────┐
│ 단발 AI         │ │ 단발 AI         │ │ 단발 AI         │
│ 🔴 휴대폰 추정  │ │ 🟢 공부 추정    │ │ ⚪ 판정 불가    │
│ 72% 경고        │ │ 65% 정보        │ │ 0% 낮은 신뢰    │
│ AI 추정·자동변경│ │ AI 추정·자동변경│ │                 │
│ ──────────────  │ │ ──────────────  │ │ ──────────────  │
│ 안정화된 추정   │ │ 안정화된 추정   │ │ 안정화된 추정   │
│ 휴대폰 추정 81% │ │ 판정 보류       │ │ 데이터 부족     │
│ · 안정 · 5중 3회│ │ · 관리자 확인   │ │ (표시 생략)     │
└─────────────────┘ └─────────────────┘ └─────────────────┘   ... Seat4~8

안정화된 추정 후보 (최근 3~5개 기반 · 관리자 확인 필요)
┌ 좌석 ─ 안정화 후보 ─ 상태 ─ 신뢰 ─ 판정수 ─ 이유 ──────────── ┐
│ Seat1 휴대폰 추정  안정    81%   5    최근 5개 중 3회   [상세] │
│ Seat2 판정 보류    판정보류 -     4    PHONE과 STUDYING…  [상세] │
└──────────────────────────────────────────────────────────────┘

[상세] → Drawer: "안정화된 AI 추정 후보입니다. 학생 상태, 출결, 벌점은
        자동 변경되지 않습니다." + reasons + activity_counts/evidence/source_decision_uuids(JSON)
```

---

## 9. 테스트 결과

```bash
npx vitest run src/features/admin-ai-decisions
#  Test Files  4 passed (4)
#       Tests  34 passed (34)   ← 기존 15 + 신규 19
```
- `stabilizer.test.ts`(13): 0개/2개→INSUFFICIENT, PHONE 3/5→STABLE, STUDYING 4/5→STABLE,
  2:2→CONFLICTED, 저신뢰→LOW_CONFIDENCE, 오래된 제외(aged_out), 최신/패널티 가중, SLEEPING WATCH,
  ABSENT 보수, counts/evidence/source 기록, by-seat, 소스 부수효과 없음.
- `stabilizedComponents.test.tsx`(6): Badge(안정/확정 없음), CONFLICTED(판정 보류·관리자 확인),
  Panel(데이터 없음 안내), Detail(자동 변경 아님·evidence·source / null 빈 렌더), 컴포넌트 소스 금지요소 없음.

**전체 회귀**
```bash
npx tsc --noEmit      # 에러 없음
npx vitest run        # Test Files 11 passed / Tests 80 passed  ← 기존 61 + 신규 19
```

---

## 10. 남은 기술부채

1. **DB 미저장**: read-derived 라 매 조회마다 재계산. 추세/이력 분석은 불가(의도된 MVP 선택).
2. **migration 미적용**: ai_rule_decisions(테이블/admin-read RLS)가 원격 미적용이면 화면이 비거나 권한 오류.
3. **좌석↔학생 매핑 없음**: `seat_id`("Seat1") ↔ 앱 `seat_number`/학생 이름 연결 미구현.
4. **기준 시각**: `nowMs` 미주입 시 "가장 최근 판정" 기준 max_age → 실제 현재시각과 다를 수 있음.
5. **파이썬/TS 동기화**: 두 stabilizer 로직을 수동으로 맞춤. 임계/가중 변경 시 양쪽 동시 갱신 필요(공유 소스 없음).
6. **시각 비실시간**: `Date.now()` 렌더 1회 계산("n분 전" 자동 tick 없음).
7. **대량 데이터**: 좌석별 최신 N개를 200건 스캔 후 클라 그룹핑. 데이터 많아지면 RPC/뷰 권장.

---

## 11. v0.2 개선계획

1. **migration 적용 + 타입 생성**: ai_rule_decisions 원격 반영, `database.types.ts` 갱신 → `as any` 제거.
2. **좌석↔학생 매핑**: 안정화 후보를 학생 이름/관제 좌석과 연결해 한 화면에서 교차 확인.
3. **파이썬/TS 로직 단일화**: 임계/가중을 공유 config(JSON)로 빼 두 구현이 같은 값을 읽게.
4. **실시간 시계**: `useCurrentTime` 으로 "n분 전"/오래됨 자동 갱신.
5. **선택적 저장(후순위)**: 검증이 끝나면 StabilizedDecision 을 별도 테이블에 남겨 추세 분석(여전히 상태 변경 X).
6. **Seat1 실제 카메라 E2E**: 실제 RTSP→파이프라인→ai_rule_decisions→대시보드 안정화 표시까지 한 좌석 검증.
7. **관리자 검수 흐름(신중)**: 관리자가 확인한 안정화 후보만 별도 액션으로 다루는 설계 — 자동 변경/알림/벌점/출결은 분리 유지.

> v0.1 범위 재확인: **관리자에게 안정화 후보를 보여주는 것까지.**
> 학생 상태 변경 / 출결 / 벌점 / 알림 / 보호자 연락 / 관리자 승인·상태반영 버튼 / DB write / 영상·이미지 저장 / 학생 앱 공개는 절대 미구현.
