import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createNotice,
  deleteNotice,
  fetchNotices,
  updateNotice,
  type NoticeInput,
} from './api';

export const NOTICES_KEY = ['notices'];

export function useNoticesQuery() {
  return useQuery({ queryKey: NOTICES_KEY, queryFn: fetchNotices });
}

export function useCreateNoticeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, createdBy }: { input: NoticeInput; createdBy: string }) =>
      createNotice(input, createdBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTICES_KEY }),
  });
}

export function useUpdateNoticeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: NoticeInput }) => updateNotice(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTICES_KEY }),
  });
}

export function useDeleteNoticeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteNotice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTICES_KEY }),
  });
}
