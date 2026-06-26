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
    staleTime: Infinity, // Realtime이 캐시 관리
    gcTime: 1000 * 60 * 5,
  });
}

export function useChatReadsQuery(roomId: string | undefined) {
  return useQuery({
    queryKey: ['chat-reads', roomId],
    queryFn: async () => {
      if (!roomId) return new Set<string>();
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('room_id', roomId);
      if (!msgs?.length) return new Set<string>();
      const { data: reads } = await supabase
        .from('message_reads')
        .select('message_id')
        .in('message_id', msgs.map((m) => m.id));
      return new Set((reads ?? []).map((r) => r.message_id));
    },
    enabled: !!roomId,
    staleTime: 0,
  });
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
    onMutate: async ({ senderId, senderRole, content, messageType }) => {
      if (!roomId) return;
      await qc.cancelQueries({ queryKey: ['chat-messages', roomId] });
      const previous = qc.getQueryData<ChatMessage[]>(['chat-messages', roomId]);
      const optimistic = {
        id: `pending-${Date.now()}`,
        room_id: roomId,
        sender_id: senderId,
        sender_role: senderRole,
        content,
        message_type: messageType ?? ('text' as const),
        metadata: null,
        created_at: new Date().toISOString(),
        _isPending: true,
      };
      qc.setQueryData<ChatMessage[]>(['chat-messages', roomId], (old) => [
        ...(old ?? []),
        optimistic as unknown as ChatMessage,
      ]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!roomId || !context?.previous) return;
      qc.setQueryData(['chat-messages', roomId], context.previous);
    },
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
      qc.invalidateQueries({ queryKey: ['chat-reads', roomId] });
      qc.invalidateQueries({ queryKey: ['admin-chat-rooms'] });
      qc.invalidateQueries({ queryKey: ['student-unread-count'] });
    },
  });
}

export function useAdminChatRoomsQuery(adminId: string) {
  return useQuery({
    queryKey: ['admin-chat-rooms'],
    queryFn: () => fetchChatRoomsWithMeta(adminId),
    staleTime: 0,
    // polling 제거: Realtime INSERT 이벤트가 invalidate 트리거
  });
}

export function useStudentUnreadCountQuery(roomId: string | undefined, studentId: string) {
  return useQuery({
    queryKey: ['student-unread-count', roomId],
    queryFn: async () => {
      if (!roomId) return 0;
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
    staleTime: 0,
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

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

export function showBrowserNotification(title: string, body: string) {
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  new Notification(title, { body, icon: '/favicon.ico' });
}
