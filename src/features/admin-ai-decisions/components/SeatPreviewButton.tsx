import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AIDecisionRow } from '../types';
import {
  derivePreviewState,
  previewRemainingSeconds,
  PREVIEW_STATE_LABEL,
  PREVIEW_DISCLAIMERS,
  PREVIEW_DURATION_SECONDS,
  PREVIEW_CODEC_WARNING,
  PREVIEW_REFETCH_INTERVAL_MS,
  type PreviewDisplayState,
} from '../previewTypes';
import { getPreviewBridgeBaseUrl, fetchSeatPreview, type BridgePreviewFields } from '../previewBridge';

interface Props {
  row: AIDecisionRow;
  nowMs: number;
  seatId: string;
}

/**
 * 로컬 bridge(VITE_LOCAL_PREVIEW_BRIDGE_URL)에서 좌석 preview 필드를 가져온다.
 * - bridge URL 미설정 → { fields: null, errored: false } (기존 row 기반 표시 유지)
 * - fetch 실패 → errored=true (호출부에서 preview_error 표시)
 */
function useBridgePreview(seatId: string): { fields: BridgePreviewFields | null; errored: boolean } {
  const base = getPreviewBridgeBaseUrl();
  const [fields, setFields] = useState<BridgePreviewFields | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!base) {
      setFields(null);
      setErrored(false);
      return;
    }
    let alive = true;
    let ctrl: AbortController | null = null;

    // 30초 주기로 재조회 → 반복 루프가 새 클립을 만들면 available/expired 상태가 갱신된다.
    const load = () => {
      ctrl?.abort();                 // 직전 요청이 아직 진행 중이면 취소(중복 방지)
      ctrl = new AbortController();
      fetchSeatPreview(base, seatId, ctrl.signal)
        .then((f) => {
          if (alive) {
            setFields(f);
            setErrored(false);
          }
        })
        .catch((err) => {
          // 새 요청을 위해 abort 한 경우는 오류가 아니다.
          if (alive && (err as { name?: string } | undefined)?.name !== 'AbortError') {
            setFields(null);
            setErrored(true);
          }
        });
    };

    load();                          // 마운트 즉시 1회
    const id = setInterval(load, PREVIEW_REFETCH_INTERVAL_MS);
    return () => {                   // 언마운트 시 타이머/진행 중 요청 정리(누수 방지)
      alive = false;
      clearInterval(id);
      ctrl?.abort();
    };
  }, [base, seatId]);

  return { fields, errored };
}

// 상태별 뱃지 색(재생 불가 상태 표시용)
const STATE_BADGE_CLASS: Record<PreviewDisplayState, string> = {
  preview_available: 'bg-brand-50 text-brand-600',
  preview_loading: 'bg-sky-50 text-sky-700',
  preview_expired: 'bg-gray-100 text-gray-500',
  preview_unavailable: 'bg-gray-100 text-gray-400',
  preview_error: 'bg-red-50 text-red-600',
};

/**
 * 최근 5초 미리보기 영역(관리자 확인용).
 * - preview_available: "최근 5초 보기" 버튼 → 클릭 시 인라인 <video> 토글
 * - 그 외: 상태 뱃지("미리보기 준비 안 됨" / "만료됨" / "미리보기 오류" 등)
 * - 항상 원칙 문구(영구 저장 안 함 / 자동 변경 없음)를 노출한다.
 *
 * ⚠️ 실제 재생은 로컬 노트북에서만 가능(로컬 임시 클립). 영상은 DB에 저장하지 않는다.
 */
export function SeatPreviewButton({ row, nowMs, seatId }: Props) {
  const [open, setOpen] = useState(false);
  const { fields: bridgeFields, errored: bridgeErrored } = useBridgePreview(seatId);

  // bridge 값이 row 의 preview_* 를 보완(override). 실패 시 error 로 표시.
  const effectiveRow: AIDecisionRow = bridgeErrored
    ? { ...row, preview_status: 'error' }
    : bridgeFields
      ? { ...row, ...bridgeFields }
      : row;

  const state = derivePreviewState(effectiveRow, nowMs);
  const label = PREVIEW_STATE_LABEL[state];
  const canPlay = state === 'preview_available' && Boolean(effectiveRow.preview_clip_url);
  // 재생 가능할 때 만료까지 남은 시간(초) 힌트. 만료되면 라벨이 "만료됨 · 곧 재생성" 으로 전이.
  const remaining = previewRemainingSeconds(effectiveRow, nowMs);
  const showRemaining = canPlay && remaining !== null;
  // 브라우저 재생 호환 변환 필요(H.264 아님)일 때만 표시(명시적 false 만).
  const needsTranscode = effectiveRow.preview_browser_compatible === false;

  return (
    <div className="mt-2 border-t border-gray-200/70 pt-2" data-testid="seat-preview">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
          최근 {effectiveRow.preview_duration_seconds ?? PREVIEW_DURATION_SECONDS}초 미리보기
          {showRemaining && (
            <span className="ml-1 font-normal normal-case text-gray-400">
              · ~{remaining}초 후 재생성
            </span>
          )}
        </span>
        {canPlay ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-600 hover:bg-brand-100"
          >
            {open ? '닫기' : label}
          </button>
        ) : (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATE_BADGE_CLASS[state])}>
            {label}
          </span>
        )}
      </div>

      {/* 브라우저 재생 호환 경고(mp4v 등, H.264 변환 필요) */}
      {needsTranscode && (
        <p className="mt-1 text-center text-[9px] leading-tight text-amber-700">
          ⚠ {PREVIEW_CODEC_WARNING}
        </p>
      )}

      {/* 인라인 재생(로컬 전용). preload=none 으로 자동 다운로드 방지. */}
      {canPlay && open && (
        <video
          data-testid="seat-preview-video"
          src={effectiveRow.preview_clip_url}
          controls
          preload="none"
          playsInline
          className="mt-1 w-full max-h-40 rounded bg-black/80"
        />
      )}

      {/* 원칙 문구(항상 표시) */}
      <ul className="mt-1 space-y-0.5">
        {PREVIEW_DISCLAIMERS.map((d) => (
          <li key={d} className="text-[9px] leading-tight text-gray-400">
            · {d}
          </li>
        ))}
      </ul>
    </div>
  );
}
