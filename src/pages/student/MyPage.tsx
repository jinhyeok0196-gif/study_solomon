import { useMemo, useState } from 'react';
import { isSameMonth, isSameWeek } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useMyProfileQuery, useMyRequestLogsQuery, useSubmitRequestLogMutation, useStudentNotificationsQuery, useMarkStudentNotificationReadMutation } from '@/features/mypage/hooks';
import { useAttendanceRecordsQuery } from '@/features/attendance/hooks';
import {
  attendedIntervalsFromRecords,
  awayDeductionMinutes,
  computeAttendanceStats,
} from '@/features/attendance/stats';
import { useAllExtraStudyQuery } from '@/features/extra-study/hooks';
import { sumExtraStudyMinutes } from '@/features/extra-study/api';
import { useAllOutingsQuery } from '@/features/outing/hooks';
import { useRecentNapsQuery } from '@/features/powernap/hooks';
import { buildDailyStudySeconds, toLocalDateKey } from '@/features/activity-calendar/aggregate';
import { cn } from '@/lib/utils';
import { usePenaltyRecordsQuery } from '@/features/penalty/hooks';
import { computeRiskLevel } from '@/features/penalty/risk';
import { PENALTY_REASON_LABEL, type PenaltyReasonCode } from '@/constants/penaltyRules';
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE } from '@/features/mypage/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { isValidPhone } from '@/features/auth/phone';

type ModalKind = 'name' | 'phone' | 'withdrawal' | null;

