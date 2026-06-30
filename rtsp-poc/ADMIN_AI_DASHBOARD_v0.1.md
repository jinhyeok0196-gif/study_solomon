# Solomon Admin AI Dashboard Read-only v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: Supabase `ai_rule_decisions` 의 RuleDecision 을 **관리자 대시보드에서 읽기 전용**으로 표시.
> **보기만** 한다 — 학생 상태 자동 변경 / 출결 / 벌점 / 알림 / 보호자 연락 / 영상·이미지 표시·저장은 **절대 안 함.**
> SELECT 전용 API(+admin-only RLS), 좌석 카드·로그·상세 Drawer, Realtime+수동 새로고침.
> **type-check 클린, 신규 15 테스트 포함 전체 61 테스트 PASS(회귀 없음).**

---

## 1. 전체 프로젝트 트리

```
codespaces-react/
├── supabase/migrations/
│   ├── 20260708000000_ai_rule_decisions.sql            # (기존) 테이블 + RLS 기본 잠금
│   └── 20260709000000_ai_rule_decisions_admin_read.sql # ★신규 관리자 read-only RLS + Realtime
│
├── src/
│   ├── features/admin-ai-decisions/                    # ★신규 feature (kebab 컨벤션)
│   │   ├── types.ts                # Activity/Status/Severity, AIDecisionRow, 색상/라벨 config
│   │   ├── api.ts                  # SELECT 전용 조회 함수 3종
│   │   ├── hooks.ts                # react-query 훅 + Realtime
│   │   ├── components/
│   │   │   ├── AIDecisionSeatCard.tsx     # 좌석별 최신 판정 카드
│   │   │   ├── AIDecisionSeatGrid.tsx     # Seat1~8 그리드
│   │   │   ├── AIDecisionLogTable.tsx     # 최근 판정 로그 + 필터
│   │   │   ├── AIDecisionDetailDrawer.tsx # 상세 보기(읽기 전용 JSON)
│   │   │   └── AIDecisionSection.tsx      # 배너+그리드+로그+drawer 통합
│   │   └── __tests__/
│   │       ├── aiDecisionsApi.test.ts         # select 전용/mutation 없음 검증
│   │       └── AIDecisionComponents.test.tsx  # 컴포넌트 렌더/안내문구/부수효과 없음
│   │
│   └── pages/admin/DashboardPage.tsx   # ✎수정 "AI 판정 현황" 섹션 추가
│
└── rtsp-poc/README.md                  # ✎수정 Admin AI Dashboard v0.1 절 추가
```

★ = 신규, ✎ = 수정. (rtsp-poc 파이썬 코드는 무수정 — 이 단계는 프론트엔드 + RLS migration.)

---

## 2. 신규 파일 전체 코드

### 2-1. `src/features/admin-ai-decisions/types.ts`

```typescript
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
```

### 2-2. `src/features/admin-ai-decisions/api.ts`

