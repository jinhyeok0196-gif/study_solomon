// =========================================================================
// v0.5 미리보기 클립 — 타입 / 상태 파생 / 표시 문구
// =========================================================================
// ⚠️ 실시간 스트리밍(WebRTC/HLS)이 아니다. 로컬에서 임시 생성된 5초 클립을
//    "관리자 확인용"으로만 재생한다. 영상 바이너리는 DB에 저장하지 않으며,
//    실제 재생은 로컬 노트북에서만 가능하다(Cloudflare 배포 화면에서는 제한).
// ⚠️ AI 판정은 보조 지표이며 학생 상태/출결/벌점을 자동 변경하지 않는다.
// =========================================================================

import type { AIDecisionRow } from './types';

/** 화면 표시용 파생 상태(원시 preview_status + 만료시각 + url 을 종합). */
export type PreviewDisplayState =
  | 'preview_available'
  | 'preview_loading'
  | 'preview_expired'
  | 'preview_unavailable'
  | 'preview_error';

/** 미리보기 기본 길이(초). */
export const PREVIEW_DURATION_SECONDS = 5;

/** 로컬 bridge preview 재조회 주기(ms). 반복 루프(1분)보다 촘촘히 상태를 반영. */
export const PREVIEW_REFETCH_INTERVAL_MS = 30_000;

/** 버튼/뱃지 문구. */
export const PREVIEW_STATE_LABEL: Record<PreviewDisplayState, string> = {
  preview_available: '최근 5초 보기',
  preview_loading: '미리보기 생성 중…',
  preview_expired: '만료됨 · 곧 재생성',
  preview_unavailable: '미리보기 준비 안 됨',
  preview_error: '미리보기 오류',
};

/** 브라우저 재생 호환(H.264) 변환이 필요할 때 관리자에게 보여줄 문구. */
export const PREVIEW_CODEC_WARNING = '브라우저 재생 호환 변환이 필요합니다';

/** 카드에 항상 노출하는 원칙 문구(개인정보/자동변경 없음). */
export const PREVIEW_DISCLAIMERS: readonly string[] = [
  '관리자 확인용 미리보기',
  '영상은 영구 저장되지 않음',
  'AI 판정은 보조 지표 · 자동 상태 변경 없음',
];

/** 만료 여부(파생 상태 계산 및 테스트용). */
export function isPreviewExpired(row: AIDecisionRow, nowMs: number): boolean {
  if (!row.preview_expires_at) return false;
  const t = Date.parse(row.preview_expires_at);
  return Number.isFinite(t) && nowMs > t;
}

/**
 * 만료까지 남은 시간(초, 올림). 만료시각이 없거나 파싱 불가면 null.
 * 이미 만료됐으면 0(음수 없음). 관리자에게 "n초 후 재생성" 힌트를 주는 용도.
 */
export function previewRemainingSeconds(row: AIDecisionRow, nowMs: number): number | null {
  if (!row.preview_expires_at) return null;
  const t = Date.parse(row.preview_expires_at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

/**
 * 원시 preview_status + 만료시각 + clip_url 을 종합해 표시 상태를 정한다.
 * 우선순위: error > loading > expired(명시 또는 시간초과) > available(url 있음) > unavailable.
 */
export function derivePreviewState(row: AIDecisionRow, nowMs: number): PreviewDisplayState {
  const s = row.preview_status;
  if (s === 'error') return 'preview_error';
  if (s === 'loading') return 'preview_loading';
  if (s === 'expired' || isPreviewExpired(row, nowMs)) return 'preview_expired';
  if (row.preview_clip_url && (s === 'available' || s === undefined)) return 'preview_available';
  return 'preview_unavailable';
}
