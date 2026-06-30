import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useAttendanceRequestsQuery } from '@/features/admin-attendance-requests/hooks';
import { useAllRequestLogsQuery } from '@/features/admin-requests/hooks';
import { Modal } from '@/components/ui/Modal';
import { ADMIN_PATHS } from '@/routes/paths';

const ATTENDANCE_KEY = ['admin', 'attendance-requests'];
const REQUEST_LOGS_KEY = ['admin', 'request-logs'];

const REQUEST_TYPE_LABEL: Record<string, string> = {
  name_change: '이름 변경',
  phone_change: '전화번호 변경',
  withdrawal: '회원 탈퇴',
};

interface Section {
  key: string;
  title: string;
  names: string[];
  to: string;
}

export function ApprovalPopup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: attendanceReqs } = useAttendanceRequestsQuery();
  const { data: requestLogs } = useAllRequestLogsQuery();

  const [open, setOpen] = useState(false);
  const openedInitial = useRef(false);

  const pendingAbsence = (attendanceReqs ?? []).filter((r) => r.kind === 'absence' && r.status === 'pending');
  const pendingLeave = (attendanceReqs ?? []).filter((r) => r.kind === 'leave' && r.status === 'pending');
  const pendingMember = (requestLogs ?? []).filter((r) => r.status === 'pending');
  const total = pendingAbsence.length + pendingLeave.length + pendingMember.length;

  // 실시간: 새 신청/요청이 들어오면 목록 갱신 + 팝업 다시 열기
  useEffect(() => {
    const handle = () => {
      qc.invalidateQueries({ queryKey: ATTENDANCE_KEY });
      qc.invalidateQueries({ queryKey: REQUEST_LOGS_KEY });
      setOpen(true);
    };
    const channel = supabase
      .channel(`approval-realtime-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'absence_requests' }, handle)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leave_requests' }, handle)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'request_logs' }, handle)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // 최초 진입 시 대기 건이 있으면 한 번 자동으로 연다
  useEffect(() => {
    if (!openedInitial.current && total > 0) {
      openedInitial.current = true;
      setOpen(true);
    }
  }, [total]);

  // 모두 처리되면 닫는다
  useEffect(() => {
    if (total === 0) setOpen(false);
  }, [total]);

  if (total === 0) return null;

  const sections: Section[] = [
    {
      key: 'absence',
      title: `결석 신청 ${pendingAbsence.length}건`,
      names: pendingAbsence.map((r) => r.studentName),
      to: ADMIN_PATHS.attendanceRequests,
    },
    {
      key: 'leave',
      title: `조퇴 신청 ${pendingLeave.length}건`,
      names: pendingLeave.map((r) => r.studentName),
      to: ADMIN_PATHS.attendanceRequests,
    },
    {
      key: 'member',
      title: `회원 요청 ${pendingMember.length}건`,
      names: pendingMember.map((r) => `${r.studentName} (${REQUEST_TYPE_LABEL[r.requestType] ?? r.requestType})`),
      to: ADMIN_PATHS.requests,
    },
  ].filter((s) => s.names.length > 0);

  const goTo = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <>
      {/* 닫아도 대기 건이 남아 있으면 다시 열 수 있는 플로팅 버튼 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-red-700"
        >
          🔔 승인 대기 {total}건
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="승인 대기 항목">
        <p className="mb-3 text-sm text-gray-500">
          관리자 확인이 필요한 항목이 <b className="text-red-600">{total}건</b> 있습니다.
        </p>
        <div className="flex flex-col gap-2">
          {sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                <button
                  type="button"
                  onClick={() => goTo(s.to)}
                  className="flex-shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  처리하러 가기
                </button>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-gray-500">{s.names.join(', ')}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          나중에
        </button>
      </Modal>
    </>
  );
}