```typescript
// =========================================================================
// Admin AI Dashboard (Read-only) — Supabase 조회 API
// =========================================================================
// ⚠️ SELECT 전용. insert/update/delete 함수는 만들지 않는다.
//    ai_rule_decisions 저장은 서버 service role(파이썬 파이프라인)에서만 한다.
//    이 화면은 RuleDecision 을 "보기만" 한다 — 학생 상태/출결/벌점/알림 변경 없음.
//
// ai_rule_decisions 는 아직 database.types.ts 에 생성되지 않아 느슨하게 접근한다
// (admin-monitor 의 seat_layouts 등과 동일한 관례: as unknown / as any 캐스팅).
// =========================================================================

import { supabase } from '@/lib/supabase/client';
import type { AIDecisionRow, AIDecisionFilters } from './types';

const TABLE = 'ai_rule_decisions';
const COLUMNS =
  'id, decision_uuid, facts_uuid, burst_uuid, seat_id, period_id, period_name, ' +
  'decided_at, activity, confidence, status, severity, reasons, evidence, ' +
  'rule_hits, quality, metadata, created_at';

// 좌석별 최신 1건을 추리기 위해 가져오는 상한(좌석 8석 * 여유분).
const LATEST_SCAN_LIMIT = 200;

// 타입 미생성 테이블 → 느슨한 빌더(쿼리 체인만 사용, 쓰기 메서드는 호출 안 함).
function fromDecisions(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from(TABLE);
}

/** 최근 AI 판정 로그(필터/limit 지원). 기본 50건, 최신순. */
export async function getRecentAIDecisions(
  params: AIDecisionFilters = {}
): Promise<AIDecisionRow[]> {
  let query = fromDecisions().select(COLUMNS).order('decided_at', { ascending: false });

  if (params.seatId) query = query.eq('seat_id', params.seatId);
  if (params.activity) query = query.eq('activity', params.activity);
  if (params.status) query = query.eq('status', params.status);
  if (params.severity) query = query.eq('severity', params.severity);

  query = query.limit(params.limit ?? 50);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AIDecisionRow[];
}

/** 좌석별 최신 판정 목록. seat_id 기준 가장 최근 decided_at 1건씩. */
export async function getLatestAIDecisionsBySeats(
  seatIds?: string[]
): Promise<AIDecisionRow[]> {
  const { data, error } = await fromDecisions()
    .select(COLUMNS)
    .order('decided_at', { ascending: false })
    .limit(LATEST_SCAN_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as AIDecisionRow[];
  const latestBySeat = new Map<string, AIDecisionRow>();
  for (const row of rows) {
    if (!latestBySeat.has(row.seat_id)) latestBySeat.set(row.seat_id, row); // 이미 최신순 정렬
  }
  let result = Array.from(latestBySeat.values());
  if (seatIds) result = result.filter((r) => seatIds.includes(r.seat_id));
  return result;
}

/** 상세 보기용 단일 조회. id(uuid) 또는 decision_uuid 둘 다 지원. */
export async function getAIDecisionById(
  idOrDecisionUuid: string
): Promise<AIDecisionRow | null> {
  const { data, error } = await fromDecisions()
    .select(COLUMNS)
    .or(`id.eq.${idOrDecisionUuid},decision_uuid.eq.${idOrDecisionUuid}`)
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as AIDecisionRow[];
  return rows[0] ?? null;
}
```

### 2-3. `src/features/admin-ai-decisions/hooks.ts`

```typescript
// =========================================================================
// Admin AI Dashboard (Read-only) — react-query 훅 + Realtime
// =========================================================================
// 조회 전용. mutation 훅은 만들지 않는다.
// =========================================================================

import { useQuery } from '@tanstack/react-query';
import {
  getLatestAIDecisionsBySeats,
  getRecentAIDecisions,
  getAIDecisionById,
} from './api';
import type { AIDecisionFilters } from './types';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';

export const SEAT_DECISIONS_KEY = ['ai-decisions-by-seat'] as const;
export const RECENT_DECISIONS_KEY = ['ai-decisions-recent'] as const;

export function useLatestAIDecisionsBySeatsQuery(seatIds?: string[]) {
  return useQuery({
    queryKey: [...SEAT_DECISIONS_KEY, seatIds ?? 'all'],
    queryFn: () => getLatestAIDecisionsBySeats(seatIds),
    staleTime: 1000 * 30,
  });
}

export function useRecentAIDecisionsQuery(params: AIDecisionFilters) {
  return useQuery({
    queryKey: [...RECENT_DECISIONS_KEY, params],
    queryFn: () => getRecentAIDecisions(params),
    staleTime: 1000 * 30,
  });
}

export function useAIDecisionByIdQuery(idOrDecisionUuid: string | null) {
  return useQuery({
    queryKey: ['ai-decision-detail', idOrDecisionUuid],
    queryFn: () => getAIDecisionById(idOrDecisionUuid as string),
    enabled: !!idOrDecisionUuid,
  });
}

/** ai_rule_decisions INSERT(새 판정) 발생 시 좌석 카드/로그 갱신. */
export function useAIDecisionsRealtime() {
  useRealtimeTableSync('ai_rule_decisions', [SEAT_DECISIONS_KEY, RECENT_DECISIONS_KEY]);
}
```

### 2-4. `src/features/admin-ai-decisions/components/AIDecisionSeatCard.tsx`

