import { z } from 'zod';
import { isValidPhone } from '@/features/auth/phone';

export const createStudentSchema = z.object({
  phone: z.string().min(1, '전화번호를 입력해주세요.').refine(isValidPhone, '올바른 휴대폰 번호 형식이 아닙니다.'),
  name: z.string().min(1, '이름을 입력해주세요.'),
  password: z.string().min(6, '비밀번호는 6자 이상이어야 합니다.'),
  school: z.string().optional(),
  grade: z.string().optional(),
  studentNumber: z.string().optional(),
  guardianPhone: z.string().optional(),
});

export type CreateStudentFormValues = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요.'),
  phone: z.string().min(1, '전화번호를 입력해주세요.').refine(isValidPhone, '올바른 휴대폰 번호 형식이 아닙니다.'),
  userStatus: z.enum(['active', 'suspended', 'expelled']),
  school: z.string().optional(),
  grade: z.string().optional(),
  studentNumber: z.string().optional(),
  guardianPhone: z.string().optional(),
  membershipStatus: z.enum(['active', 'paused', 'expelled']),
  memo: z.string().optional(),
});

export type UpdateStudentFormValues = z.infer<typeof updateStudentSchema>;
