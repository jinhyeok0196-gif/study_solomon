import { supabase } from '@/lib/supabase/client';
import { PENALTY_POINTS, type PenaltyReasonCode } from '@/constants/penaltyRules';

export interface PenaltyRecordWithStudent {
  id: string;
  studentId: string;
  studentName: string;
  reasonCode: string;
  adjustmentType: string;
  points: number;
  description: string | null;
  createdAt: string;
}

interface PenaltyJoinRow {
  id: string;
  student_id: string;
  reason_code: string;
  adjustment_type: string;
  points: number;
  description: string | null;
  created_at: string;
  student_profiles: { users: { name: string } | null } | null;
}

export async function fetchAllPenaltyRecords(limit = 50): Promise<PenaltyRecordWithStudent[]> {
  const { data, error } = await supabase
    .from('penalty_records')
    .select('id, student_id, reason_code, adjustment_type, points, description, created_at, student_profiles(users(name))')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data as unknown as PenaltyJoinRow[]).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_profiles?.users?.name ?? '(알 수 없음)',
    reasonCode: row.reason_code,
    adjustmentType: row.adjustment_type,
    points: row.points,
    description: row.description,
    createdAt: row.created_at,
  }));
}

export interface CreatePenaltyInput {
  studentId: string;
  reasonCode: PenaltyReasonCode;
  adjustmentType: 'add' | 'subtract';
  description?: string;
  createdBy: string;
}

export async function createPenaltyRecord(input: CreatePenaltyInput): Promise<void> {
  const { error } = await supabase.from('penalty_records').insert({
    student_id: input.studentId,
    reason_code: input.reasonCode,
    adjustment_type: input.adjustmentType,
    points: PENALTY_POINTS[input.reasonCode],
    description: input.description,
    created_by: input.createdBy,
  });
  if (error) throw error;
}

export interface ManualPenaltyInput {
  studentId: string;
  points: number; // 1~10
  description?: string; // 선택 사유
  createdBy: string;
}

/** 임의 점수(1~10) 직접 부여. reason_code는 '관리자 부여'로 기록(트리거가 points로 누적/경고 처리). */
export async function createManualPenalty(input: ManualPenaltyInput): Promise<void> {
  const points = Math.max(1, Math.min(10, Math.round(input.points)));
  const { error } = await supabase.from('penalty_records').insert({
    student_id: input.studentId,
    reason_code: '관리자 부여',
    adjustment_type: 'add',
    points,
    description: input.description?.trim() || null,
    created_by: input.createdBy,
  });
  if (error) throw error;
}
