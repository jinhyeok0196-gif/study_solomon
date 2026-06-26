import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import {
  fetchChatMessages,
  fetchChatRoomsWithMeta,
  fetchQuickReplies,
  getOrCreateChatRoom,
  markRoomMessagesRead,
  sendChatMessage,
  createQuickReply,
  deleteQuickReply,
} from './api';
import type { ChatMessage } from './types';

export function useChatRoomQuery(studentId: string) {
  return useQuery({
    queryKey: ['chat-room', studentId],
    queryFn: () => getOrCreateChatRoom(studentId),
    staleTime: Infinity,
  });
}

export function useChatMessagesQuery(roomId: string | undefined) {
  return useQuery({
    queryKey: ['chat-messages', roomId],
    queryFn: () => fetchChatMessages(roomId!),
    enabled: !!roomId,
    staleTime: 0,
  });
}

export function useChatRealtimeSubscription(roomId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`chat-room-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          qc.setQueryData<ChatMessage[]>(['chat-messages', roomId], (old) => {
            if (!old) return [payload.new as ChatMessage];
            if (old.some((m) => m.id === (payload.new as ChatMessage).id)) return old;
            return [...old, payload.new as ChatMessage];
          });
          qc.invalidateQueries({ queryKey: ['admin-chat-rooms'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, qc]);
}

export function useSendMessageMutation(roomId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      senderId,
      senderRole,
      content,
      messageType,
    }: {
      senderId: string;
      senderRole: 'student' | 'admin';
      content: string;
      messageType?: 'text' | 'system' | 'announcement';
    }) => sendChatMessage(roomId!, senderId, senderRole, content, messageType),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-chat-rooms'] });
    },
  });
}

export function useMarkReadMutation(roomId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      readerId,
      senderRole,
    }: {
      readerId: string;
      senderRole: 'student' | 'admin';
    }) => markRoomMessagesRead(roomId!, readerId, senderRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-chat-rooms'] });
      qc.invalidateQueries({ queryKey: ['student-unread-count'] });
    },
  });
}

export function useAdminChatRoomsQuery(adminId: string) {
  return useQuery({
    queryKey: ['admin-chat-rooms'],
    queryFn: () => fetchChatRoomsWithMeta(adminId),
    refetchInterval: 30000,
  });
}

export function useStudentUnreadCountQuery(roomId: string | undefined, studentId: string) {
  return useQuery({
    queryKey: ['student-unread-count', roomId],
    queryFn: async () => {
      if (!roomId) return 0;
      // 읽은 메시지 ID 가져오기
      const { data: readIds } = await supabase
        .from('message_reads')
        .select('message_id')
        .eq('reader_id', studentId);
      const readSet = new Set((readIds ?? []).map((r) => r.message_id));

      const { data: adminMsgs } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('room_id', roomId)
        .eq('sender_role', 'admin');

      return (adminMsgs ?? []).filter((m) => !readSet.has(m.id)).length;
    },
    enabled: !!roomId,
    refetchInterval: 30000,
  });
}

export function useQuickRepliesQuery() {
  return useQuery({
    queryKey: ['quick-replies'],
    queryFn: fetchQuickReplies,
    staleTime: 1000 * 60 * 10,
  });
}

export function useQuickReplyMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['quick-replies'] });
  const create = useMutation({ mutationFn: createQuickReply, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteQuickReply, onSuccess: invalidate });
  return { create, remove };
}
