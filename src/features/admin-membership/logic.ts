import { differenceInCalendarDays } from 'date-fns';

export interface MembershipRow {
  id: string;
  name: string;
  phone: string;
  membershipStatus: string; // 'active' | 'paused' | 'expelled'
  membershipType: string | null;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
}

export type MembershipState = 'active' | 'expiring' | 'today' | 'expired' | 'paused';

export interface MembershipComputed extends MembershipRow {
  state: MembershipState;
  remainingDays: number | null;
}

function parseLocal(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

/** 이용권 상태와 남은 일수를 계산한다. */
export function computeMembership(row: MembershipRow, today: Date): MembershipComputed {
  const remainingDays =
    row.endDate != null ? differenceInCalendarDays(parseLocal(row.endDate), today) : null;

  let state: MembershipState;
  if (row.membershipStatus === 'paused') {
    state = 'paused';
  } else if (row.membershipStatus === 'expelled') {
    state = 'expired';
  } else if (remainingDays == null) {
    state = 'active';
  } else if (remainingDays < 0) {
    state = 'expired';
  } else if (remainingDays === 0) {
    state = 'today';
  } else if (remainingDays <= 7) {
    state = 'expiring';
  } else {
    state = 'active';
  }

  return { ...row, state, remainingDays };
}

export function remainingLabel(remainingDays: number | null): string {
  if (remainingDays == null) return '-';
  if (remainingDays < 0) return '만료';
  if (remainingDays === 0) return '오늘 만료';
  return `${remainingDays}일 남음`;
}

export const STATE_BADGE: Record<MembershipState, { label: string; dot: string; className: string }> = {
  active: { label: '이용중', dot: '🟢', className: 'bg-green-100 text-green-700' },
  expiring: { label: '7일 이내 만료', dot: '🟡', className: 'bg-yellow-100 text-yellow-700' },
  today: { label: '오늘 만료', dot: '🟠', className: 'bg-orange-100 text-orange-700' },
  expired: { label: '만료', dot: '🔴', className: 'bg-red-100 text-red-700' },
  paused: { label: '일시정지', dot: '⚪', className: 'bg-gray-100 text-gray-600' },
};

/** 7일 이내/오늘/만료 행 배경색 */
export function rowBgClass(state: MembershipState): string {
  if (state === 'expiring') return 'bg-yellow-50';
  if (state === 'today') return 'bg-orange-50';
  if (state === 'expired') return 'bg-red-50';
  return '';
}

export interface MembershipKpis {
  activeTotal: number; // 전체 이용 학생 (active+expiring+today)
  todayExpire: number;
  within7: number;
  expired: number;
  autoRenew: number;
}

export function computeKpis(rows: MembershipComputed[]): MembershipKpis {
  let activeTotal = 0;
  let todayExpire = 0;
  let within7 = 0;
  let expired = 0;
  let autoRenew = 0;
  for (const r of rows) {
    if (r.state === 'active' || r.state === 'expiring' || r.state === 'today') activeTotal++;
    if (r.state === 'today') todayExpire++;
    if (r.state === 'expiring') within7++;
    if (r.state === 'expired') expired++;
    if (r.autoRenew) autoRenew++;
  }
  return { activeTotal, todayExpire, within7, expired, autoRenew };
}
