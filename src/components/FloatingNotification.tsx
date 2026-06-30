import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface NotifyInput {
  title: string;
  body: string;
  onClick?: () => void;
  /** 같은 키의 기존 알림을 최신 내용으로 교체 (예: 한 학생의 여러 메시지 → 최신만) */
  dedupeKey?: string;
  /** true면 자동으로 사라지지 않음 (관리자가 직접 닫아야 함) */
  persistent?: boolean;
}

interface FloatingNote extends NotifyInput {
  id: string;
}

interface FloatingCtxValue {
  notify: (note: NotifyInput) => void;
}

const FloatingCtx = createContext<FloatingCtxValue | null>(null);

export function useFloatingNotify() {
  const ctx = useContext(FloatingCtx);
  if (!ctx) throw new Error('useFloatingNotify must be used within FloatingNotificationProvider');
  return ctx.notify;
}

const DURATION_MS = 10000; // 10초 후 자동 사라짐

export function FloatingNotificationProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<FloatingNote[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback((note: NotifyInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setNotes((prev) => {
      // 같은 dedupeKey 의 기존 알림은 제거하고 최신 것으로 교체
      const base = note.dedupeKey ? prev.filter((n) => n.dedupeKey !== note.dedupeKey) : prev;
      return [...base, { ...note, id }];
    });
    if (!note.persistent) {
      setTimeout(() => {
        setNotes((prev) => prev.filter((n) => n.id !== id));
      }, DURATION_MS);
    }
  }, []);

  return (
    <FloatingCtx.Provider value={{ notify }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-sm flex-col gap-2 overflow-y-auto">
        {notes.map((n) => (
          <div
            key={n.id}
            className="pointer-events-auto flex animate-[fadeIn_0.2s_ease-out] items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
          >
            <span className="text-xl leading-none">💬</span>
            <button
              type="button"
              onClick={() => {
                n.onClick?.();
                dismiss(n.id);
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="text-sm font-semibold text-gray-900">{n.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{n.body}</p>
            </button>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </FloatingCtx.Provider>
  );
}
