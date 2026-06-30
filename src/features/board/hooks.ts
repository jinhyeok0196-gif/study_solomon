import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBoardPost,
  deleteBoardPost,
  fetchBoardPosts,
  fetchBoardPostsAdmin,
  replyBoardPost,
  type BoardCategory,
} from './api';

export const BOARD_KEY = ['board-posts'];
export const BOARD_ADMIN_KEY = ['board-posts-admin'];

export function useBoardPostsQuery() {
  return useQuery({ queryKey: BOARD_KEY, queryFn: fetchBoardPosts });
}

export function useBoardPostsAdminQuery() {
  return useQuery({ queryKey: BOARD_ADMIN_KEY, queryFn: fetchBoardPostsAdmin });
}

export function useCreateBoardPostMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      category,
      content,
      isAnonymous,
    }: {
      category: BoardCategory;
      content: string;
      isAnonymous: boolean;
    }) => createBoardPost(category, content, isAnonymous),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOARD_KEY });
      qc.invalidateQueries({ queryKey: BOARD_ADMIN_KEY });
    },
  });
}

export function useReplyBoardPostMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reply, adminId }: { id: string; reply: string; adminId: string }) =>
      replyBoardPost(id, reply, adminId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOARD_KEY });
      qc.invalidateQueries({ queryKey: BOARD_ADMIN_KEY });
    },
  });
}

export function useDeleteBoardPostMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBoardPost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOARD_KEY });
      qc.invalidateQueries({ queryKey: BOARD_ADMIN_KEY });
    },
  });
}
