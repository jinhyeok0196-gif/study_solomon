import { supabase } from '@/lib/supabase/client';

export type BoardCategory = 'complaint' | 'suggestion';

export const BOARD_CATEGORY_LABEL: Record<BoardCategory, string> = {
  complaint: '불만',
  suggestion: '건의',
};

/** 공개용: 작성자 실명 역추적 불가. author_name(null=익명)만 노출. */
export interface PublicBoardPost {
  id: string;
  category: BoardCategory;
  content: string;
  is_anonymous: boolean;
  author_name: string | null;
  admin_reply: string | null;
  admin_reply_at: string | null;
  created_at: string;
}

const PUBLIC_COLUMNS =
  'id, category, content, is_anonymous, author_name, admin_reply, admin_reply_at, created_at';

export async function fetchBoardPosts(): Promise<PublicBoardPost[]> {
  const { data, error } = await supabase
    .from('board_posts')
    .select(PUBLIC_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PublicBoardPost[];
}

export async function createBoardPost(
  category: BoardCategory,
  content: string,
  isAnonymous: boolean
): Promise<void> {
  // created_by / author_name 은 DB 트리거(set_board_post_author)가 강제로 채운다.
  const { error } = await supabase
    .from('board_posts')
    .insert({ category, content, is_anonymous: isAnonymous });
  if (error) throw error;
}

/** 관리자용: 작성자 실명 포함(익명 글도 확인 가능). */
export interface AdminBoardPost extends PublicBoardPost {
  created_by: string | null;
  author: { name: string } | null;
}

export async function fetchBoardPostsAdmin(): Promise<AdminBoardPost[]> {
  const { data, error } = await supabase
    .from('board_posts')
    .select(`${PUBLIC_COLUMNS}, created_by, author:users!board_posts_created_by_fkey(name)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AdminBoardPost[];
}

export async function replyBoardPost(id: string, reply: string, adminId: string): Promise<void> {
  const { error } = await supabase
    .from('board_posts')
    .update({
      admin_reply: reply,
      admin_reply_by: adminId,
      admin_reply_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteBoardPost(id: string): Promise<void> {
  const { error } = await supabase.from('board_posts').delete().eq('id', id);
  if (error) throw error;
}
