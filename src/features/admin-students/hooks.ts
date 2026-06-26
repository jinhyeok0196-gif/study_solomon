import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createStudent,
  deleteStudent,
  fetchAllStudents,
  fetchStudentDetail,
  grantMembership,
  updateStudent,
} from './api';
import type { CreateStudentInput, GrantMembershipInput, UpdateStudentInput } from './types';

export function useStudentsQuery() {
  return useQuery({
    queryKey: ['admin-students'],
    queryFn: fetchAllStudents,
  });
}

export function useStudentDetailQuery(studentId: string) {
  return useQuery({
    queryKey: ['admin-student-detail', studentId],
    queryFn: () => fetchStudentDetail(studentId),
  });
}

export function useCreateStudentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStudentInput) => createStudent(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-students'] }),
  });
}

export function useUpdateStudentMutation(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStudentInput) => updateStudent(studentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      queryClient.invalidateQueries({ queryKey: ['admin-student-detail', studentId] });
    },
  });
}

export function useDeleteStudentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) => deleteStudent(studentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-students'] }),
  });
}

export function useGrantMembershipMutation(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GrantMembershipInput) => grantMembership(studentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      queryClient.invalidateQueries({ queryKey: ['admin-student-detail', studentId] });
    },
  });
}
