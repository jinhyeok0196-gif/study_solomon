import { z } from 'zod';

export const requestFormSchema = z.object({
  requestDate: z.string().min(1, '날짜를 선택해주세요.'),
  periodNumbers: z.array(z.number()).min(1, '교시를 한 개 이상 선택해주세요.'),
  reason: z.string().min(1, '사유를 입력해주세요.').max(500, '사유는 500자 이내로 입력해주세요.'),
});

export type RequestFormValues = z.infer<typeof requestFormSchema>;
