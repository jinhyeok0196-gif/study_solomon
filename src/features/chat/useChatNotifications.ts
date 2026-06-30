import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useFloatingNotify } from '@/components/FloatingNotification';
import type { ChatMessage } from './types';

interface Options {
  role: 'student' | 'admin';
  currentUserId: string;
  /** 학생: 본인 채팅방 id (구독에 필요). 관리자: 생략(전체 방 구독). */
  roomId?: string;
  /** 알림 클릭 시 이동 (해당 메시지를 받아 관리자는 그 학생 방으로 딥링크) */
  onNavigate: (msg: ChatMessage) => void;
}

/**
 * 새 문의 메시지(상대방 발신)를 실시간 구독해 플로팅 알림을 띄운다.
 * 학생: 본인 방에서 관리자가 보낸 메시지. 관리자: 모든 방에서 학생이 보낸 메시지.
 */
export function useChatNotifications({ role, currentUserId, roomId, onNavigate }: Options) {
  const notify = useFloatingNotify();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const navRef = useRef(onNavigate);
  navRef.current = onNavigate;

  useEffect(() => {
    if (!currentUserId) return;
    if (role === 'student' && !roomId) return; // 방 준비 전엔 구독 보류

    const filter = role === 'student' ? `room_id=eq.${roomId}` : undefined;
    const wantRole = role === 'student' ? 'admin' : 'student';

    const channel = supabase
      .channel(`chat-notify-${role}-${currentUserId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          if (!msg || msg.sender_id === currentUserId) return;
          if (msg.sender_role !== wantRole) return;
          if (msg.message_type === 'system') return;
          notifyRef.current({
            title: role === 'student' ? '관리자 메시지' : '새 문의 메시지',
            body: msg.content,
            onClick: () => navRef.current(msg),
            // 관리자: 자동으로 사라지지 않고, 한 학생의 여러 메시지는 최신만 유지(방 단위 dedupe)
            ...(role === 'admin'
              ? { persistent: true, dedupeKey: `chat-${msg.room_id}` }
              : {}),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, currentUserId, roomId]);
}
