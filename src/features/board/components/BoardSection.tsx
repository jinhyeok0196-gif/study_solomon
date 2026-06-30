import { useState } from 'react';
import { useBoardPostsQuery, useCreateBoardPostMutation, BOARD_KEY } from '../hooks';
import { BOARD_CATEGORY_LABEL, type BoardCategory, type PublicBoardPost } from '../api';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

const INITIAL_VISIBLE = 5;

const CATEGORY_CLASS: Record<BoardCategory, string> = {
  complaint: 'bg-red-50 text-red-600',
  suggestion: 'bg-blue-50 text-blue-600',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ko-KR');
}

function PostItem({ post }: { post: PublicBoardPost }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
            CATEGORY_CLASS[post.category]
          )}
        >
          {BOARD_CATEGORY_LABEL[post.category]}
        </span>
        <span className="text-xs font-medium text-gray-700">{post.author_name ?? '익명'}</span>
        <span className="ml-auto text-[11px] text-gray-400">{fmtDate(post.created_at)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{post.content}</p>
      {post.admin_reply && (
        <div className="mt-2 rounded-md bg-brand-50 px-3 py-2">
          <p className="text-[11px] font-semibold text-brand-700">관리자 답변</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{post.admin_reply}</p>
        </div>
      )}
    </div>
  );
}

export function BoardSection() {
  const { data: posts } = useBoardPostsQuery();
  const createMutation = useCreateBoardPostMutation();
  useRealtimeTableSync('board_posts', [BOARD_KEY]);

  const [category, setCategory] = useState<BoardCategory>('complaint');
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    await createMutation.mutateAsync({ category, content: content.trim(), isAnonymous });
    setContent('');
    setIsAnonymous(false);
  };

  const all = posts ?? [];
  const visible = expanded ? all : all.slice(0, INITIAL_VISIBLE);

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex gap-1 rounded-md bg-gray-100 p-1">
          {(['complaint', 'suggestion'] as BoardCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'flex-1 rounded py-1 text-xs font-medium transition-colors',
                category === c ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              )}
            >
              {BOARD_CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="불만이나 건의사항을 남겨주세요"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            익명으로 작성
          </label>
          <button
            type="submit"
            disabled={createMutation.isPending || !content.trim()}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {createMutation.isPending ? '등록 중...' : '등록'}
          </button>
        </div>
      </form>

      {all.length === 0 ? (
        <EmptyState title="아직 등록된 글이 없습니다" />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((post) => (
            <PostItem key={post.id} post={post} />
          ))}
          {all.length > INITIAL_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md border border-gray-200 bg-white py-2 text-xs font-medium text-gray-500 hover:bg-gray-50"
            >
              {expanded ? '접기' : `더보기 (${all.length - INITIAL_VISIBLE})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
