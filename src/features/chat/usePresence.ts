import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PresenceUser {
  userId: string;
  role: 'student' | 'admin';
  name: string;
  onlineAt: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useChatPresence(userId: string, role: 'student' | 'admin', name: string) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const channelRef = useRef<RealtimeChannel | null>(null);

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
          await channel.track({ userId, role, name, onlineAt: Date.now() });
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

  return { onlineUsers, isOnline, getLastSeen, connectionStatus };
}
