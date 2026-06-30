import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stabilizeAIDecisions } from '../stabilizer';
import type { AIDecisionRow, Activity, DecisionStatus } from '../types';
import { StabilizedCandidateBadge } from '../components/StabilizedCandidateBadge';
import { StabilizedCandidatePanel } from '../components/StabilizedCandidatePanel';
import { StabilizedCandidateDetail } from '../components/StabilizedCandidateDetail';

const BASE = Date.parse('2026-06-30T09:30:00Z');

function row(activity: Activity, conf: number, min: number,
             status: DecisionStatus = 'SUCCESS', seat = 'Seat1'): AIDecisionRow {
  return {
    id: `id-${activity}-${min}`, decision_uuid: `dec-${activity}-${min}`,
    facts_uuid: 'f', burst_uuid: 'b', seat_id: seat, period_id: 'P0', period_name: '0교시',
    decided_at: new Date(BASE - min * 60_000).toISOString(),
    activity, confidence: conf, status, severity: 'INFO',
    reasons: [], evidence: {}, rule_hits: [], quality: {}, metadata: {},
    created_at: new Date(BASE - min * 60_000).toISOString(),
  };
}

const stablePhone = stabilizeAIDecisions([
  row('PHONE', 0.8, 0), row('PHONE', 0.78, 1), row('STUDYING', 0.6, 2),
  row('PHONE', 0.82, 3), row('STUDYING', 0.6, 4),
]);
const conflicted = stabilizeAIDecisions([
  row('PHONE', 0.75, 0), row('STUDYING', 0.76, 1), row('PHONE', 0.74, 2), row('STUDYING', 0.77, 3),
]);

describe('StabilizedCandidateBadge', () => {
  it('안정화된 추정 + 활동/신뢰/안정 을 표시하고 "확정" 은 쓰지 않는다', () => {
    render(<StabilizedCandidateBadge candidate={stablePhone} />);
    expect(screen.getByText('안정화된 추정')).toBeInTheDocument();
    expect(screen.getByText(/휴대폰 추정/)).toBeInTheDocument();
    expect(screen.getByText('안정')).toBeInTheDocument();
    expect(screen.queryByText(/확정/)).toBeNull();
  });

  it('CONFLICTED 는 "판정 보류 / 관리자 확인 필요"', () => {
    render(<StabilizedCandidateBadge candidate={conflicted} />);
    expect(screen.getByText('판정 보류')).toBeInTheDocument();
    expect(screen.getByText('관리자 확인 필요')).toBeInTheDocument();
  });
});

describe('StabilizedCandidatePanel', () => {
  it('좌석별 후보를 표시하고 데이터 없는 좌석은 안내', () => {
    render(
      <StabilizedCandidatePanel
        candidatesBySeat={{ Seat1: stablePhone }}
        seatIds={['Seat1', 'Seat2']}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByText('Seat1')).toBeInTheDocument();
    expect(screen.getByText(/휴대폰 추정/)).toBeInTheDocument();
    expect(screen.getByText('안정화 데이터 없음')).toBeInTheDocument();
  });
});

describe('StabilizedCandidateDetail', () => {
  it('자동 변경 아님 문구 + reasons/evidence 를 표시', () => {
    render(<StabilizedCandidateDetail candidate={stablePhone} onClose={vi.fn()} />);
    expect(screen.getByText(/자동 변경되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText('activity_counts')).toBeInTheDocument();
    expect(screen.getByText('evidence')).toBeInTheDocument();
    expect(screen.getByText('source_decision_uuids')).toBeInTheDocument();
    // 금지 문구 없음
    expect(screen.queryByText(/확정/)).toBeNull();
    expect(screen.queryByText(/출결 반영/)).toBeNull();
    expect(screen.queryByText(/벌점 부여/)).toBeNull();
  });

  it('null 이면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<StabilizedCandidateDetail candidate={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('부수효과/금지요소 없음', () => {
  it('컴포넌트 소스에 상태변경/출결/벌점/알림 버튼·쓰기 코드가 없다', () => {
    const dir = join(process.cwd(), 'src/features/admin-ai-decisions/components');
    const files = [
      'StabilizedCandidateBadge.tsx', 'StabilizedCandidatePanel.tsx',
      'StabilizedCandidateDetail.tsx', 'AIDecisionSeatCard.tsx', 'AIDecisionSection.tsx',
    ];
    const forbidden = ['penalty', 'attendance', 'notification', 'membership',
                       '.insert(', '.update(', '.delete(', '출결 반영', '벌점 부여', '상태 변경 완료'];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8').toLowerCase();
      for (const tok of forbidden) {
        expect(src.includes(tok.toLowerCase()), `${f} 에 '${tok}'`).toBe(false);
      }
    }
  });
});