```tsx
import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG,
  SEVERITY_CONFIG,
  confidencePercent,
  overallQuality,
  minutesSince,
  isStale,
  LOW_CONFIDENCE_THRESHOLD,
  type AIDecisionRow,
} from '../types';

interface Props {
  seatId: string;
  row: AIDecisionRow | null;
  nowMs: number;
  onOpen: (row: AIDecisionRow) => void;
}

function AIDecisionSeatCardInner({ seatId, row, nowMs, onOpen }: Props) {
  // 판정 없음
  if (!row) {
    return (
      <div className="flex flex-col rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-3 opacity-80">
        <span className="text-[10px] font-bold text-gray-400">{seatId}</span>
        <div className="flex flex-1 items-center justify-center py-3 min-h-[40px]">
          <p className="text-xs text-gray-300">AI 판정 없음</p>
        </div>
      </div>
    );
  }

  const cfg = ACTIVITY_CONFIG[row.activity];
  const sev = SEVERITY_CONFIG[row.severity];
  const pct = confidencePercent(row.confidence);
  const quality = overallQuality(row);
  const stale = isStale(row.decided_at, nowMs);
  const lowConf = (row.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD;
  const topReason = row.reasons?.[0];

  return (
    <div className={cn('flex flex-col rounded-xl border-2 p-3', cfg.cardClass)}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500">{seatId}</span>
        <span className={cn('h-2 w-2 rounded-full', cfg.dotClass)} />
      </div>

      <div className="flex items-center justify-center py-1">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', cfg.badgeClass)}>
          {cfg.emoji} {cfg.label}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-center gap-1 text-[11px]">
        <span className="font-semibold text-gray-700">{pct}%</span>
        <span className={cn('rounded px-1 py-0.5 font-medium', sev.badgeClass)}>{sev.label}</span>
      </div>

      {(stale || lowConf) && (
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {stale && (
            <span className="rounded bg-gray-200 px-1 text-[10px] text-gray-500">오래됨</span>
          )}
          {lowConf && (
            <span className="rounded bg-yellow-100 px-1 text-[10px] text-yellow-700">신뢰 낮음</span>
          )}
        </div>
      )}

      {topReason && (
        <p className="mt-1 line-clamp-2 text-center text-[10px] text-gray-500">{topReason}</p>
      )}

      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
        <span>{minutesSince(row.decided_at, nowMs)}분 전</span>
        {quality !== null && <span>품질 {Math.round(quality * 100)}%</span>}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] text-gray-400">AI 추정 · 자동 변경 아님</span>
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="rounded-md bg-white/70 px-2 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-white"
        >
          상세
        </button>
      </div>
    </div>
  );
}

export const AIDecisionSeatCard = memo(AIDecisionSeatCardInner);
```

### 2-5. `src/features/admin-ai-decisions/components/AIDecisionSeatGrid.tsx`

```tsx
import { useMemo } from 'react';
import { AIDecisionSeatCard } from './AIDecisionSeatCard';
import { SEAT_IDS, type AIDecisionRow } from '../types';

interface Props {
  rows: AIDecisionRow[];
  seatIds?: string[];
  nowMs: number;
  onOpen: (row: AIDecisionRow) => void;
}

/** Seat1~Seat8 좌석별 최신 AI 판정 카드 그리드. */
export function AIDecisionSeatGrid({ rows, seatIds = SEAT_IDS, nowMs, onOpen }: Props) {
  const bySeat = useMemo(() => {
    const map = new Map<string, AIDecisionRow>();
    for (const row of rows) {
      if (!map.has(row.seat_id)) map.set(row.seat_id, row); // rows 는 최신순 가정
    }
    return map;
  }, [rows]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {seatIds.map((seatId) => (
        <AIDecisionSeatCard
          key={seatId}
          seatId={seatId}
          row={bySeat.get(seatId) ?? null}
          nowMs={nowMs}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
```

### 2-6. `src/features/admin-ai-decisions/components/AIDecisionLogTable.tsx`

