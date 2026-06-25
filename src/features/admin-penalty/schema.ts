import { z } from 'zod';
import { PENALTY_POINTS } from '@/constants/penaltyRules';

const REASON_CODES = Object.keys(PENALTY_POINTS) as [keyof typeof PENALTY_POINTS, ...(keyof typeof PENALTY_POINTS)[]];

export const createPenaltySchema = z.object({
  studentId: z.string().min(1, '학생을 선택해주세요.'),
  reasonCode: z.enum(REASON_CODES),
  adjustmentType: z.enum(['add', 'subtract']),
  description: z.string().optional(),
});

export type CreatePenaltyFormValues = z.infer<typeof createPenaltySchema>;
