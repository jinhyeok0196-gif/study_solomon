import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PresenceUser {
  userId: string;
  role: 'student' | 'admin';
  name: string;
  onlineAt: number;
  isTyping?: boolean;
  typingInRoom?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useChatPresence(userId: string, role: 'student' | 'admin', name: string) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentDataRef = useRef<PresenceUser>({ userId, role, name, onlineAt: Date.now() });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 최신 setupChannel을 setTimeout 클로저에서 참조하기 위한 ref
  const setupChannelRef = useRef<() => void>(() => undefined);

  const setupChannel = useCallback(() => {
    if (!userId) return;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (channelRef.current) {
      void channelRef.current.untrack();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel('chat-global-presence', {
        config: { presence: { key: userId } },
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceUser>();
        const users: PresenceUser[] = [];
        for (const presences of Object.values(state)) {
          for (const p of presences) {
            users.push(p as unknown as PresenceUser);
          }
        }
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          await channel.track(currentDataRef.current);
        } else if (status === 'TIMED_OUT') {
          // 타임아웃: 서버가 join 요청에 응답하지 않음 → JWT 없거나 네트워크 지연
          setConnectionStatus('connecting');
          retryTimerRef.current = setTimeout(() => setupChannelRef.current(), 3000);
        } else if (status === 'CHANNEL_ERROR') {
          // 채널 에러: join 거부됨 → RLS/권한 문제 또는 서버 오류
          setConnectionStatus('disconnected');
          retryTimerRef.current = setTimeout(() => setupChannelRef.current(), 5000);
        } else if (status === 'CLOSED') {
          setConnectionStatus('disconnected');
          retryTimerRef.current = setTimeout(() => setupChannelRef.current(), 5000);
        } else {
          setConnectionStatus('connecting');
        }
      });

    channelRef.current = channel;
  }, [userId, role, name]);

  // 항상 최신 setupChannel을 ref에 저장
  setupChannelRef.current = setupChannel;

  useEffect(() => {
    // userId/role/name 의존값이 준비된 뒤에만 채널 생성
    if (!userId) return;
    currentDataRef.current = { userId, role, name, onlineAt: Date.now() };
    setupChannel();

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (channelRef.current) {
        void channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [setupChannel, userId, role, name]);

  const isOnline = (targetUserId: string) =>
    onlineUsers.some((u) => u.userId === targetUserId);

  const getLastSeen = (targetUserId: string): number | null => {
    const u = onlineUsers.find((u) => u.userId === targetUserId);
    return u?.onlineAt ?? null;
  };

  const sendTyping = useCallback(async (roomId: string) => {
    const channel = channelRef.current;
    if (!channel) return;
    const data: PresenceUser = { ...currentDataRef.current, isTyping: true, typingInRoom: roomId };
    currentDataRef.current = data;
    await channel.track(data);
  }, []);

  const stopTyping = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    const { isTyping: _, typingInRoom: __, ...rest } = currentDataRef.current;
    const data: PresenceUser = { ...rest, isTyping: false };
    currentDataRef.current = data;
    await channel.track(data);
  }, []);

  const getTypingUsersInRoom = useCallback(
    (roomId: string | null | undefined): PresenceUser[] => {
      if (!roomId) return [];
      return onlineUsers.filter(
        (u) => u.isTyping && u.typingInRoom === roomId && u.userId !== userId
      );
    },
    [onlineUsers, userId]
  );

  return { onlineUsers, isOnline, getLastSeen, connectionStatus, sendTyping, stopTyping, getTypingUsersInRoom };
}
