import { useMyRequestsQuery, useCancelRequestMutation } from '../hooks';
import { REQUEST_STATUS_LABEL, type RequestKind } from '../types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';

const STATUS_TONE = {
  pending: 'default',
  approved: 'success',
  rejected: 'danger',
} as const;

interface RequestListProps {
  kind: RequestKind;
  studentId: string;
}

export function RequestList({ kind, studentId }: RequestListProps) {
  const { data: requests, isLoading } = useMyRequestsQuery(kind, studentId);
  const cancelMutation = useCancelRequestMutation(kind, studentId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (!requests || requests.length === 0) {
    return <EmptyState title="제출한 신청 내역이 없습니다" />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {requests.map((request) => (
        <li
          key={request.id}
          className="flex flex-col gap-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-900">
              {request.requestDate} · {request.periodNumbers.sort((a, b) => a - b).join(', ')}교시
            </span>
            <Badge tone={STATUS_TONE[request.status]}>{REQUEST_STATUS_LABEL[request.status]}</Badge>
          </div>
          <p className="text-gray-500">{request.reason}</p>
          {request.status !== 'rejected' && (
            <Button
              variant="ghost"
              className="self-start px-2 py-1 text-xs text-red-600"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate(request.id)}
            >
              {request.status === 'approved' ? '승인 취소' : '취소'}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
