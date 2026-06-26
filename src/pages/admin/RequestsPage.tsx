import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAllRequestLogsQuery, useApproveRequestMutation, useRejectRequestMutation } from '@/features/admin-requests/hooks';
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE } from '@/features/mypage/types';
import type { RequestLogWithStudent } from '@/features/admin-requests/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';

type Tab = 'all' | 'name_change' | 'phone_change' | 'withdrawal';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'name_change', label: '이름 변경' },
  { key: 'phone_change', label: '전화번호 변경' },
  { key: 'withdrawal', label: '회원탈퇴' },
];

function fmt(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('ko-KR');
}

export default function RequestsPage() {
  const { user } = useAuth();
  const adminId = user!.id;

  const { data: logs, isLoading } = useAllRequestLogsQuery();
  const approve = useApproveRequestMutation();
  const reject = useRejectRequestMutation();

  const [tab, setTab] = useState<Tab>('all');
  const [actionTarget, setActionTarget] = useState<{ log: RequestLogWithStudent; action: 'approve' | 'reject' } | null>(null);
  const [adminNote, setAdminNote] = useState('');

  const filtered = (logs ?? []).filter((l) => tab === 'all' || l.requestType === tab);
  const pendingCount = (logs ?? []).filter((l) => l.status === 'pending').length;

  async function handleConfirm() {
    if (!actionTarget) return;
    const { log, action } = actionTarget;
    if (action === 'approve') {
      await approve.mutateAsync({ requestId: log.id, adminId, adminNote: adminNote.trim() || undefined });
    } else {
      await reject.mutateAsync({ requestId: log.id, adminId, adminNote: adminNote.trim() || undefined });
    }
    setActionTarget(null);
    setAdminNote('');
  }

  const isBusy = approve.isPending || reject.isPending;

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-900">회원 요청 관리</h2>
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

      {/* 요청 목록 */}
      {filtered.length === 0 ? (
        <EmptyState title="요청이 없습니다" />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((log) => (
            <Card key={log.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{log.studentName}</span>
                    <Badge>{REQUEST_TYPE_LABEL[log.requestType]}</Badge>
                    <Badge tone={REQUEST_STATUS_TONE[log.status]}>{REQUEST_STATUS_LABEL[log.status]}</Badge>
                  </div>
                  {log.newValue && (
                    <p className="mt-1 text-sm text-gray-600">새 값: <span className="font-medium">{log.newValue}</span></p>
                  )}
                  <p className="mt-0.5 text-sm text-gray-500">사유: {log.reason}</p>
                  {log.adminNote && (
                    <p className="mt-0.5 text-sm text-red-500">관리자 메모: {log.adminNote}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">신청일: {fmt(log.createdAt)}</p>
                  {log.reviewedAt && (
                    <p className="text-xs text-gray-400">처리일: {fmt(log.reviewedAt)}</p>
                  )}
                </div>
                {log.status === 'pending' && (
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="primary"
                      className="px-3 py-1 text-xs"
                      onClick={() => { setActionTarget({ log, action: 'approve' }); setAdminNote(''); }}
                    >
                      승인
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1 text-xs"
                      onClick={() => { setActionTarget({ log, action: 'reject' }); setAdminNote(''); }}
                    >
                      반려
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 승인/반려 확인 모달 */}
      <Modal
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={actionTarget?.action === 'approve' ? '요청 승인' : '요청 반려'}
      >
        {actionTarget && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{actionTarget.log.studentName}</span>님의{' '}
              <span className="font-medium">{REQUEST_TYPE_LABEL[actionTarget.log.requestType]}</span> 요청을{' '}
              {actionTarget.action === 'approve' ? '승인' : '반려'}하겠습니까?
            </p>
            <FormField label="관리자 메모 (선택)" htmlFor="admin-note">
              <Input
                id="admin-note"
                placeholder={actionTarget.action === 'reject' ? '반려 사유를 입력하세요' : '메모 (선택)'}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setActionTarget(null)}>
                취소
              </Button>
              <Button
                variant={actionTarget.action === 'approve' ? 'primary' : 'danger'}
                className="flex-1"
                onClick={handleConfirm}
                disabled={isBusy}
              >
                {isBusy ? '처리 중...' : actionTarget.action === 'approve' ? '승인' : '반려'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
