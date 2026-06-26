import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import type { ChatMessage } from './types';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseChatRealtimeOptions {
  roomId: string | undefined;
  currentUserId: string;
  currentRole: 'student' | 'admin';
  onNewMessage?: (msg: ChatMessage) => void;
}

export function useChatRealtime({
  roomId,
  currentUserId,
  onNewMessage,
}: UseChatRealtimeOptions) {
  const qc = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setupChannel = useCallback(() => {
    if (!roomId) return;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // topic을 매번 고유하게 만든다. 같은 이름을 재사용하면 removeChannel 이 끝나기 전
    // 재시도가 겹칠 때 이미 subscribe 된 채널에 .on() 을 호출해
    // "cannot add postgres_changes callbacks ... after subscribe()" 예외로 앱이 크래시한다.
    const channel = supabase
      .channel(`chat-realtime-${roomId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          qc.setQueryData<ChatMessage[]>(['chat-messages', roomId], (old) => {
            if (!old) return [newMsg];
            if (old.some((m) => m.id === newMsg.id)) return old;
            // 같은 내용의 pending 메시지를 실제 메시지로 교체
            const withoutPending = old.filter(
              (m) =>
                !(
                  m.id.startsWith('pending-') &&
                  m.sender_id === newMsg.sender_id &&
                  m.content === newMsg.content
                )
            );
            return [...withoutPending, newMsg];
          });
          qc.invalidateQueries({ queryKey: ['admin-chat-rooms'] });
          if (newMsg.sender_id !== currentUserId) {
            onNewMessageRef.current?.(newMsg);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          qc.setQueryData<ChatMessage[]>(['chat-messages', roomId], (old) =>
            (old ?? []).filter((m) => m.id !== deletedId)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reads' },
        () => {
          qc.invalidateQueries({ queryKey: ['chat-reads', roomId] });
          qc.invalidateQueries({ queryKey: ['admin-chat-rooms'] });
          qc.invalidateQueries({ queryKey: ['student-unread-count'] });
        }
      )
      .subscribe((status) => {
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          retryTimerRef.current = setTimeout(() => setupChannel(), 4000);
        }
      });

    channelRef.current = channel;
  }, [roomId, currentUserId, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setupChannel();
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [setupChannel]);
}
