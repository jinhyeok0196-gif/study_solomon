export type MessageSenderRole = 'student' | 'admin' | 'system';
export type MessageType = 'text' | 'system' | 'announcement';

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_role: MessageSenderRole;
  content: string;
  message_type: MessageType;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatRoom {
  id: string;
  student_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatRoomWithMeta {
  room_id: string;
  student_id: string;
  student_name: string;
  student_phone: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_role: MessageSenderRole | null;
  unread_count: number;
}

export interface QuickReply {
  id: string;
  content: string;
  sort_order: number;
}

// Local-only extension for optimistic/failed states
export interface ChatMessageLocal extends ChatMessage {
  _isPending?: boolean;
  _isFailed?: boolean;
}
