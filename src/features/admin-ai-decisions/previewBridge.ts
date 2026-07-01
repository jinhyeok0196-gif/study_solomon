// =========================================================================
// v0.6-pre 로컬 preview bridge 클라이언트
// =========================================================================
// ⚠️ 로컬 노트북 전용. VITE_LOCAL_PREVIEW_BRIDGE_URL 이 설정된 경우에만 동작한다.
//    설정이 없으면(대부분의 배포/Cloudflare 환경) 미리보기는 "준비 안 됨" 상태를 유지한다.
//    영상은 DB에 저장하지 않으며, 실제 재생은 로컬에서만 가능하다.
// =========================================================================

import type { AIDecisionRow, PreviewStatus } from './types';

/** bridge 가 채워주는 preview 필드(ai_rule_decisions row 의 preview_* 를 보완). */
export type BridgePreviewFields = Pick<
  AIDecisionRow,
  | 'preview_status'
  | 'preview_clip_url'
  | 'preview_generated_at'
  | 'preview_expires_at'
  | 'preview_duration_seconds'
  | 'preview_codec'
  | 'preview_browser_compatible'
  | 'preview_transcode_status'
  | 'preview_codec_warning'
>;

/** 환경변수에서 bridge 베이스 URL. 없으면 null(→ 로컬 미리보기 비활성). */
export function getPreviewBridgeBaseUrl(): string | null {
  const raw = import.meta.env.VITE_LOCAL_PREVIEW_BRIDGE_URL;
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, '');
}

/**
 * 로컬 bridge 에서 좌석 preview 필드를 가져온다.
 * null 값은 제외해 `Partial<AIDecisionRow>` 로 안전하게 병합 가능한 형태로 반환한다.
 * 실패 시 예외를 던진다(호출부에서 preview_error 로 처리).
 */
export async function fetchSeatPreview(
  baseUrl: string,
  seatId: string,
  signal?: AbortSignal,
): Promise<BridgePreviewFields> {
  const res = await fetch(`${baseUrl}/api/previews/${encodeURIComponent(seatId)}/latest`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`preview bridge ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;

  const out: BridgePreviewFields = {};
  if (typeof raw.preview_status === 'string') out.preview_status = raw.preview_status as PreviewStatus;
  if (typeof raw.preview_clip_url === 'string') out.preview_clip_url = raw.preview_clip_url;
  if (typeof raw.preview_generated_at === 'string') out.preview_generated_at = raw.preview_generated_at;
  if (typeof raw.preview_expires_at === 'string') out.preview_expires_at = raw.preview_expires_at;
  if (typeof raw.preview_duration_seconds === 'number') {
    out.preview_duration_seconds = raw.preview_duration_seconds;
  }
  // 코덱/브라우저 호환(bridge 는 prefix 없이 codec/browser_compatible/... 로 반환)
  if (typeof raw.codec === 'string') out.preview_codec = raw.codec;
  if (typeof raw.browser_compatible === 'boolean') {
    out.preview_browser_compatible = raw.browser_compatible;
  }
  if (typeof raw.transcode_status === 'string') out.preview_transcode_status = raw.transcode_status;
  if (typeof raw.codec_warning === 'string') out.preview_codec_warning = raw.codec_warning;
  return out;
}
