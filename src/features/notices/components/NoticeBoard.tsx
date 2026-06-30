import { useState } from 'react';
import { useNoticesQuery } from '../hooks';
import { NOTICE_CATEGORY_LABEL, type Notice, type NoticeCategory } from '../api';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

const INITIAL_OTHERS = 3;

const CATEGORY_CLASS: Record<NoticeCategory, string> = {
  notice: 'bg-blue-50 text-blue-700',
  rule: 'bg-amber-50 text-amber-700',
};

function categoryClass(category: string) {
  return CATEGORY_CLASS[(category as NoticeCategory)] ?? CATEGORY_CLASS.notice;
}

function categoryLabel(category: string) {
  return NOTICE_CATEGORY_LABEL[(category as NoticeCategory)] ?? category;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ko-KR');
}

function NoticeItem({ notice }: { notice: Notice }) {
  return (
    <details className="group rounded-lg border border-gray-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        {notice.is_pinned && <span className="text-xs">📌</span>}
        <span
          className={cn(
            'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
            categoryClass(notice.category)
          )}
        >
          {categoryLabel(notice.category)}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-gray-800">{notice.title}</span>
        <span className="flex-shrink-0 text-[11px] text-gray-400">{fmtDate(notice.created_at)}</span>
        <span className="flex-shrink-0 text-gray-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="whitespace-pre-wrap border-t border-gray-100 px-3 py-2.5 text-sm leading-relaxed text-gray-600">
        {notice.content}
      </div>
    </details>
  );
}

export function NoticeBoard() {
  const { data: notices, isLoading } = useNoticesQuery();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return null;

  const all = notices ?? [];
  if (all.length === 0) {
    return <EmptyState title="등록된 공지가 없습니다" />;
  }

  const pinned = all.filter((n) => n.is_pinned);
  const others = all.filter((n) => !n.is_pinned);
  const visibleOthers = expanded ? others : others.slice(0, INITIAL_OTHERS);
  const items = [...pinned, ...visibleOthers];
  const hiddenCount = others.length - visibleOthers.length;

  return (
    <div className="flex flex-col gap-2">
      {items.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} />
      ))}

      {(hiddenCount > 0 || expanded) && others.length > INITIAL_OTHERS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-gray-200 bg-white py-2 text-xs font-medium text-gray-500 hover:bg-gray-50"
        >
          {expanded ? '접기' : `더보기 (${hiddenCount})`}
        </button>
      )}
    </div>
  );
}
