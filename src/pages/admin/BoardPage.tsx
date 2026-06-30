import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import {
  BOARD_ADMIN_KEY,
  useBoardPostsAdminQuery,
  useDeleteBoardPostMutation,
  useReplyBoardPostMutation,
} from '@/features/board/hooks';
import { BOARD_CATEGORY_LABEL, type AdminBoardPost, type BoardCategory } from '@/features/board/api';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

const CATEGORY_CLASS: Record<BoardCategory, string> = {
  complaint: 'bg-red-50 text-red-600',
  suggestion: 'bg-blue-50 text-blue-600',
};

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('ko-KR');
}

function PostCard({ post }: { post: AdminBoardPost }) {
  const { user } = useAuth();
  const replyMutation = useReplyBoardPostMutation();
  const deleteMutation = useDeleteBoardPostMutation();
  const [reply, setReply] = useState(post.admin_reply ?? '');

  const realName = post.author?.name ?? '(알 수 없음)';

  const handleReply = async () => {
    if (!reply.trim()) return;
    await replyMutation.mutateAsync({ id: post.id, reply: reply.trim(), adminId: user!.id });
  };

  const handleDelete = async () => {
    if (!window.confirm('이 글을 삭제하시겠습니까?')) return;
    await deleteMutation.mutateAsync(post.id);
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium',
            CATEGORY_CLASS[post.category]
          )}
        >
          {BOARD_CATEGORY_LABEL[post.category]}
        </span>
        <span className="text-sm font-medium text-gray-900">{realName}</span>
        {post.is_anonymous && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">익명 작성</span>
        )}
        <span className="ml-auto text-[11px] text-gray-400">{fmtDateTime(post.created_at)}</span>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          삭제
        </button>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{post.content}</p>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="mb-1 text-xs font-semibold text-gray-600">
          관리자 답변{post.admin_reply_at ? ` · ${fmtDateTime(post.admin_reply_at)}` : ''}
        </p>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="답변을 입력하세요"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handleReply}
            disabled={replyMutation.isPending || !reply.trim()}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {replyMutation.isPending ? '저장 중...' : post.admin_reply ? '답변 수정' : '답변 등록'}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function BoardPage() {
  const { data: posts } = useBoardPostsAdminQuery();
  useRealtimeTableSync('board_posts', [BOARD_ADMIN_KEY]);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-gray-900">불만·건의 게시판</h2>

      {!posts || posts.length === 0 ? (
        <EmptyState title="등록된 글이 없습니다" />
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
