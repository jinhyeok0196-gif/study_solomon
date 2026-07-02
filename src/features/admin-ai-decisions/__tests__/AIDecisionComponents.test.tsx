import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIDecisionSeatCard } from '../components/AIDecisionSeatCard';
import { AIDecisionSeatGrid } from '../components/AIDecisionSeatGrid';
import { AIDecisionLogTable } from '../components/AIDecisionLogTable';
import { AIDecisionDetailDrawer } from '../components/AIDecisionDetailDrawer';
import { AI_DISCLAIMER, type AIDecisionRow } from '../types';
import { previewRemainingSeconds } from '../previewTypes';

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

  it('UNKNOWN 이고 카메라/품질 성공이면 "카메라 연결 성공 · 판정 신호 부족" 을 구분 표시한다', () => {
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({
          activity: 'UNKNOWN', confidence: 0, status: 'LOW_CONFIDENCE',
          reasons: ['human/objects 사실이 모두 비어 판정 불가'],
          quality: { overall_quality: 1.0, vision_quality: 1.0, usable_for_rule_engine: true },
          evidence: { person_detected: false, phone_detected: false },
        })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('카메라 연결 성공 · 판정 신호 부족')).toBeInTheDocument();
  });

  it('object-only(사람 미검출 + 객체 검출) UNKNOWN 은 "자리비움 확정 아님" 을 표시한다', () => {
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({
          activity: 'UNKNOWN', confidence: 0, status: 'SUCCESS',
          reasons: ['객체 감지됨(phone) · 사람 미검출 → 자리비움 확정 보류(object-only)'],
          quality: { overall_quality: 0.6, vision_quality: 1.0, usable_for_rule_engine: true },
          evidence: { person_detected: false, phone_detected: true, phone_count: 10 },
        })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('객체 감지됨 · 사람 미검출 · 자리비움 확정 아님')).toBeInTheDocument();
    // object-only 우선 표시이므로 일반 신호부족 문구는 나오지 않는다
    expect(screen.queryByText('카메라 연결 성공 · 판정 신호 부족')).toBeNull();
  });

  // ── v0.5 미리보기 클립 ────────────────────────────────────────────────
  it('preview 데이터가 없으면 "미리보기 준비 안 됨" 을 표시한다', () => {
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(screen.getByText('미리보기 준비 안 됨')).toBeInTheDocument();
    // 원칙 문구 노출("· " 접두사 포함되므로 부분 매칭)
    expect(screen.getByText(/영상은 영구 저장되지 않음/)).toBeInTheDocument();
  });

  it('preview_clip_url 이 있으면 "최근 5초 보기" 버튼을 표시한다', () => {
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({
          preview_status: 'available',
          preview_clip_url: 'blob:local/preview-seat1',
          preview_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preview_duration_seconds: 5,
        })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '최근 5초 보기' })).toBeInTheDocument();
  });

  it('preview_status=expired 또는 만료시각 초과면 "미리보기 만료됨" 을 표시한다', () => {
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({
          preview_status: 'available',
          preview_clip_url: 'blob:local/preview-seat1',
          preview_expires_at: new Date(Date.now() - 1_000).toISOString(), // 이미 만료
        })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/만료됨/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '최근 5초 보기' })).toBeNull();
  });

  it('preview_status=error 이면 "미리보기 오류" 를 표시한다', () => {
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({ preview_status: 'error' })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('미리보기 오류')).toBeInTheDocument();
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

describe('preview 만료 UX (previewRemainingSeconds / 전이 / 남은시간)', () => {
  it('previewRemainingSeconds: 남은 초(올림) · 만료 후 0 · 없거나 파싱불가면 null', () => {
    expect(previewRemainingSeconds(row(), Date.now())).toBeNull();          // expires_at 없음
    const r = row({ preview_expires_at: new Date(1_000_000).toISOString() });
    expect(previewRemainingSeconds(r, 1_000_000 - 45_000)).toBe(45);        // 45초 남음
    expect(previewRemainingSeconds(r, 1_000_000 + 5_000)).toBe(0);          // 이미 만료 → 0
    expect(previewRemainingSeconds(row({ preview_expires_at: 'nope' }), Date.now())).toBeNull();
  });

  it('available 이면 만료까지 남은 시간을 표시한다', () => {
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({
          preview_status: 'available',
          preview_clip_url: 'blob:local/x',
          preview_expires_at: new Date(Date.now() + 45_000).toISOString(),
        })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/초 후 재생성/)).toBeInTheDocument();
  });

  it('nowMs 가 만료시각을 지나면 available → "만료됨" 으로 전이한다', () => {
    const t0 = 2_000_000;
    const r = row({
      preview_status: 'available',
      preview_clip_url: 'blob:local/x',
      preview_expires_at: new Date(t0 + 5_000).toISOString(),
    });
    const { rerender } = render(
      <AIDecisionSeatCard seatId="Seat1" row={r} nowMs={t0} onOpen={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '최근 5초 보기' })).toBeInTheDocument();
    // now 가 만료시각을 지나면(섹션의 30초 tick 이 nowMs 를 올림) 자동 전이
    rerender(<AIDecisionSeatCard seatId="Seat1" row={r} nowMs={t0 + 10_000} onOpen={vi.fn()} />);
    expect(screen.getByText(/만료됨/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '최근 5초 보기' })).toBeNull();
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
