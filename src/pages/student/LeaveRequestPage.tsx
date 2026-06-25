import { useAuth } from '@/hooks/useAuth';
import { RequestForm } from '@/features/requests/components/RequestForm';
import { RequestList } from '@/features/requests/components/RequestList';

export default function LeaveRequestPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">조퇴 신청</h2>
        <p className="mt-1 text-sm text-gray-500">날짜, 교시, 사유를 입력해 조퇴를 신청합니다.</p>
      </div>
      <RequestForm kind="leave" studentId={user!.id} />
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">신청 내역</h3>
        <RequestList kind="leave" studentId={user!.id} />
      </div>
    </div>
  );
}
