import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useChatRoomQuery } from '@/features/chat/hooks';
import { useChatNotifications } from '@/features/chat/useChatNotifications';
import { STUDENT_PATHS, ADMIN_PATHS } from '@/routes/paths';

function StudentNotifierInner({ studentId }: { studentId: string }) {
  const navigate = useNavigate();
  const { data: roomId } = useChatRoomQuery(studentId);
  useChatNotifications({
    role: 'student',
    currentUserId: studentId,
    roomId: roomId ?? undefined,
    onNavigate: () => navigate(STUDENT_PATHS.chat),
  });
  return null;
}


/** 학생 페이지 전역: 관리자가 보낸 문의 답변을 플로팅 알림으로 표시. */
export function StudentChatNotifier() {
  const { user } = useAuth();
  if (!user) return null;
  return <StudentNotifierInner studentId={user.id} />;
}

function AdminNotifierInner({ adminId }: { adminId: string }) {
  const navigate = useNavigate();
  useChatNotifications({
    role: 'admin',
    currentUserId: adminId,
    // 클릭 시 그 학생의 대화방이 바로 열리도록 room 쿼리로 딥링크
    onNavigate: (msg) => navigate(`${ADMIN_PATHS.chat}?room=${msg.room_id}`),
  });
  return null;
}

/** 관리자 페이지 전역: 학생이 보낸 문의를 플로팅 알림으로 표시. */
export function AdminChatNotifier() {
  const { user } = useAuth();
  if (!user) return null;
  return <AdminNotifierInner adminId={user.id} />;
}
