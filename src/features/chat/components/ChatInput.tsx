import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { useQuickRepliesQuery } from '../hooks';
import { cn } from '@/lib/utils';

interface Props {
  onSend: (content: string) => void;
  isSending?: boolean;
  showQuickReplies?: boolean;
  onTypingChange?: (isTyping: boolean) => void;
  roomId?: string;
}

export function ChatInput({ onSend, isSending, showQuickReplies, onTypingChange }: Props) {
  const [text, setText] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: quickReplies } = useQuickRepliesQuery();
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const handleTypingState = useCallback(
    (typing: boolean) => {
      if (typing === isTypingRef.current) return;
      isTypingRef.current = typing;
      onTypingChange?.(typing);
    },
    [onTypingChange]
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (e.target.value.trim()) {
      handleTypingState(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => handleTypingState(false), 2000);
    } else {
      handleTypingState(false);
    }
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setText('');
    handleTypingState(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith('image/')) return;
    try {
      const { supabase } = await import('@/lib/supabase/client');
      const path = `chat/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('chat-images').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('chat-images').getPublicUrl(path);
      onSend(`__IMG__:${urlData.publicUrl}`);
    } catch (err) {
      console.error('이미지 업로드 실패:', err);
    }
  };

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  return (
    <div
      className={cn('border-t border-gray-200 bg-white', isDragging && 'border-brand-400 bg-brand-50')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="px-4 py-2 text-sm text-brand-500 text-center">📎 이미지를 여기에 놓으세요</div>
      )}

      {showQuickReplies && showQR && (
        <div className="border-b border-gray-100 px-3 py-2 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {(quickReplies ?? []).map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => {
                onSend(qr.content);
                setShowQR(false);
              }}
              className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:border-brand-400"
            >
              {qr.content}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        {showQuickReplies && (
          <button
            type="button"
            onClick={() => setShowQR((v) => !v)}
            className={cn(
              'flex-shrink-0 rounded-full p-1.5 text-gray-400 hover:text-brand-500',
              showQR && 'text-brand-500'
            )}
            title="빠른 답변"
          >
            ⚡
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isDragging ? '이미지를 드롭하세요' : '메시지를 입력하세요... (Shift+Enter 줄바꿈)'
          }
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white max-h-24 overflow-y-auto"
          style={{ minHeight: '38px' }}
        />
        <Button
          disabled={!text.trim() || isSending}
          onClick={handleSend}
          className="flex-shrink-0 rounded-full px-4 py-2 text-sm"
        >
          {isSending ? '...' : '전송'}
        </Button>
      </div>
    </div>
  );
}