```tsx
import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG, SEVERITY_CONFIG, STATUS_LABEL, SEAT_IDS, confidencePercent,
  type AIDecisionRow, type AIDecisionFilters, type Activity, type Severity, type DecisionStatus,
} from '../types';

interface Props {
  rows: AIDecisionRow[];
  filters: AIDecisionFilters;
  onFiltersChange: (next: AIDecisionFilters) => void;
  onOpen: (row: AIDecisionRow) => void;
}

const ACTIVITIES: Activity[] = ['STUDYING', 'PHONE', 'SLEEPING', 'ABSENT', 'UNKNOWN'];
const SEVERITIES: Severity[] = ['INFO', 'WATCH', 'WARNING', 'CRITICAL'];
const STATUSES: DecisionStatus[] = ['SUCCESS', 'SKIPPED', 'FAILED', 'LOW_CONFIDENCE'];
const LIMITS = [20, 50, 100];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** 최근 AI 판정 로그 테이블(읽기 전용 — 수정/삭제/상태반영 버튼 없음). */
export function AIDecisionLogTable({ rows, filters, onFiltersChange, onOpen }: Props) {
  const set = (patch: Partial<AIDecisionFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-2">
      {/* 필터: 좌석/활동/심각도/상태/개수 (생략 없이 select 5종) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select aria-label="좌석 필터" className="rounded border border-gray-200 px-2 py-1"
          value={filters.seatId ?? ''} onChange={(e) => set({ seatId: e.target.value || undefined })}>
          <option value="">전체 좌석</option>
          {SEAT_IDS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* ... activity / severity / status / limit select 동일 패턴 ... */}
      </div>

      {/* 테이블: 시간/좌석/교시/활동/신뢰/심각도/상태/근거/상세 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-gray-50 text-gray-500"><tr>
            <th className="px-2 py-1.5 font-medium">시간</th>
            <th className="px-2 py-1.5 font-medium">좌석</th>
            <th className="px-2 py-1.5 font-medium">교시</th>
            <th className="px-2 py-1.5 font-medium">활동</th>
            <th className="px-2 py-1.5 font-medium">신뢰</th>
            <th className="px-2 py-1.5 font-medium">심각도</th>
            <th className="px-2 py-1.5 font-medium">상태</th>
            <th className="px-2 py-1.5 font-medium">근거</th>
            <th className="px-2 py-1.5 font-medium" />
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-2 py-6 text-center text-gray-400">표시할 AI 판정이 없습니다</td></tr>
            ) : rows.map((row) => {
              const cfg = ACTIVITY_CONFIG[row.activity];
              const sev = SEVERITY_CONFIG[row.severity];
              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{fmtTime(row.decided_at)}</td>
                  <td className="px-2 py-1.5 font-medium text-gray-700">{row.seat_id}</td>
                  <td className="px-2 py-1.5 text-gray-500">{row.period_name ?? '-'}</td>
                  <td className="px-2 py-1.5"><span className={cn('rounded px-1.5 py-0.5 font-medium', cfg.badgeClass)}>{cfg.label}</span></td>
                  <td className="px-2 py-1.5 text-gray-700">{confidencePercent(row.confidence)}%</td>
                  <td className="px-2 py-1.5"><span className={cn('rounded px-1.5 py-0.5 font-medium', sev.badgeClass)}>{sev.label}</span></td>
                  <td className="px-2 py-1.5 text-gray-500">{STATUS_LABEL[row.status]}</td>
                  <td className="max-w-[200px] truncate px-2 py-1.5 text-gray-500">{row.reasons?.[0] ?? '-'}</td>
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => onOpen(row)}
                      className="rounded-md px-2 py-0.5 font-medium text-brand-600 hover:bg-brand-50">상세</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```
> (실제 파일에는 activity/severity/status/limit 4개 select 가 좌석 select 와 동일 패턴으로 모두 포함됨.)

### 2-7. `src/features/admin-ai-decisions/components/AIDecisionDetailDrawer.tsx`

```tsx
import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG, SEVERITY_CONFIG, STATUS_LABEL, confidencePercent, type AIDecisionRow,
} from '../types';

interface Props { row: AIDecisionRow | null; onClose: () => void; }

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="break-all text-sm text-gray-800">{value}</span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <pre className="max-h-48 overflow-auto rounded-md bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-700">
        <code>{JSON.stringify(value ?? null, null, 2)}</code>
      </pre>
    </div>
  );
}

/** AI 판정 상세 보기 Drawer(읽기 전용 — 값 수정 불가). */
export function AIDecisionDetailDrawer({ row, onClose }: Props) {
  if (!row) return null;
  const cfg = ACTIVITY_CONFIG[row.activity];
  const sev = SEVERITY_CONFIG[row.severity];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', cfg.badgeClass)}>{cfg.emoji} {cfg.label}</span>
            <span className="text-xs text-gray-400">{row.seat_id}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label="닫기">✕</button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            AI 추정 결과입니다. 학생 상태·출결·벌점은 자동 변경되지 않습니다.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="activity" value={`${cfg.label} (${row.activity})`} />
            <Field label="confidence" value={`${confidencePercent(row.confidence)}%`} />
            <Field label="status" value={STATUS_LABEL[row.status]} />
            <Field label="severity" value={<span className={cn('rounded px-1.5 py-0.5', sev.badgeClass)}>{sev.label}</span>} />
            <Field label="seat_id" value={row.seat_id} />
            <Field label="period" value={row.period_name ?? row.period_id ?? '-'} />
            <Field label="decided_at" value={new Date(row.decided_at).toLocaleString('ko-KR')} />
            <Field label="created_at" value={new Date(row.created_at).toLocaleString('ko-KR')} />
            <Field label="decision_uuid" value={row.decision_uuid} />
            <Field label="facts_uuid" value={row.facts_uuid ?? '-'} />
            <Field label="burst_uuid" value={row.burst_uuid ?? '-'} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">reasons</span>
            {row.reasons?.length ? (
              <ul className="list-disc pl-4 text-sm text-gray-700">{row.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            ) : <span className="text-sm text-gray-400">-</span>}
          </div>

          <JsonBlock label="evidence" value={row.evidence} />
          <JsonBlock label="rule_hits" value={row.rule_hits} />
          <JsonBlock label="quality" value={row.quality} />
          <JsonBlock label="metadata" value={row.metadata} />
        </div>
      </aside>
    </div>
  );
}
```

