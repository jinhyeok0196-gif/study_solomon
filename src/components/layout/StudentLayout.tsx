import { useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { StudentBottomNav } from './StudentBottomNav';
import { MembershipBlockScreen } from './MembershipBlockScreen';
import { FloatingNotificationProvider } from '@/components/FloatingNotification';
import { StudentChatNotifier } from '@/features/chat/components/ChatNotifier';
import { StudentNotificationNotifier } from '@/features/notifications/components/StudentNotificationNotifier';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { useMyProfileQuery } from '@/features/mypage/hooks';
import { computeStudentAccess } from '@/features/mypage/access';
import { STUDENT_PATHS } from '@/routes/paths';

export function StudentLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const profileQuery = useMyProfileQuery(user?.id ?? '');
  const [popupDismissed, setPopupDismissed] = useState(false);

  const today = useMemo(() => new Date(), []);
  const access = profileQuery.data ? computeStudentAccess(profileQuery.data, today) : 'ok';
  const restricted = access !== 'ok';
  const onChat = location.pathname === STUDENT_PATHS.chat;

  // 회원권 미설정/만료 학생은 채팅 문의 외 페이지를 차단한다.
  const showBlock = restricted && !onChat;
  // 만료 학생에게는 "문의 후 이용 가능합니다" 팝업을 1회 안내한다.
  const showExpiredPopup = access === 'expired' && !popupDismissed;

  return (
    <FloatingNotificationProvider>
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header title="솔로몬스터디카페" titleTo={STUDENT_PATHS.dashboard} />
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
          {profileQuery.isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          ) : showBlock ? (
            <MembershipBlockScreen access={access} />
          ) : (
            <Outlet />
          )}
        </main>
        <StudentBottomNav restricted={restricted} />
      </div>

      <Modal
        open={showExpiredPopup}
        onClose={() => setPopupDismissed(true)}
        title="회원권 만료 안내"
      >
        <p className="text-sm leading-relaxed text-gray-600">
          회원권이 만료되었습니다. 문의 후 이용 가능합니다.
        </p>
        <button
          onClick={() => setPopupDismissed(true)}
          className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white"
        >
          확인
        </button>
      </Modal>

      <StudentChatNotifier />
      <StudentNotificationNotifier />
    </FloatingNotificationProvider>
  );
}
