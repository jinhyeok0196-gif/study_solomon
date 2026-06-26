import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  useChatRoomQuery,
  useChatMessagesQuery,
  useChatReadsQuery,
  useSendMessageMutation,
  useMarkReadMutation,
  requestNotificationPermission,
  showBrowserNotification,
} from '@/features/chat/hooks';
import { useChatRealtime } from '@/features/chat/useChatRealtime';
import { useChatPresence } from '@/features/chat/usePresence';
import { ChatBubble } from '@/features/chat/components/ChatBubble';
import { ChatDateDivider } from '@/features/chat/components/ChatDateDivider';
import { ChatInput } from '@/features/chat/components/ChatInput';
import { TypingIndicator } from '@/features/chat/components/TypingIndicator';
import { OnlineStatusBadge } from '@/features/chat/components/OnlineStatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import type { ChatMessageLocal } from '@/features/chat/types';

function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

export default function ChatPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const studentName = user!.name;
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: roomId } = useChatRoomQuery(studentId);
  const { data: messages, isLoading } = useChatMessagesQuery(roomId);
  const { data: readSet } = useChatReadsQuery(roomId);
  const sendMutation = useSendMessageMutation(roomId);
  const markReadMutation = useMarkReadMutation(roomId);

  useChatRealtime({
    roomId,
    currentUserId: studentId,
    currentRole: 'student',
    onNewMessage: (msg) => {
      if (msg.sender_role === 'admin') {
        showBrowserNotification('관리자 메시지', msg.content);
      }
    },
  });

  const { onlineUsers, connectionStatus, sendTyping, stopTyping, getTypingUsersInRoom } =
    useChatPresence(studentId, 'student', studentName);
  const isAdminOnline = onlineUsers.some((u) => u.role === 'admin');
  const adminTypingNames = getTypingUsersInRoom(roomId).map((u) => u.name);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (roomId) {
      markReadMutation.mutate({ readerId: studentId, senderRole: 'student' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (roomId && messages?.length) {
      markReadMutation.mutate({ readerId: studentId, senderRole: 'student' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length]);

  const handleSend = (content: string) => {
    if (!roomId) return;
    void stopTyping();
    sendMutation.mutate({ senderId: studentId, senderRole: 'student', content });
  };

  const handleTypingChange = (isTyping: boolean) => {
    if (isTyping && roomId) void sendTyping(roomId);
    else void stopTyping();
  };

  const handleRetry = (msg: ChatMessageLocal) => {
    if (!roomId) return;
    sendMutation.mutate({ senderId: studentId, senderRole: 'student', content: msg.content });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="relative">
          <div className="h-9 w-9 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700">
            관
          </div>
          <div className="absolute -bottom-0.5 -right-0.5">
            <OnlineStatusBadge isOnline={isAdminOnline} size="sm" />
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">관리자</p>
          <OnlineStatusBadge isOnline={isAdminOnline} showLabel />
        </div>
        {connectionStatus !== 'connected' && (
          <span className="text-xs text-orange-500 animate-pulse">
            {connectionStatus === 'connecting' ? '연결 중...' : '연결 끊김'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 py-2">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !messages?.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
            <p className="text-3xl">💬</p>
            <p className="text-sm">관리자에게 문의해보세요</p>
          </div>
        ) : (
          <>
            {(messages as ChatMessageLocal[]).map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const showDateDivider = !prevMsg || !isSameDay(prevMsg.created_at, msg.created_at);
              const isOwn = msg.sender_id === studentId;
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
            <TypingIndicator names={adminTypingNames} className="px-3 py-1" />
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        isSending={sendMutation.isPending}
        onTypingChange={handleTypingChange}
        roomId={roomId}
      />
    </div>
  );
}
