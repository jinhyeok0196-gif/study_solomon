import { supabase } from '@/lib/supabase/client';

export type CheckinAction = 'in' | 'out' | 'already_in' | 'already_out';

export interface CheckinResult {
  action: CheckinAction;
  status?: string;
  minutes_late?: number;
  points_added?: number;
  period_number?: number;
  early_leave?: boolean;
  scanned_at: string;
}

/** 학생: QR 토큰으로 등원/하원 체크인 (서버가 등원·하원을 자동 판별) */
export async function checkinByQr(token: string): Promise<CheckinResult> {
  const { data, error } = await supabase.rpc('checkin_by_qr', { p_token: token });
  // RPC가 한국어 예외 메시지를 던지므로 그대로 노출한다.
  if (error) throw new Error(error.message || '체크인 처리 중 오류가 발생했습니다.');
  return data as unknown as CheckinResult;
}

/**
 * 관리자: 학생을 수동으로 '등원' 처리한다.
 * 해당 교시 출석 레코드에 checked_in_at=now() 를 찍어 재실 구간을 만든다
 * (순공시간 계산의 시작점). 기존 레코드가 있으면(예: 크론 결석) present 로 갱신.
 */
export async function adminCheckinStudent(params: {
  studentId: string;
  classDate: string;
  periodNumber: number;
}): Promise<void> {
  const { error } = await supabase.from('attendance_records').upsert(
    {
      student_id: params.studentId,
      class_date: params.classDate,
      period_number: params.periodNumber,
      status: 'present',
      checked_in_at: new Date().toISOString(),
      source: 'admin',
    },
    { onConflict: 'student_id,class_date,period_number' }
  );
  if (error) throw error;
}

/**
 * 관리자: 학생의 오늘 등원 처리를 취소한다.
 * 오늘 모든 출석 레코드의 checked_in_at/checked_out_at 을 비워 재실 구간을 제거
 * (순공시간 집계 중단).
 */
export async function adminCancelCheckinStudent(params: {
  studentId: string;
  classDate: string;
}): Promise<void> {
  const { error } = await supabase
    .from('attendance_records')
    .update({ checked_in_at: null, checked_out_at: null })
    .eq('student_id', params.studentId)
    .eq('class_date', params.classDate);
  if (error) throw error;
}

/** 관리자(키오스크): 현재 유효한 회전 토큰 발급 */
export async function fetchCheckinToken(): Promise<string> {
  const { data, error } = await supabase.rpc('current_checkin_token');
  if (error) throw new Error('QR 토큰을 불러오지 못했습니다.');
  return data as string;
}
