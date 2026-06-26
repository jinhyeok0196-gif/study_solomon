import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  useChatRoomQuery,
  useChatMessagesQuery,
  useChatRealtimeSubscription,
  useSendMessageMutation,
  useMarkReadMutation,
} from '@/features/chat/hooks';
import { ChatBubble } from '@/features/chat/components/ChatBubble';
import { ChatDateDivider } from '@/features/chat/components/ChatDateDivider';
import { ChatInput } from '@/features/chat/components/ChatInput';
import { Spinner } from '@/components/ui/Spinner';

function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

export default function ChatPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: roomId } = useChatRoomQuery(studentId);
  const { data: messages, isLoading } = useChatMessagesQuery(roomId);
  const sendMutation = useSendMessageMutation(roomId);
  const markReadMutation = useMarkReadMutation(roomId);

  useChatRealtimeSubscription(roomId);

  // 방 열면 admin 메시지 읽음 처리
  useEffect(() => {
    if (roomId) {
      markReadMutation.mutate({ readerId: studentId, senderRole: 'student' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const handleSend = (content: string) => {
    if (!roomId) return;
    sendMutation.mutate({ senderId: studentId, senderRole: 'student', content });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="h-9 w-9 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700">
          관
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">관리자</p>
          <p className="text-xs text-gray-400">솔로몬스터디카페</p>
        </div>
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
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const showDateDivider = !prevMsg || !isSameDay(prevMsg.created_at, msg.created_at);
              const isOwn = msg.sender_id === studentId;
              return (
                <div key={msg.id}>
                  {showDateDivider && <ChatDateDivider date={msg.created_at} />}
                  <ChatBubble message={msg} isOwn={isOwn} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <ChatInput onSend={handleSend} isSending={sendMutation.isPending} />
    </div>
  );
}
