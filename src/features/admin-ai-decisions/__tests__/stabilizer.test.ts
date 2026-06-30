import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stabilizeAIDecisions, stabilizeAIDecisionsBySeat } from '../stabilizer';
import type { AIDecisionRow, Activity, DecisionStatus } from '../types';

const BASE = Date.parse('2026-06-30T09:30:00Z');

function row(
  activity: Activity, confidence: number, minutesAgo: number,
  status: DecisionStatus = 'SUCCESS', seat = 'Seat1'
): AIDecisionRow {
  return {
    id: `id-${activity}-${minutesAgo}-${seat}`,
    decision_uuid: `dec-${activity}-${minutesAgo}-${seat}`,
    facts_uuid: 'f', burst_uuid: 'b', seat_id: seat,
    period_id: 'P0', period_name: '0교시',
    decided_at: new Date(BASE - minutesAgo * 60_000).toISOString(),
    activity, confidence, status, severity: 'INFO',
    reasons: [], evidence: {}, rule_hits: [], quality: {}, metadata: {},
    created_at: new Date(BASE - minutesAgo * 60_000).toISOString(),
  };
}

describe('stabilizeAIDecisions', () => {
  it('입력 0개 → INSUFFICIENT_DATA / UNKNOWN', () => {
    const c = stabilizeAIDecisions([]);
    expect(c.status).toBe('INSUFFICIENT_DATA');
    expect(c.activity).toBe('UNKNOWN');
    expect(c.decision_count).toBe(0);
  });

  it('입력 2개(< min 3) → INSUFFICIENT_DATA', () => {
    const c = stabilizeAIDecisions([row('PHONE', 0.8, 0), row('PHONE', 0.8, 1)]);
    expect(c.status).toBe('INSUFFICIENT_DATA');
  });

  it('PHONE 3/5 → STABLE PHONE (severity WARNING)', () => {
    const c = stabilizeAIDecisions([
      row('PHONE', 0.8, 0), row('PHONE', 0.78, 1), row('STUDYING', 0.6, 2),
      row('PHONE', 0.82, 3), row('STUDYING', 0.6, 4),
    ]);
    expect(c.status).toBe('STABLE');
    expect(c.activity).toBe('PHONE');
    expect(c.severity).toBe('WARNING');
    expect(c.activity_counts.PHONE).toBe(3);
    expect(c.source_decision_uuids).toHaveLength(5);
  });

  it('STUDYING 4/5 → STABLE STUDYING (severity INFO)', () => {
    const c = stabilizeAIDecisions([
      row('STUDYING', 0.9, 0), row('STUDYING', 0.85, 1), row('STUDYING', 0.88, 2),
      row('PHONE', 0.66, 3), row('STUDYING', 0.8, 4),
    ]);
    expect(c.status).toBe('STABLE');
    expect(c.activity).toBe('STUDYING');
    expect(c.severity).toBe('INFO');
  });

  it('PHONE/STUDYING 2:2 → CONFLICTED / UNKNOWN', () => {
    const c = stabilizeAIDecisions([
      row('PHONE', 0.75, 0), row('STUDYING', 0.76, 1),
      row('PHONE', 0.74, 2), row('STUDYING', 0.77, 3),
    ]);
    expect(c.status).toBe('CONFLICTED');
    expect(c.activity).toBe('UNKNOWN');
    expect(c.evidence.conflict_detected).toBe(true);
    expect(c.reasons.some((r) => r.includes('충돌') || r.includes('보류'))).toBe(true);
  });

  it('평균 신뢰도 낮음 → LOW_CONFIDENCE / UNKNOWN', () => {
    const c = stabilizeAIDecisions([
      row('PHONE', 0.2, 0), row('PHONE', 0.25, 1), row('PHONE', 0.3, 2),
      row('PHONE', 0.2, 3), row('STUDYING', 0.2, 4),
    ]);
    expect(c.status).toBe('LOW_CONFIDENCE');
    expect(c.activity).toBe('UNKNOWN');
  });

  it('오래된 row 제외(maxAgeMinutes)', () => {
    const c = stabilizeAIDecisions([
      row('PHONE', 0.8, 0), row('PHONE', 0.8, 1), row('PHONE', 0.8, 2),
      row('STUDYING', 0.8, 20), row('STUDYING', 0.8, 30),
    ]);
    expect(c.evidence.aged_out).toBe(2);
    expect(c.decision_count).toBe(3);
    expect(c.status).toBe('STABLE');
    expect(c.activity).toBe('PHONE');
  });

  it('최신 가중 + LOW_CONFIDENCE 패널티로 동률을 깨고 STABLE PHONE', () => {
    const c = stabilizeAIDecisions([
      row('PHONE', 0.9, 0), row('STUDYING', 0.6, 1, 'LOW_CONFIDENCE'),
      row('STUDYING', 0.6, 2, 'LOW_CONFIDENCE'), row('PHONE', 0.9, 3),
    ]);
    expect(c.evidence.latest_activity).toBe('PHONE');
    expect(c.status).toBe('STABLE');
    expect(c.activity).toBe('PHONE');
  });

  it('SLEEPING STABLE 이어도 severity 는 WATCH 이하', () => {
    const c = stabilizeAIDecisions([
      row('SLEEPING', 0.7, 0), row('SLEEPING', 0.72, 1), row('SLEEPING', 0.68, 2),
      row('STUDYING', 0.6, 3), row('SLEEPING', 0.7, 4),
    ]);
    expect(c.activity).toBe('SLEEPING');
    expect(c.status).toBe('STABLE');
    expect(['INFO', 'WATCH']).toContain(c.severity);
  });

  it('ABSENT 는 보수적으로 처리(UNKNOWN/LOW_CONFIDENCE 섞이면 STABLE 아님)', () => {
    const c = stabilizeAIDecisions([
      row('ABSENT', 0.7, 0), row('UNKNOWN', 0, 1, 'LOW_CONFIDENCE'),
      row('ABSENT', 0.7, 2), row('UNKNOWN', 0, 3, 'LOW_CONFIDENCE'),
      row('UNKNOWN', 0, 4, 'LOW_CONFIDENCE'),
    ]);
    expect(['UNSTABLE', 'LOW_CONFIDENCE']).toContain(c.status);
    expect(c.activity).toBe('UNKNOWN');
  });

  it('activity_counts / evidence / source 기록', () => {
    const c = stabilizeAIDecisions([
      row('PHONE', 0.8, 0), row('PHONE', 0.8, 1), row('PHONE', 0.8, 2),
    ]);
    expect(c.evidence.total_decisions).toBe(3);
    expect(c.evidence.valid_decisions).toBe(3);
    expect(c.activity_counts.PHONE).toBe(3);
    expect(c.confidence_by_activity.PHONE).toBeGreaterThan(0);
    expect(c.source_decision_uuids).toHaveLength(3);
  });
});

