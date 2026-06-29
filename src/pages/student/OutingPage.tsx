import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNow } from '@/hooks/useNow';
import { useOngoingOutingQuery, useOutingMutations, useRecentOutingsQuery } from '@/features/outing/hooks';
import { OUTING_REASONS } from '@/constants/reasons';
import { formatElapsed } from '@/lib/time';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ReasonSelectModal } from '@/components/ReasonSelectModal';

export default function OutingPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const now = useNow();

  const { data: ongoing, isLoading } = useOngoingOutingQuery(studentId);
  const { data: history } = useRecentOutingsQuery(studentId);
  const { start, end } = useOutingMutations(studentId);
  const [reasonOpen, setReasonOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">외출</h2>
        <p className="mt-1 text-sm text-gray-500">
          외출 시작/복귀 버튼으로 시간을 기록합니다. 관리자 페이지에 실시간으로 반영됩니다.
        </p>
      </div>

      <Card className="flex flex-col items-center gap-3 py-8">
        {isLoading ? (
          <Spinner />
        ) : ongoing ? (
          <>
            <Badge tone="warning">외출 중</Badge>
            <p className="text-3xl font-bold text-gray-900">{formatElapsed(ongoing.started_at, now)}</p>
            {ongoing.reason && <p className="text-xs text-gray-500">사유: {ongoing.reason}</p>}
            <Button variant="danger" disabled={end.isPending} onClick={() => end.mutate(ongoing.id)}>
              복귀
            </Button>
          </>
        ) : (
          <Button disabled={start.isPending} onClick={() => setReasonOpen(true)}>
            외출 시작
          </Button>
        )}
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">최근 외출 기록</h3>
        {!history || history.length === 0 ? (
          <EmptyState title="외출 기록이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((log) => (
              <li
                key={log.id}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <span className="flex flex-col">
                  <span>{new Date(log.started_at).toLocaleString('ko-KR')}</span>
                  {log.reason && <span className="text-xs text-gray-400">{log.reason}</span>}
                </span>
                <Badge tone={log.status === 'ongoing' ? 'warning' : 'default'}>
                  {log.status === 'ongoing' ? '진행중' : log.status === 'overdue' ? '지연' : '완료'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReasonSelectModal
        open={reasonOpen}
        title="외출 사유를 선택해주세요"
        reasons={OUTING_REASONS}
        confirmLabel="외출 시작"
        isPending={start.isPending}
        onConfirm={(reason) => start.mutate(reason, { onSuccess: () => setReasonOpen(false) })}
        onClose={() => setReasonOpen(false)}
      />
    </div>
  );
}
