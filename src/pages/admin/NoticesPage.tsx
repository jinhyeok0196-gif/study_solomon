import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import {
  NOTICES_KEY,
  useCreateNoticeMutation,
  useDeleteNoticeMutation,
  useNoticesQuery,
  useUpdateNoticeMutation,
} from '@/features/notices/hooks';
import { NOTICE_CATEGORY_LABEL, type Notice, type NoticeCategory } from '@/features/notices/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';

const CATEGORIES: NoticeCategory[] = ['notice', 'rule'];

const emptyForm = {
  category: 'notice' as NoticeCategory,
  title: '',
  content: '',
  isPinned: false,
};

export default function NoticesPage() {
  const { user } = useAuth();
  const { data: notices } = useNoticesQuery();
  const createMutation = useCreateNoticeMutation();
  const updateMutation = useUpdateNoticeMutation();
  const deleteMutation = useDeleteNoticeMutation();

  useRealtimeTableSync('notices', [NOTICES_KEY]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    const input = {
      category: form.category,
      title: form.title.trim(),
      content: form.content.trim(),
      isPinned: form.isPinned,
    };
    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, input });
    } else {
      await createMutation.mutateAsync({ input, createdBy: user!.id });
    }
    resetForm();
  };

  const handleEdit = (notice: Notice) => {
    setEditingId(notice.id);
    setForm({
      category: (notice.category as NoticeCategory) ?? 'notice',
      title: notice.title,
      content: notice.content,
      isPinned: notice.is_pinned,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 공지를 삭제하시겠습니까?')) return;
    if (editingId === id) resetForm();
    await deleteMutation.mutateAsync(id);
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-gray-900">공지사항 · 이용수칙</h2>

      <Card>
        <p className="mb-3 text-sm font-semibold text-gray-700">
          {editingId ? '공지 수정' : '새 공지 작성'}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="구분" htmlFor="category">
              <select
                id="category"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as NoticeCategory }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {NOTICE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="제목" htmlFor="title">
              <input
                id="title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="제목을 입력하세요"
              />
            </FormField>
          </div>

          <FormField label="내용" htmlFor="content">
            <textarea
              id="content"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={5}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="내용을 입력하세요"
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isPinned}
              onChange={(e) => setForm((f) => ({ ...f, isPinned: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300"
            />
            상단 고정 (홈 최상단에 항상 노출)
          </label>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '저장 중...' : editingId ? '수정 완료' : '등록'}
            </Button>
            {editingId && (
              <Button type="button" variant="secondary" onClick={resetForm}>
                취소
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">등록된 공지</h3>
        {!notices || notices.length === 0 ? (
          <EmptyState title="등록된 공지가 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {notices.map((notice) => (
              <li
                key={notice.id}
                className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {notice.is_pinned && <span className="text-xs">📌</span>}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {NOTICE_CATEGORY_LABEL[(notice.category as NoticeCategory)] ?? notice.category}
                    </span>
                    <span className="truncate text-sm font-medium text-gray-900">{notice.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-gray-500">
                    {notice.content}
                  </p>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {new Date(notice.created_at).toLocaleString('ko-KR')}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => handleEdit(notice)}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(notice.id)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
