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

/** 안정화 계산용 최근 판정 조회(좌석별 최근 N개 확보). 그룹핑/계산은 프론트에서. */
export async function getRecentAIDecisionsForStabilization(
  seatIds?: string[],
  limitPerSeat = 5
): Promise<AIDecisionRow[]> {
  // 좌석 수 × limitPerSeat 보다 넉넉히 가져와 좌석별 최근 N개를 안정적으로 확보.
  const seatCount = seatIds?.length ?? 8;
  const scan = Math.min(LATEST_SCAN_LIMIT, Math.max(40, seatCount * limitPerSeat * 4));
  const { data, error } = await fromDecisions()
    .select(COLUMNS)
    .order('decided_at', { ascending: false })
    .limit(scan);
  if (error) throw error;
  const rows = (data ?? []) as AIDecisionRow[];
  if (!seatIds) return rows;
  return rows.filter((r) => seatIds.includes(r.seat_id));
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
