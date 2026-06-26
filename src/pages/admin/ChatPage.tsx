import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  useAdminChatRoomsQuery,
  useChatMessagesQuery,
  useChatReadsQuery,
  useSendMessageMutation,
  useMarkReadMutation,
  requestNotificationPermission,
  showBrowserNotification,
} from '@/features/chat/hooks';
import { useChatRealtime } from '@/features/chat/useChatRealtime';
import { useChatPresence } from '@/features/chat/usePresence';
import { useChatTyping } from '@/features/chat/useTyping';
import { StudentStatusPanel } from '@/features/chat/components/StudentStatusPanel';
import { ChatBubble } from '@/features/chat/components/ChatBubble';
import { ChatDateDivider } from '@/features/chat/components/ChatDateDivider';
import { ChatInput } from '@/features/chat/components/ChatInput';
import { TypingIndicator } from '@/features/chat/components/TypingIndicator';
import { OnlineStatusBadge } from '@/features/chat/components/OnlineStatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { ChatRoomWithMeta, ChatMessageLocal } from '@/features/chat/types';

function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function StudentListItem({
  room,
  isActive,
  isOnline,
  onClick,
}: {
  room: ChatRoomWithMeta;
  isActive: boolean;
  isOnline: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-2.5 text-left rounded-lg transition-colors',
        isActive ? 'bg-brand-50' : 'hover:bg-gray-50'
      )}
    >
      <div className="relative flex-shrink-0">
        <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
          {room.student_name[0]}
        </div>
        <div className="absolute -bottom-0.5 -right-0.5">
          <OnlineStatusBadge isOnline={isOnline} size="sm" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-gray-900 truncate">{room.student_name}</span>
          {room.last_message_at && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">
              {fmtDate(room.last_message_at)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-xs text-gray-500 truncate">
            {room.last_sender_role === 'admin' ? '나: ' : ''}
            {room.last_message ?? '대화 없음'}
          </span>
          {room.unread_count > 0 && (
            <span className="flex-shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white min-w-[18px] text-center">
              {room.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function AdminChatPage() {
  const { user } = useAuth();
  const adminId = user!.id;
  const adminName = user!.name;
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: rooms, isLoading: roomsLoading } = useAdminChatRoomsQuery(adminId);
  const { data: messages, isLoading: msgsLoading } = useChatMessagesQuery(
    selectedRoomId ?? undefined
  );
  const { data: readSet } = useChatReadsQuery(selectedRoomId ?? undefined);
  const sendMutation = useSendMessageMutation(selectedRoomId ?? undefined);
  const markReadMutation = useMarkReadMutation(selectedRoomId ?? undefined);

  useChatRealtime({
    roomId: selectedRoomId ?? undefined,
    currentUserId: adminId,
    currentRole: 'admin',
    onNewMessage: (msg) => {
      if (msg.sender_role === 'student') {
        showBrowserNotification(selectedStudentName, msg.content);
      }
    },
  });

  const { onlineUsers, connectionStatus } = useChatPresence(adminId, 'admin', adminName);
  const isStudentOnline = (sid: string) =>
    onlineUsers.some((u) => u.userId === sid && u.role === 'student');

  const { typingUsers, sendTyping, sendStopTyping } = useChatTyping(
    selectedRoomId ?? undefined,
    adminId,
    adminName,
    'admin'
  );
  const studentTypingNames = typingUsers.filter((u) => u.role === 'student').map((u) => u.name);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (selectedRoomId) {
      markReadMutation.mutate({ readerId: adminId, senderRole: 'admin' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (selectedRoomId && messages?.length) {
      markReadMutation.mutate({ readerId: adminId, senderRole: 'admin' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length]);

  const handleSelectRoom = (room: ChatRoomWithMeta) => {
    setSelectedRoomId(room.room_id);
    setSelectedStudentId(room.student_id);
    setSelectedStudentName(room.student_name);
  };

  const handleSend = (content: string) => {
    if (!selectedRoomId) return;
    sendStopTyping();
    sendMutation.mutate({ senderId: adminId, senderRole: 'admin', content });
  };

  const handleTypingChange = (isTyping: boolean) => {
    if (isTyping) sendTyping();
    else sendStopTyping();
  };

  const handleRetry = (msg: ChatMessageLocal) => {
    if (!selectedRoomId) return;
    sendMutation.mutate({ senderId: adminId, senderRole: 'admin', content: msg.content });
  };

  const totalUnread = (rooms ?? []).reduce((sum, r) => sum + r.unread_count, 0);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* 좌측: 학생 목록 */}
      <div className="w-56 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white">
        <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">학생 문의</span>
            {totalUnread > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {totalUnread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connectionStatus === 'connected' ? 'bg-green-400' : 'bg-orange-400 animate-pulse'
              )}
            />
            <span className="text-[9px] text-gray-400">
              {connectionStatus === 'connected' ? 'Live' : '연결 중'}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {roomsLoading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : !rooms?.length ? (
            <p className="text-xs text-gray-400 text-center py-4">채팅 기록이 없습니다</p>
          ) : (
            rooms.map((room) => (
              <StudentListItem
                key={room.room_id}
                room={room}
                isActive={selectedRoomId === room.room_id}
                isOnline={isStudentOnline(room.student_id)}
                onClick={() => handleSelectRoom(room)}
              />
            ))
          )}
        </div>
      </div>

      {/* 중앙: 채팅창 */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {!selectedRoomId ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <p className="text-4xl">💬</p>
            <p className="text-sm">학생을 선택하여 대화를 시작하세요</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
              <div className="relative">
                <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                  {selectedStudentName[0]}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5">
                  <OnlineStatusBadge
                    isOnline={isStudentOnline(selectedStudentId ?? '')}
                    size="sm"
                  />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{selectedStudentName}</p>
                <OnlineStatusBadge
                  isOnline={isStudentOnline(selectedStudentId ?? '')}
                  showLabel
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {msgsLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : !messages?.length ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                  <p className="text-sm">아직 대화가 없습니다. 먼저 인사해보세요.</p>
                </div>
              ) : (
                <>
                  {(messages as ChatMessageLocal[]).map((msg, idx) => {
                    const prevMsg = messages[idx - 1];
                    const showDateDivider =
                      !prevMsg || !isSameDay(prevMsg.created_at, msg.created_at);
                    const isOwn = msg.sender_role === 'admin';
                    const isRead = isOwn ? (readSet?.has(msg.id) ?? false) : false;
                    return (
                      <div key={msg.id}>
                        {showDateDivider && <ChatDateDivider date={msg.created_at} />}
                        <ChatBubble
                          message={msg}
                          isOwn={isOwn}
                          isRead={isRead}
                          onRetry={msg._isFailed ? () => handleRetry(msg) : undefined}
                        />
                      </div>
                    );
                  })}
                  <TypingIndicator names={studentTypingNames} />
                  <div ref={bottomRef} />
                </>
              )}
            </div>

            <ChatInput
              onSend={handleSend}
              isSending={sendMutation.isPending}
              showQuickReplies
              onTypingChange={handleTypingChange}
              roomId={selectedRoomId}
            />
          </>
        )}
      </div>

      {/* 우측: 학생 상태 패널 */}
      {selectedStudentId && (
        <StudentStatusPanel studentId={selectedStudentId} roomId={selectedRoomId} />
      )}
    </div>
  );
}
