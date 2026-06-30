import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIDecisionSeatCard } from '../components/AIDecisionSeatCard';
import { AIDecisionSeatGrid } from '../components/AIDecisionSeatGrid';
import { AIDecisionLogTable } from '../components/AIDecisionLogTable';
import { AIDecisionDetailDrawer } from '../components/AIDecisionDetailDrawer';
import { AI_DISCLAIMER, type AIDecisionRow } from '../types';

function row(over: Partial<AIDecisionRow> = {}): AIDecisionRow {
  return {
    id: 'id-1', decision_uuid: 'dec-1', facts_uuid: 'f1', burst_uuid: 'b1',
    seat_id: 'Seat1', period_id: 'P0', period_name: '0교시',
    decided_at: new Date().toISOString(), activity: 'STUDYING', confidence: 0.92,
    status: 'SUCCESS', severity: 'INFO',
    reasons: ['책 또는 학습 도구가 검출됨', '손 특징이 함께 검출됨'],
    evidence: { overall_quality: 0.8667, phone_detected: false },
    rule_hits: [{ rule: 'studying_rule', fired: true, confidence: 1.0 }],
    quality: { overall_quality: 0.8667, usable_for_rule_engine: true },
    metadata: { engine: 'rule_engine' },
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe('AIDecisionSeatCard', () => {
  it('activity/confidence/AI추정 을 표시한다', () => {
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(screen.getByText(/공부 추정/)).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText(/AI 추정 · 자동 변경 아님/)).toBeInTheDocument();
  });

  it('PHONE 판정은 휴대폰 추정으로 표시한다', () => {
    render(<AIDecisionSeatCard seatId="Seat2" row={row({ activity: 'PHONE', confidence: 0.8 })} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(screen.getByText(/휴대폰 추정/)).toBeInTheDocument();
  });

  it('판정이 없으면 "AI 판정 없음" 을 표시한다', () => {
    render(<AIDecisionSeatCard seatId="Seat3" row={null} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(screen.getByText('AI 판정 없음')).toBeInTheDocument();
  });
});

describe('AIDecisionSeatGrid', () => {
  it('Seat1~Seat8 카드를 렌더하고 데이터 없는 좌석은 "AI 판정 없음"', () => {
    render(<AIDecisionSeatGrid rows={[row({ seat_id: 'Seat1' })]} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(screen.getByText(/공부 추정/)).toBeInTheDocument();
    // 나머지 7석은 판정 없음
    expect(screen.getAllByText('AI 판정 없음')).toHaveLength(7);
  });
});

describe('AIDecisionLogTable', () => {
  it('행을 렌더하고 수정/삭제/상태반영 버튼이 없다', () => {
    render(
      <AIDecisionLogTable
        rows={[row({ activity: 'PHONE', confidence: 0.8, severity: 'WARNING' })]}
        filters={{ limit: 50 }}
        onFiltersChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull();
    expect(screen.queryByRole('button', { name: /상태 반영/ })).toBeNull();
    // 읽기 전용: 상세 버튼만 존재
    expect(screen.getByRole('button', { name: '상세' })).toBeInTheDocument();
  });
});

describe('AIDecisionDetailDrawer', () => {
  it('reasons/evidence/rule_hits/quality 와 "자동 변경 아님" 안내를 표시한다', () => {
    render(<AIDecisionDetailDrawer row={row()} onClose={vi.fn()} />);
    expect(screen.getByText('책 또는 학습 도구가 검출됨')).toBeInTheDocument();
    expect(screen.getByText('evidence')).toBeInTheDocument();
    expect(screen.getByText('rule_hits')).toBeInTheDocument();
    expect(screen.getByText('quality')).toBeInTheDocument();
    expect(screen.getByText(/자동 변경되지 않습니다/)).toBeInTheDocument();
  });

  it('row 가 null 이면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<AIDecisionDetailDrawer row={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('안내 문구 / 부수효과 없음', () => {
  it('AI_DISCLAIMER 는 자동 변경 아님을 명시한다', () => {
    expect(AI_DISCLAIMER).toMatch(/자동 변경되지 않습니다/);
  });

  it('컴포넌트 소스에 학생 상태 변경/벌점/출결/알림 코드가 없다', () => {
    const dir = join(process.cwd(), 'src/features/admin-ai-decisions/components');
    const files = [
      'AIDecisionSeatCard.tsx', 'AIDecisionSeatGrid.tsx', 'AIDecisionLogTable.tsx',
      'AIDecisionDetailDrawer.tsx', 'AIDecisionSection.tsx',
    ];
    const forbidden = ['penalty', 'attendance', 'notification', 'membership', '.insert(', '.update(', '.delete('];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8').toLowerCase();
      for (const tok of forbidden) {
        expect(src.includes(tok), `${f} 에 '${tok}'`).toBe(false);
      }
    }
  });
});
