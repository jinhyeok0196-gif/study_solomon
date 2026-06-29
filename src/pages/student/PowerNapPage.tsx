import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNow } from '@/hooks/useNow';
import { useSystemSetting } from '@/hooks/useSystemSetting';
import { useNapMutations, useTodayNapQuery } from '@/features/powernap/hooks';
import { POWER_NAP_MAX_MINUTES } from '@/constants/penaltyRules';
import { NAP_REASONS } from '@/constants/reasons';
import { formatRemaining } from '@/lib/time';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ReasonSelectModal } from '@/components/ReasonSelectModal';

export default function PowerNapPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const now = useNow();

  const { data: maxMinutes } = useSystemSetting('power_nap_max_minutes', POWER_NAP_MAX_MINUTES);
  const { data: nap, isLoading } = useTodayNapQuery(studentId);
  const { start, end } = useNapMutations(studentId);
  const [reasonOpen, setReasonOpen] = useState(false);

  const autoEndTriggered = useRef(false);

  useEffect(() => {
    if (!nap || nap.status !== 'ongoing') {
      autoEndTriggered.current = false;
      return;
    }
    const isTimeUp = now.getTime() >= new Date(nap.planned_end_at).getTime();
    if (isTimeUp && !autoEndTriggered.current && !end.isPending) {
      autoEndTriggered.current = true;
      end.mutate(nap.id);
    }
  }, [nap, now, end]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">파워냅</h2>
        <p className="mt-1 text-sm text-gray-500">
          하루 1회, 최대 {maxMinutes}분까지 지정된 파워냅존에서 이용할 수 있습니다.
        </p>
      </div>

      <Card className="flex flex-col items-center gap-3 py-8">
        {isLoading ? (
          <Spinner />
        ) : !nap ? (
          <Button disabled={start.isPending} onClick={() => setReasonOpen(true)}>
            파워냅 시작
          </Button>
        ) : nap.status === 'ongoing' ? (
          <>
            <Badge tone="warning">파워냅 진행중</Badge>
            <p className="text-3xl font-bold text-gray-900">{formatRemaining(nap.planned_end_at, now)}</p>
            <p className="text-xs text-gray-500">남은 시간</p>
            {nap.reason && <p className="text-xs text-gray-500">사유: {nap.reason}</p>}
            <Button variant="danger" disabled={end.isPending} onClick={() => end.mutate(nap.id)}>
              종료
            </Button>
          </>
        ) : (
          <>
            <Badge tone="success">오늘 파워냅 사용 완료</Badge>
            <p className="text-sm text-gray-500">오늘은 파워냅을 모두 사용했습니다. 내일 다시 이용해주세요.</p>
          </>
        )}
      </Card>

      <p className="text-xs text-red-600">파워냅 중 휴대폰 사용은 벌점 대상입니다. 무단 이용 시에도 벌점이 부과됩니다.</p>

      <ReasonSelectModal
        open={reasonOpen}
        title="파워냅 사유를 선택해주세요"
        reasons={NAP_REASONS}
        confirmLabel="파워냅 시작"
        isPending={start.isPending}
        onConfirm={(reason) =>
          start.mutate(
            { maxMinutes: maxMinutes ?? POWER_NAP_MAX_MINUTES, reason },
            { onSuccess: () => setReasonOpen(false) }
          )
        }
        onClose={() => setReasonOpen(false)}
      />
    </div>
  );
}
