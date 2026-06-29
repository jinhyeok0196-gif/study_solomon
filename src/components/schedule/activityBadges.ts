import { withRo } from '@/lib/korean';

export interface ActivityLogInput {
  startedAt: string;
  endedAt: string | null;
  reason: string | null;
}

export interface ActivityBadge {
  kind: 'outing' | 'nap';
  label: string; // 완성된 표시 문자열 (예: "외출(화장실로 15분)")
  ongoing: boolean;
}

const KIND_LABEL: Record<ActivityBadge['kind'], string> = {
  outing: '외출',
  nap: '파워냅',
};

/** 한 교시 구간 [slotStartMs, slotEndMs]와 겹치는 로그를 뱃지로 변환. 겹치지 않으면 null. */
function toBadge(
  kind: ActivityBadge['kind'],
  log: ActivityLogInput,
  slotStartMs: number,
  slotEndMs: number,
  nowMs: number
): ActivityBadge | null {
  const s = new Date(log.startedAt).getTime();
  const e = log.endedAt ? new Date(log.endedAt).getTime() : nowMs; // 진행 중이면 현재까지
  if (!Number.isFinite(s)) return null;
  const overlapMs = Math.min(e, slotEndMs) - Math.max(s, slotStartMs);
  if (overlapMs <= 0) return null;

  const minutes = Math.max(1, Math.round(overlapMs / 60000)); // 교시와 겹친 분
  const ongoing = log.endedAt == null;
  const duration = ongoing ? `${minutes}분·진행중` : `${minutes}분`;
  const label = log.reason
    ? `${KIND_LABEL[kind]}(${withRo(log.reason)} ${duration})`
    : `${KIND_LABEL[kind]}(${duration})`;
  return { kind, label, ongoing };
}

/** 교시 구간과 겹치는 외출/파워냅을 뱃지 목록으로. 분 = 교시와 겹친 시간(진행 중이면 현재까지). */
export function periodActivityBadges(
  slotStartMs: number,
  slotEndMs: number,
  outings: ActivityLogInput[],
  naps: ActivityLogInput[],
  nowMs: number
): ActivityBadge[] {
  const badges: ActivityBadge[] = [];
  for (const o of outings) {
    const b = toBadge('outing', o, slotStartMs, slotEndMs, nowMs);
    if (b) badges.push(b);
  }
  for (const n of naps) {
    const b = toBadge('nap', n, slotStartMs, slotEndMs, nowMs);
    if (b) badges.push(b);
  }
  return badges;
}
