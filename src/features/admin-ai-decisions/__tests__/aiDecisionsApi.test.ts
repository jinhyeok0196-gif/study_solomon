import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FEATURE_DIR = join(process.cwd(), 'src/features/admin-ai-decisions');

// ── Supabase 클라이언트 mock(체인 빌더) ───────────────────────────────────
const mock = vi.hoisted(() => {
  const rows = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      decision_uuid: 'dec-1', facts_uuid: 'f1', burst_uuid: 'b1',
      seat_id: 'Seat1', period_id: 'P0', period_name: '0교시',
      decided_at: '2026-06-30T09:30:00', activity: 'PHONE', confidence: 0.8,
      status: 'SUCCESS', severity: 'WARNING', reasons: ['휴대폰 객체가 검출됨'],
      evidence: {}, rule_hits: [], quality: { overall_quality: 0.8 }, metadata: {},
      created_at: '2026-06-30T09:30:01',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      decision_uuid: 'dec-2', facts_uuid: 'f2', burst_uuid: 'b2',
      seat_id: 'Seat1', period_id: 'P0', period_name: '0교시',
      decided_at: '2026-06-30T09:00:00', activity: 'STUDYING', confidence: 0.9,
      status: 'SUCCESS', severity: 'INFO', reasons: ['책 또는 학습 도구가 검출됨'],
      evidence: {}, rule_hits: [], quality: { overall_quality: 0.87 }, metadata: {},
      created_at: '2026-06-30T09:00:01',
    },
  ];
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  const from = vi.fn(() => builder);
  return { rows, builder, from };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: mock.from } }));

import * as api from '../api';

beforeEach(() => {
  Object.values(mock.builder).forEach((fn) => fn.mockClear());
  mock.from.mockClear();
});

describe('aiDecisionsApi (read-only)', () => {
  it('getRecentAIDecisions 는 select/order 만 쓰고 insert/update/delete 를 호출하지 않는다', async () => {
    const result = await api.getRecentAIDecisions({ limit: 50 });
    expect(mock.from).toHaveBeenCalledWith('ai_rule_decisions');
    expect(mock.builder.select).toHaveBeenCalled();
    expect(mock.builder.order).toHaveBeenCalled();
    expect(mock.builder.insert).not.toHaveBeenCalled();
    expect(mock.builder.update).not.toHaveBeenCalled();
    expect(mock.builder.delete).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  it('필터(seatId/activity/status/severity)를 eq 로 적용한다', async () => {
    await api.getRecentAIDecisions({ seatId: 'Seat1', activity: 'PHONE', status: 'SUCCESS', severity: 'WARNING' });
    expect(mock.builder.eq).toHaveBeenCalledWith('seat_id', 'Seat1');
    expect(mock.builder.eq).toHaveBeenCalledWith('activity', 'PHONE');
    expect(mock.builder.eq).toHaveBeenCalledWith('status', 'SUCCESS');
    expect(mock.builder.eq).toHaveBeenCalledWith('severity', 'WARNING');
  });

  it('getLatestAIDecisionsBySeats 는 seat_id 별 최신 1건만 남긴다', async () => {
    const result = await api.getLatestAIDecisionsBySeats(['Seat1']);
    expect(result).toHaveLength(1);
    expect(result[0].decision_uuid).toBe('dec-1'); // 더 최근(9:30)
    expect(mock.builder.insert).not.toHaveBeenCalled();
  });

  it('getAIDecisionById 는 id 또는 decision_uuid 로 단건 조회한다', async () => {
    const row = await api.getAIDecisionById('dec-1');
    expect(mock.builder.or).toHaveBeenCalled();
    expect(row).not.toBeNull();
  });

  it('API 모듈은 mutation(insert/update/delete/save/create/remove) 함수를 export 하지 않는다', () => {
    const names = Object.keys(api);
    const forbidden = names.filter((n) => /insert|update|delete|save|create|remove|upsert/i.test(n));
    expect(forbidden).toEqual([]);
    // select 전용 함수만 존재
    expect(names.sort()).toEqual(
      ['getAIDecisionById', 'getLatestAIDecisionsBySeats', 'getRecentAIDecisions'].sort()
    );
  });

  it('api.ts 소스에 쓰기/부수효과 코드가 없다(.insert/.update/.delete + 도메인 토큰)', () => {
    const src = readFileSync(join(FEATURE_DIR, 'api.ts'), 'utf-8').toLowerCase();
    for (const tok of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(src.includes(tok)).toBe(false);
    }
    for (const tok of ['penalty', 'attendance', 'notification', 'membership']) {
      expect(src.includes(tok)).toBe(false);
    }
  });
});