function remainingDays(endDate: string | null): number | null {
  if (!endDate) return null;
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function fmt(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR');
}

export default function MyPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const now = useCurrentTime(1000);

  const { data: profile, isLoading, isError } = useMyProfileQuery(studentId);
  const { data: requestLogs } = useMyRequestLogsQuery(studentId);
  const { data: attendanceRecords } = useAttendanceRecordsQuery(studentId);
  const { data: penaltyRecords } = usePenaltyRecordsQuery(studentId);
  const { data: notifications } = useStudentNotificationsQuery(studentId);

  const submitRequest = useSubmitRequestLogMutation(studentId);
  const markRead = useMarkStudentNotificationReadMutation(studentId);

  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');

  const openModal = (kind: ModalKind) => {
    setModalKind(kind);
    setNewName('');
    setNewPhone('');
    setReason('');
    setFormError('');
  };
  const closeModal = () => setModalKind(null);

  const { data: extraStudyLogs } = useAllExtraStudyQuery(studentId);
  const { data: outingLogs } = useAllOutingsQuery(studentId);
  const { data: napLogs } = useRecentNapsQuery(studentId);
  const allRecords = attendanceRecords ?? [];
  const monthRecords = allRecords.filter((r) => isSameMonth(new Date(r.classDate), new Date()));
  const awayDeduction = awayDeductionMinutes(
    attendedIntervalsFromRecords(allRecords),
    [...(outingLogs ?? []), ...(napLogs ?? [])].map((l) => ({
      startedAt: l.started_at,
      endedAt: l.ended_at,
    }))
  );
  const stats = computeAttendanceStats(
    allRecords,
    monthRecords,
    sumExtraStudyMinutes(extraStudyLogs ?? []),
    awayDeduction
  );
  const riskLevel = profile ? computeRiskLevel(profile.currentPenaltyPoints) : null;

  // 순공시간: 일/주간/월간/누적 선택. 모두 초 단위, 오늘분은 매초 실시간 반영.
  const [studyRange, setStudyRange] = useState<'day' | 'week' | 'month' | 'all'>('day');
  // 날짜별 순공시간(초) 맵 — 오늘은 now 기준 실시간, 과거는 확정값.
  const studySecMap = useMemo(
    () => buildDailyStudySeconds(allRecords, extraStudyLogs ?? [], outingLogs ?? [], napLogs ?? [], now.getTime()),
    [allRecords, extraStudyLogs, outingLogs, napLogs, now]
  );
  const studyTotals = useMemo(() => {
    const todayKey = toLocalDateKey(now.toISOString());
    let day = 0,
      week = 0,
      month = 0,
      all = 0;
    for (const [k, sec] of studySecMap) {
      const d = new Date(`${k}T00:00:00`);
      all += sec;
      if (k === todayKey) day += sec;
      if (isSameWeek(d, now, { weekStartsOn: 1 })) week += sec;
      if (isSameMonth(d, now)) month += sec;
    }
    return { day, week, month, all };
  }, [studySecMap, now]);

  const rangeSeconds = studyTotals[studyRange];
  const rangeH = Math.floor(rangeSeconds / 3600);
  const rangeM = Math.floor((rangeSeconds % 3600) / 60);
  const rangeS = rangeSeconds % 60;

  const PENALTY_THRESHOLD = 15;
  const nextWarningAt =
    profile
      ? Math.ceil(profile.currentPenaltyPoints / PENALTY_THRESHOLD) * PENALTY_THRESHOLD
      : 0;
  const pointsUntilWarning = profile ? nextWarningAt - profile.currentPenaltyPoints : 0;

  async function handleSubmit() {
    setFormError('');
    if (!reason.trim()) { setFormError('사유를 입력해주세요.'); return; }

    if (modalKind === 'name') {
      if (!newName.trim()) { setFormError('변경할 이름을 입력해주세요.'); return; }
      await submitRequest.mutateAsync({ requestType: 'name_change', reason: reason.trim(), newValue: newName.trim() });
    } else if (modalKind === 'phone') {
      if (!isValidPhone(newPhone)) { setFormError('올바른 전화번호를 입력해주세요.'); return; }
      await submitRequest.mutateAsync({ requestType: 'phone_change', reason: reason.trim(), newValue: newPhone.trim() });
    } else if (modalKind === 'withdrawal') {
      await submitRequest.mutateAsync({ requestType: 'withdrawal', reason: reason.trim() });
    }
    closeModal();
  }

  const hasPendingRequest = (type: ModalKind) =>
    requestLogs?.some((r) => r.requestType === (type === 'name' ? 'name_change' : type === 'phone' ? 'phone_change' : 'withdrawal') && r.status === 'pending');

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  if (isError || !profile) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-gray-700">프로필 정보를 불러올 수 없습니다.</p>
        <p className="text-xs text-gray-400">관리자에게 계정 등록을 요청해주세요.</p>
      </div>
    );
  }

  const unreadCount = (notifications ?? []).filter((n) => !n.is_read).length;

  return (
    <div className="flex flex-col gap-6 p-4 pb-24">
      <h2 className="text-lg font-semibold text-gray-900">마이페이지</h2>

      {/* 내 정보 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">내 정보</h3>
        <Card className="flex flex-col gap-2 text-sm">
          <InfoRow label="이름" value={profile.name} />
          <InfoRow label="전화번호" value={profile.phone} />
          <InfoRow label="이메일" value={profile.email || '-'} />
          <InfoRow label="가입일" value={fmt(profile.createdAt)} />
        </Card>
        <div className="mt-2 flex flex-col gap-2">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => openModal('name')}
            disabled={!!hasPendingRequest('name')}
          >
            {hasPendingRequest('name') ? '이름 변경 요청 대기중' : '이름 변경 요청'}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => openModal('phone')}
            disabled={!!hasPendingRequest('phone')}
          >
            {hasPendingRequest('phone') ? '전화번호 변경 요청 대기중' : '전화번호 변경 요청'}
          </Button>
          <Button
            variant="danger"
            className="w-full"
            onClick={() => openModal('withdrawal')}
            disabled={!!hasPendingRequest('withdrawal')}
          >
            {hasPendingRequest('withdrawal') ? '탈퇴 요청 대기중' : '회원탈퇴 요청'}
          </Button>
        </div>
      </section>

      {/* 이용 정보 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">이용 정보</h3>
        <Card className="flex flex-col gap-2 text-sm">
          <InfoRow label="이용권" value={profile.membershipType ?? '-'} />
          <InfoRow label="이용 시작일" value={fmt(profile.membershipStartDate)} />
          <InfoRow label="이용 종료일" value={fmt(profile.membershipEndDate)} />
          <InfoRow
            label="남은 이용일"
            value={
              remainingDays(profile.membershipEndDate) !== null
                ? `${remainingDays(profile.membershipEndDate)}일`
                : '-'
            }
          />
        </Card>
      </section>

      {/* 벌점 현황 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">벌점 현황</h3>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-gray-500">현재 벌점</p>
            <p className="text-2xl font-bold text-gray-900">{profile.currentPenaltyPoints}점</p>
            {riskLevel && <Badge tone={riskLevel.tone} className="mt-1">{riskLevel.label}</Badge>}
          </Card>
          <Card>
            <p className="text-xs text-gray-500">경고 횟수</p>
            <p className="text-2xl font-bold text-gray-900">{profile.warningCount}회</p>
            <p className="mt-1 text-xs text-gray-400">다음 경고까지 {pointsUntilWarning}점</p>
          </Card>
        </div>
        {penaltyRecords && penaltyRecords.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-xs font-medium text-gray-500">벌점 이력</p>
            <ul className="flex flex-col gap-1">
              {penaltyRecords.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{PENALTY_REASON_LABEL[r.reason_code as PenaltyReasonCode] ?? r.reason_code}</p>
                    <p className="text-xs text-gray-400">{fmt(r.created_at)}</p>
                  </div>
                  <Badge tone={r.adjustment_type === 'add' ? 'danger' : 'success'}>
                    {r.adjustment_type === 'add' ? '+' : '-'}{r.points}점
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 출석 통계 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">출석 통계</h3>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-gray-500">이달 출석률</p>
            <p className="text-2xl font-bold text-gray-900">{Math.round(stats.attendanceRate * 100)}%</p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500">결석 횟수</p>
            <p className="text-2xl font-bold text-gray-900">
              {monthRecords.filter((r) => ['absent', 'excused_absence'].includes(r.status)).length}회
            </p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500">지각 횟수</p>
            <p className="text-2xl font-bold text-gray-900">{stats.lateCount}회</p>
          </Card>
        </div>
      </section>

      {/* 순공시간 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">순공시간</h3>
        <Card>
          <div className="mb-3 grid grid-cols-4 gap-1 rounded-lg bg-gray-100 p-1">
            {([
              ['day', '일'],
              ['week', '주간'],
              ['month', '월간'],
              ['all', '누적'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStudyRange(value)}
                className={cn(
                  'rounded-md py-1.5 text-sm font-medium transition-colors',
                  studyRange === value ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-center text-3xl font-bold text-gray-900 tabular-nums">
            {rangeH}
            <span className="text-lg font-semibold text-gray-500">시간 </span>
            {rangeM}
            <span className="text-lg font-semibold text-gray-500">분 </span>
            {String(rangeS).padStart(2, '0')}
            <span className="text-lg font-semibold text-gray-500">초</span>
          </p>
        </Card>
      </section>

      {/* 요청 이력 */}
      {requestLogs && requestLogs.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">변경 요청 이력</h3>
          <ul className="flex flex-col gap-2">
            {requestLogs.map((log) => (
              <li key={log.id} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">{REQUEST_TYPE_LABEL[log.requestType]}</span>
                  <Badge tone={REQUEST_STATUS_TONE[log.status]}>{REQUEST_STATUS_LABEL[log.status]}</Badge>
                </div>
                {log.newValue && <p className="mt-0.5 text-xs text-gray-500">새 값: {log.newValue}</p>}
                <p className="mt-0.5 text-xs text-gray-400">사유: {log.reason}</p>
                {log.adminNote && <p className="mt-0.5 text-xs text-red-500">관리자 메모: {log.adminNote}</p>}
                <p className="mt-0.5 text-xs text-gray-400">{fmt(log.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 알림 */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">알림</h3>
          {unreadCount > 0 && <Badge tone="danger">{unreadCount}</Badge>}
        </div>
        {!notifications || notifications.length === 0 ? (
          <EmptyState title="알림이 없습니다" />
        ) : (
          <ul className="flex flex-col gap-2">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`rounded-md border px-3 py-2 text-sm ${n.is_read ? 'border-gray-100 bg-gray-50' : 'border-brand-200 bg-brand-50'}`}
                onClick={() => !n.is_read && markRead.mutate(n.id)}
              >
                <p className="font-medium text-gray-800">{n.title}</p>
                <p className="text-xs text-gray-500">{n.message}</p>
                <p className="mt-0.5 text-xs text-gray-400">{fmt(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 이름 변경 요청 모달 */}
      <Modal open={modalKind === 'name'} onClose={closeModal} title="이름 변경 요청">
        <div className="flex flex-col gap-3">
          <FormField label="변경할 이름" htmlFor="new-name" error={formError && !newName.trim() ? formError : undefined}>
            <Input id="new-name" autoComplete="off" placeholder="홍길동" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </FormField>
          <FormField label="변경 사유" htmlFor="name-reason" error={formError && newName.trim() ? formError : undefined}>
            <Input id="name-reason" placeholder="법적 개명 등" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <Button className="w-full" onClick={handleSubmit} disabled={submitRequest.isPending}>
            {submitRequest.isPending ? '요청 중...' : '요청 제출'}
          </Button>
        </div>
      </Modal>

      {/* 전화번호 변경 요청 모달 */}
      <Modal open={modalKind === 'phone'} onClose={closeModal} title="전화번호 변경 요청">
        <div className="flex flex-col gap-3">
          <FormField label="새 전화번호" htmlFor="new-phone">
            <Input id="new-phone" type="tel" placeholder="01012345678" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </FormField>
          <FormField label="변경 사유" htmlFor="phone-reason">
            <Input id="phone-reason" placeholder="번호 변경 등" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <Button className="w-full" onClick={handleSubmit} disabled={submitRequest.isPending}>
            {submitRequest.isPending ? '요청 중...' : '요청 제출'}
          </Button>
        </div>
      </Modal>

      {/* 회원탈퇴 요청 모달 */}
      <Modal open={modalKind === 'withdrawal'} onClose={closeModal} title="회원탈퇴 요청">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">탈퇴 요청은 관리자 승인 후 처리됩니다. 데이터는 즉시 삭제되지 않습니다.</p>
          <FormField label="탈퇴 사유" htmlFor="withdrawal-reason">
            <Input id="withdrawal-reason" placeholder="탈퇴 사유를 입력해주세요" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <Button variant="danger" className="w-full" onClick={handleSubmit} disabled={submitRequest.isPending}>
            {submitRequest.isPending ? '요청 중...' : '탈퇴 요청'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
