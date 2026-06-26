import { supabase } from '@/lib/supabase/client';
import type { ChatMessage, ChatRoomWithMeta, QuickReply } from './types';

export async function getOrCreateChatRoom(studentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_chat_room', { p_student_id: studentId });
  if (error) throw error;
  return data as string;
}

export async function fetchChatMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function sendChatMessage(
  roomId: string,
  senderId: string,
  senderRole: 'student' | 'admin',
  content: string,
  messageType: 'text' | 'system' | 'announcement' = 'text'
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      room_id: roomId,
      sender_id: senderId,
      sender_role: senderRole,
      content,
      message_type: messageType,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from('chat_rooms').update({ updated_at: new Date().toISOString() }).eq('id', roomId);
  return data as ChatMessage;
}

export async function markRoomMessagesRead(
  roomId: string,
  readerId: string,
  senderRole: 'student' | 'admin'
): Promise<void> {
  const otherRole = senderRole === 'student' ? 'admin' : 'student';
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id')
    .eq('room_id', roomId)
    .eq('sender_role', otherRole);
  if (!messages?.length) return;
  const reads = messages.map((m) => ({ message_id: m.id, reader_id: readerId }));
  await supabase.from('message_reads').upsert(reads, { onConflict: 'message_id,reader_id', ignoreDuplicates: true });
}

export async function fetchChatRoomsWithMeta(adminId: string): Promise<ChatRoomWithMeta[]> {
  const { data: rooms, error } = await supabase
    .from('chat_rooms')
    .select('id, student_id, updated_at, users!chat_rooms_student_id_fkey(name, phone)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  if (!rooms?.length) return [];

  const roomIds = rooms.map((r) => r.id);

  const { data: lastMsgs } = await supabase
    .from('chat_messages')
    .select('room_id, content, sender_role, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false });

  // 읽은 메시지 ID 가져오기
  const { data: readIds } = await supabase
    .from('message_reads')
    .select('message_id')
    .eq('reader_id', adminId);
  const readSet = new Set((readIds ?? []).map((r) => r.message_id));

  // 학생이 보낸 전체 메시지 중 읽지 않은 것 클라이언트에서 필터
  const { data: studentMsgs } = await supabase
    .from('chat_messages')
    .select('id, room_id')
    .in('room_id', roomIds)
    .eq('sender_role', 'student');
  const unreadMsgs = (studentMsgs ?? []).filter((m) => !readSet.has(m.id));

  type LastMsg = { room_id: string; content: string; sender_role: string; created_at: string };
  const lastMsgByRoom = new Map<string, LastMsg>();
  for (const msg of lastMsgs ?? []) {
    if (!lastMsgByRoom.has(msg.room_id)) lastMsgByRoom.set(msg.room_id, msg);
  }

  const unreadCountByRoom = new Map<string, number>();
  for (const msg of unreadMsgs) {
    unreadCountByRoom.set(msg.room_id, (unreadCountByRoom.get(msg.room_id) ?? 0) + 1);
  }

  return rooms.map((room) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const student = (room as any).users as { name: string; phone: string | null } | null;
    const last = lastMsgByRoom.get(room.id);
    return {
      room_id: room.id,
      student_id: room.student_id,
      student_name: student?.name ?? '(알수없음)',
      student_phone: student?.phone ?? null,
      last_message: last?.content ?? null,
      last_message_at: last?.created_at ?? null,
      last_sender_role: (last?.sender_role ?? null) as ChatRoomWithMeta['last_sender_role'],
      unread_count: unreadCountByRoom.get(room.id) ?? 0,
    };
  });
}

export async function fetchQuickReplies(): Promise<QuickReply[]> {
  const { data, error } = await supabase.from('quick_replies').select('*').order('sort_order');
  if (error) throw error;
  return (data ?? []) as QuickReply[];
}

export async function createQuickReply(content: string): Promise<void> {
  const { error } = await supabase.from('quick_replies').insert({ content, sort_order: 99 });
  if (error) throw error;
}

export async function deleteQuickReply(id: string): Promise<void> {
  const { error } = await supabase.from('quick_replies').delete().eq('id', id);
  if (error) throw error;
}
