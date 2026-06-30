import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useFloatingNotify } from '@/components/FloatingNotification';
import { fetchUnreadStudentNotifications, markNotificationRead } from '@/features/notifications/api';
import { STUDENT_PATHS } from '@/routes/paths';

const keyOf = (studentId: string) => ['student-notifications', studentId];
const RECENT_MS = 2 * 24 * 60 * 60 * 1000; // 최근 2일치만 팝업
const MAX_POPUPS = 5;

function Inner({ studentId }: { studentId: string }) {
  const notify = useFloatingNotify();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const shownRef = useRef<Set<string>>(new Set());

  const { data: unread } = useQuery({
    queryKey: keyOf(studentId),
    queryFn: () => fetchUnreadStudentNotifications(studentId),
    // 실시간이 놓쳐도(구독 전 발생/네트워크) 주기적으로 미읽음을 잡아 팝업
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });

  // 본인 대상 알림(승인/반려 등)을 플로팅 팝업으로 표시하고 읽음 처리한다.
  useEffect(() => {
    if (!unread?.length) return;
    const now = Date.now();
    let shownCount = 0;
    // 오래된 순으로 처리해 최신이 맨 아래(가장 눈에 띔)에 쌓이도록
    for (const n of [...unread].reverse()) {
      if (shownRef.current.has(n.id)) continue;
      shownRef.current.add(n.id);
      const fresh = now - new Date(n.created_at).getTime() < RECENT_MS;
      if (fresh && shownCount < MAX_POPUPS) {
        shownCount++;
        notify({
          title: n.title,
          body: n.message,
          persistent: true,
          dedupeKey: `notif-${n.id}`,
          onClick: () => navigate(STUDENT_PATHS.mypage),
        });
        markNotificationRead(n.id).catch(() => {});
      }
    }
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  // 실시간: 새 알림이 들어오면 미읽음 목록 갱신 → 위 effect가 팝업 표시
  useEffect(() => {
    const channel = supabase
      .channel(`student-notif-${studentId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${studentId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: keyOf(studentId) });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId, qc]);

  return null;
}

/** 학생 전역: 본인에게 온 알림(시간표 수정 반려/승인 등)을 플로팅 팝업으로 표시. */
export function StudentNotificationNotifier() {
  const { user } = useAuth();
  if (!user) return null;
  return <Inner studentId={user.id} />;
}