describe('stabilizeAIDecisionsBySeat', () => {
  it('좌석별로 묶어 각각 안정화한다', () => {
    const rows = [
      row('PHONE', 0.8, 0, 'SUCCESS', 'Seat1'), row('PHONE', 0.8, 1, 'SUCCESS', 'Seat1'),
      row('PHONE', 0.8, 2, 'SUCCESS', 'Seat1'),
      row('STUDYING', 0.9, 0, 'SUCCESS', 'Seat2'), row('STUDYING', 0.9, 1, 'SUCCESS', 'Seat2'),
      row('STUDYING', 0.9, 2, 'SUCCESS', 'Seat2'),
    ];
    const out = stabilizeAIDecisionsBySeat(rows, ['Seat1', 'Seat2', 'Seat3']);
    expect(out.Seat1.activity).toBe('PHONE');
    expect(out.Seat2.activity).toBe('STUDYING');
    expect(out.Seat3.status).toBe('INSUFFICIENT_DATA'); // 데이터 없음
  });
});

describe('소스에 쓰기/부수효과 없음', () => {
  it('stabilizer.ts 에 .insert/.update/.delete + 도메인 토큰 없음', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/features/admin-ai-decisions/stabilizer.ts'), 'utf-8'
    ).toLowerCase();
    for (const tok of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(src.includes(tok)).toBe(false);
    }
    // 학생 도메인 식별자(weight 이름 lowConfidencePenalty 와 충돌하지 않게 구체적으로)
    for (const tok of ['penalty_record', 'penalty_points', 'attendance_record',
                       'notification', 'membership_status']) {
      expect(src.includes(tok)).toBe(false);
    }
  });
});