### 2-8. `src/features/admin-ai-decisions/components/AIDecisionSection.tsx`

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/Spinner';
import {
  useLatestAIDecisionsBySeatsQuery, useRecentAIDecisionsQuery, useAIDecisionsRealtime,
  SEAT_DECISIONS_KEY, RECENT_DECISIONS_KEY,
} from '../hooks';
import { AI_DISCLAIMER, SEAT_IDS, type AIDecisionRow, type AIDecisionFilters } from '../types';
import { AIDecisionSeatGrid } from './AIDecisionSeatGrid';
import { AIDecisionLogTable } from './AIDecisionLogTable';
import { AIDecisionDetailDrawer } from './AIDecisionDetailDrawer';

/**
 * 관리자 대시보드 "AI 판정 현황" 섹션(읽기 전용).
 * 1) 안내 배너  2) 좌석별 최신 판정 카드  3) 최근 판정 로그 + 상세 Drawer
 * ⚠️ 학생 상태/출결/벌점/알림을 절대 변경하지 않는다.
 */
export function AIDecisionSection() {
  const [filters, setFilters] = useState<AIDecisionFilters>({ limit: 50 });
  const [selected, setSelected] = useState<AIDecisionRow | null>(null);

  const qc = useQueryClient();
  useAIDecisionsRealtime();

  const seatQuery = useLatestAIDecisionsBySeatsQuery(SEAT_IDS);
  const logQuery = useRecentAIDecisionsQuery(filters);

  const nowMs = Date.now();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: SEAT_DECISIONS_KEY });
    qc.invalidateQueries({ queryKey: RECENT_DECISIONS_KEY });
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">AI 판정 현황</h3>
        <button type="button" onClick={refresh}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">새로고침</button>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠️ {AI_DISCLAIMER}
      </div>

      <div>
        {seatQuery.isLoading ? <div className="flex justify-center py-6"><Spinner /></div>
          : <AIDecisionSeatGrid rows={seatQuery.data ?? []} nowMs={nowMs} onOpen={setSelected} />}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-gray-500">최근 AI 판정 로그</h4>
        {logQuery.isLoading ? <div className="flex justify-center py-6"><Spinner /></div>
          : <AIDecisionLogTable rows={logQuery.data ?? []} filters={filters} onFiltersChange={setFilters} onOpen={setSelected} />}
      </div>

      <AIDecisionDetailDrawer row={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
```

### 2-9. 테스트 — `__tests__/aiDecisionsApi.test.ts` (요지)
- supabase 클라이언트를 체인 빌더로 mock → `getRecentAIDecisions` 가 **select/order/eq 만** 호출하고 insert/update/delete 미호출 검증.
- 필터를 `eq('seat_id'|'activity'|'status'|'severity', ...)` 로 적용하는지.
- `getLatestAIDecisionsBySeats` 가 seat_id 별 최신 1건만 남기는지.
- API 모듈이 `insert|update|delete|save|create|remove|upsert` 이름의 함수를 **export 하지 않음**(정확히 select 3종만).
- `api.ts` 소스에 `.insert(`/`.update(`/`.delete(`/도메인 토큰(penalty/attendance/...)이 없음(소스 스캔).

### 2-10. 테스트 — `__tests__/AIDecisionComponents.test.tsx` (요지)
- SeatCard: STUDYING→"공부 추정"+confidence%+"AI 추정 · 자동 변경 아님", PHONE→"휴대폰 추정", null→"AI 판정 없음".
- SeatGrid: Seat1 데이터 1건 + 나머지 7석 "AI 판정 없음".
- LogTable: 행 렌더 + **삭제/수정/상태반영 버튼 없음**(상세 버튼만).
- Drawer: reasons/evidence/rule_hits/quality + "자동 변경되지 않습니다", null→빈 렌더.
- `AI_DISCLAIMER` 문구 + 컴포넌트 소스에 부수효과/도메인 토큰 없음(소스 스캔).

---

## 3. 수정된 파일 전체 코드 (변경 부분)

### 3-1. `src/pages/admin/DashboardPage.tsx` — "AI 판정 현황" 섹션 추가

```tsx
// import 추가
import { AIDecisionSection } from '@/features/admin-ai-decisions/components/AIDecisionSection';

// ... 기존 대시보드 JSX 끝부분(최근 알림 블록) 다음에 추가:
      {/* AI 판정 현황 (읽기 전용 — 학생 상태/출결/벌점 자동 변경 없음) */}
      <AIDecisionSection />
    </div>
  );
}
```

### 3-2. `rtsp-poc/README.md`
- 헤더 모듈 목록에 **Admin AI Dashboard Read-only v0.1** 추가, 범위 경고에 "보기만/보조 지표" 명시.
- **"## Admin AI Dashboard Read-only v0.1 (프론트엔드)"** 절 신규: RLS, 화면 구성, 색상/의미, 접근 제어, 테스트, 다음 단계.

---

## 4. Supabase RLS/migration 전체 코드

`supabase/migrations/20260709000000_ai_rule_decisions_admin_read.sql`

```sql
-- =========================================================================
-- AI Rule Decisions — 관리자 읽기 전용(read-only) + Realtime
-- =========================================================================
-- 20260708000000_ai_rule_decisions.sql 에서 만든 ai_rule_decisions 테이블에
-- "관리자만 SELECT" RLS 정책과 Realtime 발행을 추가한다.
--
-- ⚠️ 읽기 전용이다.
--    - INSERT/UPDATE/DELETE 정책은 만들지 않는다(저장은 기존처럼 서버 service role 만).
--    - 학생/일반 사용자는 조회 불가(is_admin() 만 허용).
--    - 이 단계는 "관리자가 AI 판정 결과를 보기만" 한다 — 학생 상태/출결/벌점/알림은 건드리지 않는다.
-- =========================================================================

-- 관리자만 읽기. 기존 is_admin() 헬퍼(20260625081627_auth_helpers.sql)를 재사용.
drop policy if exists "ai_rule_decisions_select_admin" on public.ai_rule_decisions;
create policy "ai_rule_decisions_select_admin" on public.ai_rule_decisions
  for select
  to authenticated
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- Realtime: 새 판정 INSERT 시 관리자 대시보드가 갱신되도록 발행에 추가.
-- -------------------------------------------------------------------------
alter table public.ai_rule_decisions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ai_rule_decisions'
  ) then
    alter publication supabase_realtime add table public.ai_rule_decisions;
  end if;
end $$;
```

> ⚠️ **migration 파일 생성까지만** 수행. 실제 원격/로컬 DB 적용(`supabase db push`)은 사용자 확인 후 별도.
> (이 정책이 적용되어야 관리자 브라우저에서 조회·Realtime 이 동작한다.)

---

## 5. 관리자 AI 대시보드 구조도

```
   파이썬 파이프라인(서버, service role)
        └─ ai_decision_storage_pipeline → INSERT public.ai_rule_decisions
                                                   │
                                                   │ (RLS: service role 저장 / 관리자만 SELECT)
                                                   ▼
   ┌──────────────────────── 관리자 브라우저 (React) ────────────────────────┐
   │  DashboardPage                                                          │
   │    └─ <AIDecisionSection>                                               │
   │         ├─ useAIDecisionsRealtime() ── postgres_changes(INSERT) ─┐      │
   │         ├─ useLatestAIDecisionsBySeatsQuery(SEAT_IDS)            │ 무효화 │
   │         │     └─ getLatestAIDecisionsBySeats() ── SELECT ────────┤      │
   │         ├─ useRecentAIDecisionsQuery(filters)                    │      │
   │         │     └─ getRecentAIDecisions() ── SELECT + eq 필터 ─────┘      │
   │         │                                                               │
   │         ├─ 안내 배너("자동 변경되지 않습니다")                          │
   │         ├─ <AIDecisionSeatGrid> → Seat1~8 <AIDecisionSeatCard>          │
   │         ├─ <AIDecisionLogTable> (필터 + 행, 상세 버튼만)                │
   │         └─ <AIDecisionDetailDrawer> (reasons/evidence/... 읽기전용 JSON)│
   └────────────────────────────────────────────────────────────────────────┘

   ── 읽기 전용 단방향. 학생 상태/출결/벌점/알림/영상 으로 가는 화살표 없음. ──
```

**핵심 설계 원칙**
- **읽기 전용 단방향**: SELECT 만. insert/update/delete 함수·버튼·정책 없음(테스트로 강제).
- **권한 이중 차단**: 관리자 라우트(기존) + RLS `is_admin()`. 학생 계정엔 노출 안 됨.
- **보조 지표 명시**: 카드/배너/Drawer 마다 "AI 추정 · 자동 변경 아님".
- **기존 패턴 재사용**: feature 폴더 구조 / react-query / `useRealtimeTableSync` / Tailwind 톤.

---

## 6. API 함수 설명 (SELECT 전용)

| 함수 | 동작 |
|------|------|
| `getRecentAIDecisions(params)` | 최근 판정 로그. `seatId/activity/status/severity` 필터(eq) + `limit`(기본 50), 최신순 |
| `getLatestAIDecisionsBySeats(seatIds?)` | 최근 N건을 가져와 **seat_id 별 최신 1건**만 추림(별도 RPC 없이 클라에서 정리) |
| `getAIDecisionById(idOrDecisionUuid)` | 상세 보기용 단건. `id`(uuid) 또는 `decision_uuid` 둘 다 지원(`or`) |

- 모두 `(supabase as any).from('ai_rule_decisions').select(...)` — 타입 미생성 테이블 접근(기존 관례).
- **insert/update/delete/upsert 함수 없음** — 모듈 export 가 정확히 위 3개뿐임을 테스트로 검증.

---

## 7. 컴포넌트 설명

| 컴포넌트 | 역할 |
|----------|------|
| `AIDecisionSeatCard` | 좌석 1칸 최신 판정: activity 뱃지/confidence%/severity/시각/주요 reason/품질. 없으면 "AI 판정 없음", 오래됨/신뢰낮음 플래그 |
| `AIDecisionSeatGrid` | Seat1~8(SEAT_IDS) 카드 배치. rows→seat_id 맵으로 최신 1건 매칭 |
| `AIDecisionLogTable` | 최근 로그 테이블(시간/좌석/교시/활동/신뢰/심각도/상태/근거) + 필터 select 5종. **수정/삭제/상태반영 버튼 없음** |
| `AIDecisionDetailDrawer` | 우측 Drawer 상세. 식별자/판정/ reasons + evidence·rule_hits·quality·metadata **읽기 전용 `<pre>` JSON** |
| `AIDecisionSection` | 위를 묶는 컨테이너: 안내 배너 + 그리드 + 로그 + Drawer + Realtime + 새로고침. DashboardPage 에서 사용 |

색상: STUDYING 초록 / PHONE 빨강 / SLEEPING 보라 / ABSENT·UNKNOWN 회색. severity: INFO 회색 → WATCH 황 → WARNING 주황 → CRITICAL 빨강.

---

## 8. 화면 표시 예시

```
관리자 대시보드 ▸ AI 판정 현황                         [새로고침]
┌──────────────────────────────────────────────────────────────┐
│ ⚠️ AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동      │
│    변경되지 않습니다.                                          │
└──────────────────────────────────────────────────────────────┘
┌─ Seat1 ●─┐ ┌─ Seat2 ●─┐ ┌─ Seat3 ●─┐ ┌─ Seat4 ──┐
│ 🟢 공부  │ │ 🔴 휴대폰│ │ 🟣 수면  │ │          │
│  92% 정보│ │  80% 경고│ │  75% 주의│ │ AI 판정  │
│  3분 전  │ │ 신뢰낮음 │ │  오래됨  │ │  없음    │
│ 품질 87% │ │  1분 전  │ │  12분 전 │ │          │
│AI추정 상세│ │AI추정 상세│ │AI추정 상세│ └──────────┘
└──────────┘ └──────────┘ └──────────┘  ... Seat5~8

최근 AI 판정 로그  [전체좌석▼][전체활동▼][전체심각도▼][전체상태▼][최근50개▼]
┌ 시간 ─ 좌석 ─ 교시 ─ 활동 ─ 신뢰 ─ 심각도 ─ 상태 ─ 근거 ───── ┐
│ 06-30 09:30 Seat2 0교시 휴대폰추정 80% 경고 판정완료 휴대폰…  [상세] │
│ 06-30 09:00 Seat1 0교시 공부추정  92% 정보 판정완료 책 또는… [상세] │
└──────────────────────────────────────────────────────────────┘

[상세] 클릭 → 우측 Drawer: decision_uuid/facts_uuid/... + reasons 목록
        + evidence/rule_hits/quality/metadata 를 읽기 전용 JSON 으로 표시
```

---

## 9. 테스트 결과

```bash
npx vitest run src/features/admin-ai-decisions
#  Test Files  2 passed (2)
#       Tests  15 passed (15)
```
- `aiDecisionsApi.test.ts`(6): select 전용 / 필터 eq / 좌석별 최신 / mutation export 없음 / 소스에 쓰기·도메인 토큰 없음.
- `AIDecisionComponents.test.tsx`(9): SeatCard(공부/휴대폰/없음) / Grid(7석 없음) / LogTable(수정·삭제 버튼 없음) /
  Drawer(reasons·evidence·rule_hits·quality·자동변경 아님 / null 빈 렌더) / AI_DISCLAIMER / 컴포넌트 소스 부수효과 없음.

**전체 회귀**
```bash
npx tsc --noEmit      # 에러 없음(클린)
npx vitest run        # Test Files 9 passed / Tests 61 passed  ← 기존 46 + 신규 15
```

---

## 10. 남은 기술부채

1. **migration 미적용**: admin-read RLS/Realtime 파일만 생성. 원격 적용 전엔 관리자 브라우저에서 조회/Realtime 불가(service role 만 가능).
2. **database.types.ts 미반영**: `ai_rule_decisions` 가 생성 타입에 없어 `(supabase as any)` 캐스팅. `supabase gen types` 로 갱신 시 제거 가능.
3. **좌석 매핑**: AI 의 `seat_id`("Seat1") ↔ 앱의 `seat_number`(1) 연결 없음. 카드가 학생 이름과 묶이지 않음(좌석 문자열만).
4. **좌석별 최신 = 클라 정리**: 200건 받아 seat_id 별 첫 행. 데이터 많아지면 좌석별 distinct RPC/뷰가 효율적.
5. **시각 비-실시간**: `Date.now()` 를 렌더 시 1회 계산("n분 전"이 자동 tick 안 됨). 실시간/재조회 시에만 갱신.
6. **Realtime 의존**: 발행/replica identity 적용 전엔 새로고침 버튼에 의존.
7. **빈 evidence/JSON 가독성**: 큰 JSON 은 pre 스크롤만. 키 하이라이트/접기 없음.

---

## 11. v0.2 개선계획

1. **migration 적용 + 타입 생성**: admin-read RLS/Realtime 원격 반영, `database.types.ts` 갱신 → `as any` 제거.
2. **좌석↔학생 매핑**: `seat_id`→`seat_number`→학생 이름 연결, 관제(admin-monitor) 좌석과 한 화면에서 교차 확인.
3. **좌석별 최신 뷰/RPC**: `distinct on (seat_id)` 뷰 또는 RPC 로 효율화.
4. **실시간 시계**: `useCurrentTime` 도입해 "n분 전"/오래됨 자동 갱신.
5. **시계열 안정화**: 단발 판정의 오탐을 줄이는 누적/다수결 표시(교시 단위 요약).
6. **관리자 검수 기반 상태 반영(신중)**: 관리자가 확인한 판정만 별도 액션으로 반영하는 흐름 설계 —
   **자동 변경/알림/벌점/출결은 여전히 분리**, 사람이 최종 결정.
7. **학생 화면 공개 검토(후순위)**: 본인 한정 read-only 공개 여부는 프라이버시·정책 합의 후.

> v0.1 범위 재확인: **관리자가 AI 판정 결과를 "보기만" 하는 것까지.**
> 학생 상태 변경 / 출결 / 벌점 / 알림 / 보호자 연락 / AI 판정 수정·삭제 / 영상·이미지 표시·저장 / 학생 앱 공개는 절대 미구현.
