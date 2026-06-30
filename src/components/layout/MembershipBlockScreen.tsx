import { Link } from 'react-router-dom';
import { STUDENT_PATHS } from '@/routes/paths';
import type { StudentAccess } from '@/features/mypage/access';

/** 회원권 미설정/만료 학생에게 보여주는 이용 제한 화면 (채팅 문의만 안내). */
export function MembershipBlockScreen({ access }: { access: StudentAccess }) {
  const expired = access === 'expired';
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
      <div className="text-5xl">{expired ? '⏳' : '🔒'}</div>
      <h2 className="text-lg font-bold text-gray-900">
        {expired ? '회원권이 만료되었습니다' : '이용 가능한 회원권이 없습니다'}
      </h2>
      <p className="whitespace-pre-line text-sm leading-relaxed text-gray-500">
        {expired
          ? '회원권이 만료되어 이용이 제한됩니다.\n문의 후 이용 가능합니다.'
          : '등록된 회원권이 없어 이용이 제한됩니다.\n채팅으로 문의해 주세요.'}
      </p>
      <Link
        to={STUDENT_PATHS.chat}
        className="mt-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-95"
      >
        💬 문의하기
      </Link>
    </div>
  );
}
