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

/** 관리자(키오스크): 현재 유효한 회전 토큰 발급 */
export async function fetchCheckinToken(): Promise<string> {
  const { data, error } = await supabase.rpc('current_checkin_token');
  if (error) throw new Error('QR 토큰을 불러오지 못했습니다.');
  return data as string;
}
