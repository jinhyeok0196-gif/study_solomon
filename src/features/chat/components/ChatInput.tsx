import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useQuickRepliesQuery } from '../hooks';
import { cn } from '@/lib/utils';

interface Props {
  onSend: (content: string) => void;
  isSending?: boolean;
  showQuickReplies?: boolean;
}

export function ChatInput({ onSend, isSending, showQuickReplies }: Props) {
  const [text, setText] = useState('');
  const [showQR, setShowQR] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: quickReplies } = useQuickRepliesQuery();

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setText('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickReply = (content: string) => {
    onSend(content);
    setShowQR(false);
  };

  return (
    <div className="border-t border-gray-200 bg-white">
      {showQuickReplies && showQR && (
        <div className="border-b border-gray-100 px-3 py-2 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {(quickReplies ?? []).map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => handleQuickReply(qr.content)}
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요..."
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white max-h-24 overflow-y-auto"
          style={{ minHeight: '38px' }}
        />
        <Button
          disabled={!text.trim() || isSending}
          onClick={handleSend}
          className="flex-shrink-0 rounded-full px-4 py-2 text-sm"
        >
          전송
        </Button>
      </div>
    </div>
  );
}
