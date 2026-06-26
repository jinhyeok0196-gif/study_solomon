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
  // 현재 presence 데이터 추적 (track 호출 시 최신 상태 유지)
  const currentDataRef = useRef<PresenceUser>({ userId, role, name, onlineAt: Date.now() });

  useEffect(() => {
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
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          setConnectionStatus('disconnected');
        } else {
          setConnectionStatus('connecting');
        }
      });

    channelRef.current = channel;

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [userId, role, name]);

  const isOnline = (targetUserId: string) =>
    onlineUsers.some((u) => u.userId === targetUserId);

  const getLastSeen = (targetUserId: string): number | null => {
    const u = onlineUsers.find((u) => u.userId === targetUserId);
    return u?.onlineAt ?? null;
  };

  // Presence 기반 입력 중 전송 (Broadcast보다 안정적)
  const sendTyping = useCallback(
    async (roomId: string) => {
      const channel = channelRef.current;
      if (!channel) return;
      const data: PresenceUser = { ...currentDataRef.current, isTyping: true, typingInRoom: roomId };
      currentDataRef.current = data;
      await channel.track(data);
    },
    []
  );

  const stopTyping = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    const { isTyping: _, typingInRoom: __, ...rest } = currentDataRef.current;
    const data: PresenceUser = { ...rest, isTyping: false };
    currentDataRef.current = data;
    await channel.track(data);
  }, []);

  // 특정 방에서 입력 중인 사용자 목록 (나 자신 제외)
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
