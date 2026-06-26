import { useState, useEffect, useRef, memo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useChatRoomQuery, useChatMessagesQuery, useSendMessageMutation } from '@/features/chat/hooks';
import { useChatRealtime } from '@/features/chat/useChatRealtime';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

interface Props {
  studentId: string;
}

function MiniChatInner({ studentId }: Props) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: roomId, isLoading: roomLoading } = useChatRoomQuery(studentId);
  const { data: messages, isLoading: msgLoading } = useChatMessagesQuery(roomId);
  const sendMutation = useSendMessageMutation(roomId);

  useChatRealtime({ roomId, currentUserId: user!.id, currentRole: 'admin' });

  const recentMessages = (messages ?? []).slice(-15);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [recentMessages.length]);

  const handleSend = () => {
    const content = text.trim();
    if (!content || !roomId || sendMutation.isPending) return;
    sendMutation.mutate({ senderId: user!.id, senderRole: 'admin', content });
    setText('');
  };

  return (
    <div className="flex flex-col border-t border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-2">
        <p className="text-xs font-semibold text-gray-500">채팅</p>
      </div>

      <div className="overflow-y-auto px-3 py-2 space-y-1.5" style={{ minHeight: 80, maxHeight: 180 }}>
        {roomLoading || msgLoading ? (
          <div className="flex justify-center py-3"><Spinner /></div>
        ) : recentMessages.length === 0 ? (
          <p className="text-center text-xs text-gray-400 py-3">채팅 내역이 없습니다</p>
        ) : (
          recentMessages.map((msg) => {
            const isAdmin = msg.sender_role === 'admin';
            return (
              <div key={msg.id} className={cn('flex', isAdmin ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed break-words',
                    isAdmin
                      ? 'bg-brand-500 text-white'
                      : 'bg-gray-100 text-gray-800'
                  )}
                >
                  {msg.content.startsWith('__IMG__:') ? (
                    <span className="text-gray-400 italic">[이미지]</span>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-1.5 border-t border-gray-100 p-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="메시지를 입력하세요..."
          disabled={!roomId}
          className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-400 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || !roomId || sendMutation.isPending}
          className="rounded-md bg-brand-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </div>
  );
}

export const MiniChat = memo(MiniChatInner);
