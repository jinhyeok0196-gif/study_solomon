import { computeMembership } from '@/features/admin-membership/logic';
import type { MyProfile } from './types';

export type StudentAccess = 'ok' | 'no-membership' | 'expired';

/**
 * 학생의 회원권 기반 앱 접근 권한을 판정한다.
 * - 'no-membership': 회원권 미설정 → 퇴원 취급. 페이지 차단, 채팅 문의만 허용.
 * - 'expired': 회원권 만료 → 페이지 차단 + "문의 후 이용 가능합니다" 팝업, 채팅 문의만 허용.
 * - 'ok': 정상 이용.
 */
export function computeStudentAccess(profile: MyProfile, today: Date): StudentAccess {
  // 회원권 종류가 설정되지 않은 학생은 퇴원으로 간주한다.
  if (!profile.membershipType) return 'no-membership';

  const { state } = computeMembership(
    {
      id: profile.id,
      name: profile.name,
      phone: profile.phone,
      membershipStatus: profile.membershipStatus,
      membershipType: profile.membershipType,
      startDate: profile.membershipStartDate,
      endDate: profile.membershipEndDate,
      autoRenew: false,
    },
    today
  );

  // computeMembership 의 'expired' 는 만료일 경과 + 퇴출(expelled) 을 포함한다.
  return state === 'expired' ? 'expired' : 'ok';
}
