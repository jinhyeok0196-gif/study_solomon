import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AIDecisionSeatCard } from '../components/AIDecisionSeatCard';
import type { AIDecisionRow } from '../types';

// 최소 row(미리보기 필드 없음 → bridge 값이 표시를 좌우)
function row(over: Partial<AIDecisionRow> = {}): AIDecisionRow {
  return {
    id: 'id-1', decision_uuid: 'dec-1', facts_uuid: 'f1', burst_uuid: 'b1',
    seat_id: 'Seat1', period_id: 'P0', period_name: '0교시',
    decided_at: new Date().toISOString(), activity: 'STUDYING', confidence: 0.9,
    status: 'SUCCESS', severity: 'INFO', reasons: ['책 검출'],
    evidence: {}, rule_hits: [], quality: { overall_quality: 0.8 },
    metadata: {}, created_at: new Date().toISOString(),
    ...over,
  };
}

const BRIDGE = 'http://127.0.0.1:8765';

function stubFetchOnce(impl: () => Promise<unknown>) {
  const fetchMock = vi.fn(impl as unknown as typeof fetch);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SeatPreviewButton × local bridge', () => {
  it('bridge URL 이 없으면 fetch 하지 않고 "미리보기 준비 안 됨" 을 표시한다', () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', '');
    const fetchMock = stubFetchOnce(() => Promise.resolve({}));
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(screen.getByText('미리보기 준비 안 됨')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bridge 응답이 available 면 "최근 5초 보기" 버튼을 표시한다', async () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', BRIDGE);
    stubFetchOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          seat_id: 'Seat1',
          preview_status: 'available',
          preview_clip_url: `${BRIDGE}/previews/Seat1/latest.mp4`,
          preview_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preview_duration_seconds: 5.0,
        }),
      }),
    );
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '최근 5초 보기' })).toBeInTheDocument();
  });

  it('bridge 응답이 expired 면 "미리보기 만료됨" 을 표시한다', async () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', BRIDGE);
    stubFetchOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          seat_id: 'Seat1',
          preview_status: 'expired',
          preview_clip_url: null,
          preview_expires_at: new Date(Date.now() - 1_000).toISOString(),
        }),
      }),
    );
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(await screen.findByText('미리보기 만료됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '최근 5초 보기' })).toBeNull();
  });

  it('browser_compatible=false 면 "브라우저 재생 호환 변환이 필요합니다" 를 표시한다', async () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', BRIDGE);
    stubFetchOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          seat_id: 'Seat1',
          preview_status: 'available',
          preview_clip_url: `${BRIDGE}/previews/Seat1/latest.mp4`,
          preview_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preview_duration_seconds: 5.0,
          codec: 'mp4v',
          browser_compatible: false,
          transcode_status: 'ffmpeg_missing',
          codec_warning: 'mp4v may not play correctly in browser video tag',
        }),
      }),
    );
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    // available 이라 버튼은 뜨고, 호환 경고도 함께 표시된다
    expect(await screen.findByRole('button', { name: '최근 5초 보기' })).toBeInTheDocument();
    expect(screen.getByText(/브라우저 재생 호환 변환이 필요합니다/)).toBeInTheDocument();
  });

  it('browser_compatible=true(H.264) 면 호환 경고를 표시하지 않는다', async () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', BRIDGE);
    stubFetchOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          seat_id: 'Seat1',
          preview_status: 'available',
          preview_clip_url: `${BRIDGE}/previews/Seat1/latest.mp4`,
          preview_expires_at: new Date(Date.now() + 60_000).toISOString(),
          codec: 'h264',
          browser_compatible: true,
          transcode_status: 'success',
        }),
      }),
    );
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '최근 5초 보기' })).toBeInTheDocument();
    expect(screen.queryByText(/브라우저 재생 호환 변환이 필요합니다/)).toBeNull();
  });

  it('bridge fetch 실패 시 "미리보기 오류" 를 안전하게 표시한다', async () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', BRIDGE);
    stubFetchOnce(() => Promise.reject(new Error('network down')));
    render(<AIDecisionSeatCard seatId="Seat1" row={row()} nowMs={Date.now()} onOpen={vi.fn()} />);
    expect(await screen.findByText('미리보기 오류')).toBeInTheDocument();
  });

  it('bridge 응답이 unavailable 이면 "미리보기 준비 안 됨" 을 유지하고 기존 판정 표시는 깨지지 않는다', async () => {
    vi.stubEnv('VITE_LOCAL_PREVIEW_BRIDGE_URL', BRIDGE);
    stubFetchOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ seat_id: 'Seat1', preview_status: 'unavailable', preview_clip_url: null }),
      }),
    );
    render(
      <AIDecisionSeatCard
        seatId="Seat1"
        row={row({ activity: 'PHONE', confidence: 0.8, severity: 'WARNING' })}
        nowMs={Date.now()}
        onOpen={vi.fn()}
      />,
    );
    // 기존 판정 표시 유지
    expect(screen.getByText(/휴대폰 추정/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('미리보기 준비 안 됨')).toBeInTheDocument());
  });
});
