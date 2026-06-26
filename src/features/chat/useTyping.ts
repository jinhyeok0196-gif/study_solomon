import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface TypingUser {
  userId: string;
  name: string;
  role: 'student' | 'admin';
}

export function useChatTyping(
  roomId: string | undefined,
  currentUserId: string,
  currentUserName: string,
  currentRole: 'student' | 'admin'
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isSendingRef = useRef(false);

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`chat-typing-${roomId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { userId, name, role } = payload as TypingUser;
        if (userId === currentUserId) return;

        setTypingUsers((prev) => {
          if (prev.some((u) => u.userId === userId)) return prev;
          return [...prev, { userId, name, role }];
        });

        const existing = typingTimerRef.current.get(userId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
          typingTimerRef.current.delete(userId);
        }, 3000);
        typingTimerRef.current.set(userId, timer);
      })
      .on('broadcast', { event: 'stop_typing' }, ({ payload }) => {
        const { userId } = payload as { userId: string };
        setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
        const existing = typingTimerRef.current.get(userId);
        if (existing) {
          clearTimeout(existing);
          typingTimerRef.current.delete(userId);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      typingTimerRef.current.forEach((t) => clearTimeout(t));
      typingTimerRef.current.clear();
    };
  }, [roomId, currentUserId]);

  const sendTyping = useCallback(() => {
    if (!channelRef.current || isSendingRef.current) return;
    isSendingRef.current = true;
    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId, name: currentUserName, role: currentRole },
    });
    setTimeout(() => { isSendingRef.current = false; }, 2000);
  }, [currentUserId, currentUserName, currentRole]);

  const sendStopTyping = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'stop_typing',
      payload: { userId: currentUserId },
    });
  }, [currentUserId]);

  return { typingUsers, sendTyping, sendStopTyping };
}
