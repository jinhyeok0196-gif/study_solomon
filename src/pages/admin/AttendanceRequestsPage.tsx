import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  useAttendanceRequestsQuery,
  useReviewAttendanceRequestMutation,
} from '@/features/admin-attendance-requests/hooks';
import type { AttendanceRequestRow } from '@/features/admin-attendance-requests/api';
import { REQUEST_KIND_LABEL, REQUEST_STATUS_LABEL } from '@/features/requests/types';
import { usePeriods, formatPeriodNumbers } from '@/hooks/usePeriods';
import { QuickPenaltyGrant } from '@/features/admin-penalty/components/QuickPenaltyGrant';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';

type Tab = 'all' | 'absence' | 'leave';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'absence', label: '결석' },
  { key: 'leave', label: '조퇴' },
];

const STATUS_TONE: Record<AttendanceRequestRow['status'], 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

function fmt(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('ko-KR');
}

export default function AttendanceRequestsPage() {
  const { user } = useAuth();
  const adminId = user!.id;

  const { data: requests, isLoading } = useAttendanceRequestsQuery();
  const { data: periods } = usePeriods();
  const review = useReviewAttendanceRequestMutation();

  type Action = 'approved' | 'rejected' | 'pending';
  const [tab, setTab] = useState<Tab>('all');
  const [target, setTarget] = useState<{ req: AttendanceRequestRow; action: Action } | null>(null);

  const ACTION_VERB: Record<Action, string> = { approved: '승인', rejected: '거절', pending: '처리 취소' };

  const filtered = (requests ?? []).filter((r) => tab === 'all' || r.kind === tab);
  const pendingCount = (requests ?? []).filter((r) => r.status === 'pending').length;

  async function handleConfirm() {
    if (!target) return;
    await review.mutateAsync({
      kind: target.req.kind,
      requestId: target.req.id,
      status: target.action,
      adminId,
    });
    setTarget(null);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-900">결석·조퇴 신청 관리</h2>
        {pendingCount > 0 && <Badge tone="warning">대기 {pendingCount}건</Badge>}
      </div>

      {/* 탭 */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 신청 목록 */}
      {filtered.length === 0 ? (
        <EmptyState title="신청이 없습니다" />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((req) => (
            <Card key={`${req.kind}-${req.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{req.studentName}</span>
                    <Badge tone={req.kind === 'absence' ? 'danger' : 'warning'}>
                      {REQUEST_KIND_LABEL[req.kind]}
                    </Badge>
                    <Badge tone={STATUS_TONE[req.status]}>{REQUEST_STATUS_LABEL[req.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    날짜: <span className="font-medium">{fmt(req.requestDate)}</span> · 교시:{' '}
                    <span className="font-medium">{formatPeriodNumbers(req.periodNumbers, periods)}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">사유: {req.reason}</p>
                  <p className="mt-1 text-xs text-gray-400">신청일: {fmt(req.createdAt)}</p>
                  {req.reviewedAt && <p className="text-xs text-gray-400">처리일: {fmt(req.reviewedAt)}</p>}
                </div>
                {req.status === 'pending' ? (
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="primary"
                      className="px-3 py-1 text-xs"
                      onClick={() => setTarget({ req, action: 'approved' })}
                    >
                      승인
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1 text-xs"
                      onClick={() => setTarget({ req, action: 'rejected' })}
                    >
                      거절
                    </Button>
                  </div>
                ) : (
                  // 이미 처리된 건은 '승인 취소'/'거절 취소'로 대기 상태로 되돌릴 수 있다
                  <Button
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    onClick={() => setTarget({ req, action: 'pending' })}
                  >
                    {req.status === 'approved' ? '승인 취소' : '거절 취소'}
                  </Button>
                )}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-2">
                <QuickPenaltyGrant studentId={req.studentId} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 승인/거절 확인 모달 */}
      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? `신청 ${ACTION_VERB[target.action]}` : ''}
      >
        {target && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{target.req.studentName}</span>님의{' '}
              <span className="font-medium">{REQUEST_KIND_LABEL[target.req.kind]} 신청</span>(
              {fmt(target.req.requestDate)}, {formatPeriodNumbers(target.req.periodNumbers, periods)})을{' '}
              {target.action === 'pending' ? (
                <>다시 <span className="font-medium">대기</span> 상태로 되돌리겠습니까?</>
              ) : (
                <>{ACTION_VERB[target.action]}하겠습니까?</>
              )}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setTarget(null)}>
                닫기
              </Button>
              <Button
                variant={
                  target.action === 'approved' ? 'primary' : target.action === 'rejected' ? 'danger' : 'secondary'
                }
                className="flex-1"
                onClick={handleConfirm}
                disabled={review.isPending}
              >
                {review.isPending ? '처리 중...' : target.action === 'pending' ? '되돌리기' : ACTION_VERB[target.action]}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
