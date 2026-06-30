import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

export type Notice = Tables<'notices'>;
export type NoticeCategory = 'notice' | 'rule';

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  notice: '공지사항',
  rule: '이용수칙',
};

export interface NoticeInput {
  category: NoticeCategory;
  title: string;
  content: string;
  isPinned: boolean;
}

/** 상단 고정 우선, 최신순으로 전체 공지를 반환한다. */
export async function fetchNotices(): Promise<Notice[]> {
  const { data, error } = await supabase
    .from('notices')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createNotice(input: NoticeInput, createdBy: string): Promise<void> {
  const { error } = await supabase.from('notices').insert({
    category: input.category,
    title: input.title,
    content: input.content,
    is_pinned: input.isPinned,
    created_by: createdBy,
  });
  if (error) throw error;
}

export async function updateNotice(id: string, input: NoticeInput): Promise<void> {
  const { error } = await supabase
    .from('notices')
    .update({
      category: input.category,
      title: input.title,
      content: input.content,
      is_pinned: input.isPinned,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteNotice(id: string): Promise<void> {
  const { error } = await supabase.from('notices').delete().eq('id', id);
  if (error) throw error;
}
