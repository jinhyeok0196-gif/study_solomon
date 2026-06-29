import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkinByQr, fetchCheckinToken } from '@/features/checkin/api';

/** 학생: QR 토큰으로 체크인 실행 */
export function useCheckinByQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => checkinByQr(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-records'] });
      qc.invalidateQueries({ queryKey: ['penalty-profile'] });
      qc.invalidateQueries({ queryKey: ['penalty-records'] });
    },
  });
}

/**
 * 관리자(키오스크): 현재 회전 토큰. 약 15초마다 갱신해 QR을 항상 신선하게 유지한다.
 * (토큰 자체는 서버에서 30~60초 유효)
 */
export function useCheckinTokenQuery() {
  return useQuery({
    queryKey: ['checkin-token'],
    queryFn: fetchCheckinToken,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
