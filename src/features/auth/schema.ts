import { z } from 'zod';
import { isValidPhone } from './phone';

export const loginSchema = z.object({
  phone: z
    .string()
    .min(1, '전화번호를 입력해주세요.')
    .refine(isValidPhone, '올바른 휴대폰 번호 형식이 아닙니다. (예: 01012345678)'),
  password: z.string().min(6, '비밀번호는 6자 이상이어야 합니다.'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
