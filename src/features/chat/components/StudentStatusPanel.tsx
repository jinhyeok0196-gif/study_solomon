import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { usePeriods } from '@/hooks/usePeriods';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useScheduleStatus } from '@/hooks/useScheduleStatus';
import { useStudentDetailQuery } from '@/features/admin-students/hooks';
import { usePenaltyProfileQuery, usePenaltyRecordsQuery } from '@/features/penalty/hooks';
import { useOngoingOutingQuery, useOutingMutations, useRecentOutingsQuery } from '@/features/outing/hooks';
import {
  liveStudySecondsFromSchedule,
  type StudyInterval,
  type PresenceSpan,
} from '@/features/attendance/stats';
import type { Tables } from '@/lib/supabase/database.types';
import { useTodayNapQuery, useNapMutations } from '@/features/powernap/hooks';
import { useOngoingExtraStudyQuery, useTodayExtraStudyQuery } from '@/features/extra-study/hooks';
import { useCreatePenaltyMutation } from '@/features/admin-penalty/hooks';
import { QuickPenaltyGrant } from '@/features/admin-penalty/components/QuickPenaltyGrant';
import { LiveElapsed } from '@/components/LiveElapsed';
import { useUpsertAttendanceMutation } from '@/features/admin-attendance/hooks';
import { useSendMessageMutation } from '@/features/chat/hooks';
import {
  fetchTodayBathroomLogs,
  fetchTodayAttendance,
  fetchStudentRecentRequests,
  fetchStudentWeekScheduleCells,
  addManualWarning,
  fetchTodayAbsenceLeaveRequests,
} from '@/features/chat/studentPanelApi';
import { getWeekStartDate } from '@/features/schedule/dates';
import { PENALTY_REASON_LABEL, PENALTY_POINTS, type PenaltyReasonCode } from '@/constants/penaltyRules';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

type ActiveModal =
  | 'penalty'
  | 'warning'
  | 'attendance'
  | 'announcement'
  | 'student-info'
  | 'requests'
  | null;

function fmtMinutes(minutes: number): string {
  if (minutes <= 0) return '0분';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** 오늘 출결 레코드들에서 재실 구간(등원~하원)을 도출. 등원 기록 없으면 null. */
function presenceSpanFromAttendance(rows: Tables<'attendance_records'>[]): PresenceSpan | null {
  let start = Infinity;
  let end = -Infinity;
  let hasOut = false;
  for (const r of rows) {
    if (r.checked_in_at) {
      const t = new Date(r.checked_in_at).getTime();
      if (Number.isFinite(t) && t < start) start = t;
    }
    if (r.checked_out_at) {
      const t = new Date(r.checked_out_at).getTime();
      if (Number.isFinite(t) && t > end) {
        end = t;
        hasOut = true;
      }
    }
  }
  if (!Number.isFinite(start)) return null;
  return { start, end: hasOut ? end : null };
}

function durationMinutes(start: string, end: string | null): number {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((e - s) / 60000));
}

function fmtDateKo(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function padTwo(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

function computeStudentStatus(
  hasOngoingOuting: boolean,
  hasOngoingNap: boolean,
  currentSlotCategory: string | undefined,
  hasOngoingExtraStudy: boolean
): { label: string; color: string; emoji: string } {
  if (hasOngoingOuting) return { label: '외출', color: 'bg-orange-100 text-orange-700', emoji: '🚶' };
  if (hasOngoingNap) return { label: '파워냅', color: 'bg-purple-100 text-purple-700', emoji: '😴' };
  // 교시외공부 진행 중 → 비수업 시간이어도 '공부 중'
  if (hasOngoingExtraStudy) return { label: '공부 중', color: 'bg-green-100 text-green-700', emoji: '📖' };
  if (!currentSlotCategory) return { label: '자유시간', color: 'bg-gray-100 text-gray-600', emoji: '⏸' };
  switch (currentSlotCategory) {
    case 'class':
      return { label: '공부 중', color: 'bg-green-100 text-green-700', emoji: '🟢' };
    case 'meal':
      return { label: '식사', color: 'bg-yellow-100 text-yellow-700', emoji: '🍽' };
    case 'arrival':
      return { label: '등원', color: 'bg-blue-100 text-blue-700', emoji: '🏫' };
    case 'free':
      return { label: '자율학습', color: 'bg-green-50 text-green-600', emoji: '📖' };
    case 'break':
      return { label: '쉬는시간', color: 'bg-gray-100 text-gray-600', emoji: '☕' };
    default:
      return { label: '자유시간', color: 'bg-gray-100 text-gray-600', emoji: '⏸' };
  }
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  name_change: '이름 변경',
  phone_change: '전화번호 변경',
  withdrawal: '회원탈퇴',
  schedule_unlock: '시간표 수정',
};

const REQUEST_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
};

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="mt-3 mb-1.5 text-[10px] font-bold tracking-wider text-gray-400 uppercase">
      {title}
    </p>
  );
}

interface Props {
  studentId: string;
  roomId: string | null;
  className?: string;
}

export function StudentStatusPanel({ studentId, roomId, className }: Props) {
  const { user } = useAuth();
  const adminId = user!.id;
  const qc = useQueryClient();
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  const { data: student, isLoading: studentLoading } = useStudentDetailQuery(studentId);
  const { data: penaltyProfile } = usePenaltyProfileQuery(studentId);
  const { data: penaltyRecords } = usePenaltyRecordsQuery(studentId);
  const { data: ongoingOuting } = useOngoingOutingQuery(studentId);
  const { data: recentOutings } = useRecentOutingsQuery(studentId);
  const { data: todayNap } = useTodayNapQuery(studentId);
  const { data: ongoingExtraStudy } = useOngoingExtraStudyQuery(studentId);
  const { data: todayExtraStudy } = useTodayExtraStudyQuery(studentId);

  const { data: periods } = usePeriods();
  const now = useCurrentTime(15000);
  const scheduleStatus = useScheduleStatus(periods, now);
  const weekStartDate = getWeekStartDate(0);

  const { data: todayBathroom } = useQuery({
    queryKey: ['today-bathroom', studentId],
    queryFn: () => fetchTodayBathroomLogs(studentId),
    refetchInterval: 15000,
  });
  const { data: todayAttendance } = useQuery({
    queryKey: ['today-attendance-panel', studentId],
    queryFn: () => fetchTodayAttendance(studentId),
    refetchInterval: 15000,
  });
  const { data: recentRequests } = useQuery({
    queryKey: ['student-recent-requests', studentId],
    queryFn: () => fetchStudentRecentRequests(studentId, 5),
    refetchInterval: 30000,
  });
  const { data: weekSchedule } = useQuery({
    queryKey: ['student-week-schedule-panel', studentId, weekStartDate],
    queryFn: () => fetchStudentWeekScheduleCells(studentId, weekStartDate),
  });
  const { data: todayAbsLeave } = useQuery({
    queryKey: ['today-abs-leave', studentId],
    queryFn: () => fetchTodayAbsenceLeaveRequests(studentId),
    refetchInterval: 30000,
  });

  const outingMutations = useOutingMutations(studentId);
  const napMutations = useNapMutations(studentId);
  const createPenaltyMutation = useCreatePenaltyMutation();
  const upsertAttendanceMutation = useUpsertAttendanceMutation(new Date().toISOString().slice(0, 10));
  const sendMsgMutation = useSendMessageMutation(roomId ?? undefined);
  const warningMutation = useMutation({
    mutationFn: ({ note }: { note: string }) => addManualWarning(studentId, adminId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['penalty-profile', studentId] });
    },
  });

  const status = computeStudentStatus(
    !!ongoingOuting,
    !!todayNap && todayNap.status === 'ongoing',
    scheduleStatus.currentSlot?.category,
    !!ongoingExtraStudy
  );

  const outingMinutes = (todayBathroom ?? []).reduce(
    (sum, b) => sum + durationMinutes(b.started_at, b.ended_at),
    0
  );
  const napMinutes = todayNap ? durationMinutes(todayNap.started_at, todayNap.ended_at) : 0;
  // 순공시간(실시간) = (재실 구간 ∩ 본인이 신청한 수업 교시) − 교시 중 외출/파워냅 + 교시외공부.
  // 학생 대시보드(liveStudySecondsFromSchedule)와 동일한 방식. QR 등원이 첫 교시에만
  // present 레코드를 만들어도, 재실 구간(등원~하원/현재)으로 계산하므로 now 틱마다 증가한다.
  const todayKey = new Date().toISOString().slice(0, 10);
  const nowMs = now.getTime();

  const periodTimeMap = new Map<number, { start: string; end: string }>();
  (periods ?? []).forEach((p) => {
    periodTimeMap.set(p.period_number, { start: p.start_time, end: p.end_time });
  });

  // 오늘 본인이 신청한 수업 교시 구간
  const DAY_KEY_MAP: Record<number, string> = {
    0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
  };
  const todayDow = DAY_KEY_MAP[new Date().getDay()];
  const registeredToday = new Set(
    (weekSchedule?.cells ?? [])
      .filter((c) => c.day_of_week === todayDow)
      .map((c) => c.period_number)
  );
  const classIntervals: StudyInterval[] = [...registeredToday]
    .map((pn) => periodTimeMap.get(pn))
    .filter((t): t is { start: string; end: string } => t != null)
    .map((t) => ({
      start: new Date(`${todayKey}T${t.start}`).getTime(),
      end: new Date(`${todayKey}T${t.end}`).getTime(),
    }))
    .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start);

  // 재실 구간(등원~하원, 아직 재실 중이면 현재까지)
  const presence = presenceSpanFromAttendance(todayAttendance ?? []);

  const todayOutingLogs = (recentOutings ?? []).filter((o) => o.started_at.slice(0, 10) === todayKey);
  const awayLogs = [
    ...todayOutingLogs.map((o) => ({ startedAt: o.started_at, endedAt: o.ended_at })),
    ...(todayNap ? [{ startedAt: todayNap.started_at, endedAt: todayNap.ended_at }] : []),
  ];
  const extraLogs = (todayExtraStudy ?? []).map((e) => ({
    startedAt: e.started_at,
    endedAt: e.ended_at,
  }));

  const studyMinutes = Math.floor(
    liveStudySecondsFromSchedule(classIntervals, presence, extraLogs, awayLogs, nowMs) / 60
  );

  const [penaltyForm, setPenaltyForm] = useState<{ reasonCode: PenaltyReasonCode | ''; desc: string }>({
    reasonCode: '',
    desc: '',
  });
  const [warningNote, setWarningNote] = useState('');
  const [attendanceForm, setAttendanceForm] = useState({ periodNumber: 1, status: 'present' });
  const [announcementText, setAnnouncementText] = useState('');

  const outerClass = className ?? 'w-72 flex-shrink-0 border-l border-gray-200';

  if (studentLoading) {
    return (
      <div className={cn('flex flex-col bg-white overflow-hidden items-center justify-center', outerClass)}>
        <Spinner />
      </div>
    );
  }

  if (!student) return null;

  const todayDayLabel = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  const DAY_MAP: Record<number, string> = {
    0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
  };
  const todayDayOfWeek = DAY_MAP[new Date().getDay()];
  const todayScheduleCells = (weekSchedule?.cells ?? []).filter((c) => c.day_of_week === todayDayOfWeek);
  const todayPeriodNumbers = new Set(todayScheduleCells.map((c) => c.period_number));
  const selectablePeriods = (periods ?? []).filter((p) => p.is_selectable);

  const currentSlot = scheduleStatus.currentSlot;

  return (
    <div className={cn('flex flex-col bg-white overflow-hidden', outerClass)}>
      <div className="flex-1 overflow-y-auto px-3 py-3">

        {/* 기본 정보 */}
        <div className="flex items-start gap-3 pb-3 border-b border-gray-100">
          <div className="h-12 w-12 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-lg font-bold text-gray-600">
            {student.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-sm">{student.name}</p>
            <p className="text-xs text-gray-500">{student.phone}</p>
            {student.school && (
              <p className="text-xs text-gray-400">{student.school} {student.grade}</p>
            )}
          </div>
          <div className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0', status.color)}>
            <span>{status.emoji}</span>
            <span>{status.label}</span>
          </div>
        </div>

        {/* 진행 중 외출: 실시간 경과 시간 */}
        {ongoingOuting && (
          <div className="flex items-center justify-between rounded-md bg-orange-50 px-2 py-1.5 text-xs">
            <span className="font-medium text-orange-700">🚶 외출 중{ongoingOuting.reason ? ` · ${ongoingOuting.reason}` : ''}</span>
            <LiveElapsed startedAt={ongoingOuting.started_at} className="font-mono font-semibold text-orange-600" />
          </div>
        )}

        {/* 이용권 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title="이용권" />
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
            <span className="text-gray-400">상태</span>
            <span className="text-gray-700 font-medium">{student.membershipStatus}</span>
            <span className="text-gray-400">등록일</span>
            <span className="text-gray-700">{fmtDateKo(student.enrollmentDate)}</span>
          </div>
        </div>

        {/* 현재 일정 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title="현재 일정" />
          {currentSlot ? (
            <div className="rounded-lg bg-blue-50 p-2">
              <p className="text-xs text-blue-500 font-medium">현재</p>
              <p className="text-sm font-bold text-blue-800">{currentSlot.label}</p>
              <p className="text-[10px] text-blue-600">
                {padTwo(currentSlot.startMinutes / 60)}:{padTwo(currentSlot.startMinutes % 60)}
                {' ~ '}
                {padTwo(currentSlot.endMinutes / 60)}:{padTwo(currentSlot.endMinutes % 60)}
              </p>
              <p className="text-[10px] text-blue-500 mt-0.5">
                남은시간 {scheduleStatus.remainingMinutes}분 {scheduleStatus.remainingSeconds}초
              </p>
              {scheduleStatus.nextSlot && (
                <p className="text-[10px] text-gray-500 mt-1">다음 → {scheduleStatus.nextSlot.label}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">일정 없음</p>
          )}
        </div>

        {/* 오늘 공부 현황 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title="오늘 공부 현황" />
          <div className="grid grid-cols-3 gap-1 text-center">
            {[
              { label: '공부', value: fmtMinutes(studyMinutes), color: 'text-green-600' },
              { label: '외출', value: fmtMinutes(outingMinutes), color: 'text-orange-500' },
              { label: '파워냅', value: fmtMinutes(napMinutes), color: 'text-purple-500' },
            ].map((s) => (
              <div key={s.label} className="rounded-md bg-gray-50 p-1.5">
                <p className={cn('text-sm font-bold', s.color)}>{s.value}</p>
                <p className="text-[10px] text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 오늘 이벤트 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title="오늘 이벤트" />
          <div className="grid grid-cols-3 gap-1 text-center">
            {[
              { label: '외출', value: (todayBathroom ?? []).length },
              { label: '파워냅', value: todayNap ? 1 : 0 },
              { label: '결석신청', value: (todayAbsLeave?.absences ?? []).length },
              { label: '조퇴신청', value: (todayAbsLeave?.leaves ?? []).length },
              { label: '출석', value: (todayAttendance ?? []).filter((a) => a.status === 'present').length },
              { label: '지각', value: (todayAttendance ?? []).filter((a) => a.status === 'late').length },
            ].map((e) => (
              <div key={e.label} className="rounded-md bg-gray-50 p-1.5">
                <p className="text-sm font-bold text-gray-800">{e.value}회</p>
                <p className="text-[10px] text-gray-400">{e.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 벌점 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title="벌점" />
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-red-50 px-3 py-1.5 text-center">
              <p className="text-lg font-bold text-red-600">{penaltyProfile?.currentPenaltyPoints ?? 0}점</p>
              <p className="text-[10px] text-red-400">현재 벌점</p>
            </div>
            <div className="rounded-lg bg-orange-50 px-3 py-1.5 text-center">
              <p className="text-lg font-bold text-orange-600">{penaltyProfile?.warningCount ?? 0}회</p>
              <p className="text-[10px] text-orange-400">경고</p>
            </div>
          </div>
          {(penaltyRecords ?? []).slice(0, 3).map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-500">{PENALTY_REASON_LABEL[r.reason_code as PenaltyReasonCode] ?? r.reason_code}</span>
              <span className="font-semibold text-red-500">+{r.points}점</span>
            </div>
          ))}
          <div className="mt-2 border-t border-gray-100 pt-2">
            <QuickPenaltyGrant studentId={studentId} />
          </div>
        </div>

        {/* 오늘 시간표 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title={`오늘(${todayDayLabel}) 시간표`} />
          {selectablePeriods.length === 0 ? (
            <p className="text-xs text-gray-400">교시 정보 없음</p>
          ) : (
            <div className="space-y-0.5">
              {selectablePeriods.map((p) => {
                const checked = todayPeriodNumbers.has(p.period_number);
                return (
                  <div key={p.period_number} className="flex items-center gap-1.5 text-xs">
                    <span className={checked ? 'text-green-500' : 'text-gray-300'}>
                      {checked ? '✅' : '□'}
                    </span>
                    <span className={checked ? 'text-gray-700' : 'text-gray-400'}>{p.display_name}</span>
                    <span className="text-gray-300 text-[10px]">
                      {p.start_time.slice(0, 5)}~{p.end_time.slice(0, 5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 최근 신청 내역 */}
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader title="최근 신청 내역" />
          {!(recentRequests ?? []).length ? (
            <p className="text-xs text-gray-400">신청 내역 없음</p>
          ) : (
            <div className="space-y-1">
              {(recentRequests ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}</span>
                  <Badge tone={REQUEST_STATUS_TONE[r.status] ?? 'default'}>
                    {r.status === 'approved' ? '승인' : r.status === 'rejected' ? '반려' : '대기'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI 상태 (Placeholder) */}
        <div className="pb-2">
          <SectionHeader title="AI 분석 (준비 중)" />
          <div className="rounded-lg border border-dashed border-gray-200 p-2 text-center">
            <p className="text-xs text-gray-400">AI 분석 준비 중</p>
            <p className="text-[10px] text-gray-300 mt-0.5">CCTV AI 연동 예정</p>
          </div>
        </div>
      </div>

      {/* 빠른 작업 버튼 */}
      <div className="border-t border-gray-200 bg-gray-50 p-2">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">빠른 작업</p>
        <div className="grid grid-cols-3 gap-1">
          {[
            { label: '벌점 부여', action: () => setActiveModal('penalty'), variant: 'danger' as const },
            { label: '경고 부여', action: () => setActiveModal('warning'), variant: 'warning' as const },
            { label: '출석 처리', action: () => setActiveModal('attendance'), variant: 'default' as const },
            ...(ongoingOuting
              ? [{ label: '외출 종료', action: () => outingMutations.end.mutate(ongoingOuting.id), variant: 'default' as const }]
              : []),
            ...(todayNap?.status === 'ongoing'
              ? [{ label: '파워냅 종료', action: () => napMutations.end.mutate(todayNap.id), variant: 'default' as const }]
              : []),
            { label: '공지 보내기', action: () => setActiveModal('announcement'), variant: 'default' as const },
            { label: '학생 정보', action: () => setActiveModal('student-info'), variant: 'default' as const },
            { label: '신청 내역', action: () => setActiveModal('requests'), variant: 'default' as const },
          ].map((btn) => (
            <button
              key={btn.label}
              type="button"
              onClick={btn.action}
              className={cn(
                'rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors',
                btn.variant === 'danger'
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : btn.variant === 'warning'
                  ? 'bg-orange-50 text-orange-600 hover:bg-orange-100'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 모달들 ── */}

      {/* 벌점 부여 */}
      <Modal open={activeModal === 'penalty'} onClose={() => setActiveModal(null)} title="벌점 부여">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">사유 선택</label>
            <select
              value={penaltyForm.reasonCode}
              onChange={(e) => setPenaltyForm((v) => ({ ...v, reasonCode: e.target.value as PenaltyReasonCode }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">선택하세요</option>
              {(Object.keys(PENALTY_REASON_LABEL) as PenaltyReasonCode[]).map((code) => (
                <option key={code} value={code}>
                  {PENALTY_REASON_LABEL[code]} (+{PENALTY_POINTS[code]}점)
                </option>
              ))}
            </select>
          </div>
          {penaltyForm.reasonCode && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {PENALTY_REASON_LABEL[penaltyForm.reasonCode]} +{PENALTY_POINTS[penaltyForm.reasonCode]}점
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">메모 (선택)</label>
            <input
              type="text"
              value={penaltyForm.desc}
              onChange={(e) => setPenaltyForm((v) => ({ ...v, desc: e.target.value }))}
              placeholder="추가 메모..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setActiveModal(null)}>취소</Button>
            <Button
              className="flex-1"
              disabled={!penaltyForm.reasonCode || createPenaltyMutation.isPending}
              onClick={async () => {
                if (!penaltyForm.reasonCode) return;
                await createPenaltyMutation.mutateAsync({
                  studentId,
                  reasonCode: penaltyForm.reasonCode,
                  adjustmentType: 'add',
                  description: penaltyForm.desc || undefined,
                  createdBy: adminId,
                });
                setPenaltyForm({ reasonCode: '', desc: '' });
                setActiveModal(null);
              }}
            >
              부여
            </Button>
          </div>
        </div>
      </Modal>

      {/* 경고 부여 */}
      <Modal open={activeModal === 'warning'} onClose={() => setActiveModal(null)} title="경고 부여">
        <div className="flex flex-col gap-3">
          <div className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-700">
            경고를 부여하면 학생 경고 횟수가 1 증가합니다. 3회 경고 시 제명 처리됩니다.
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              사유 <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={warningNote}
              onChange={(e) => setWarningNote(e.target.value)}
              placeholder="경고 사유를 입력하세요..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => { setActiveModal(null); setWarningNote(''); }}>취소</Button>
            <Button
              className="flex-1"
              disabled={!warningNote.trim() || warningMutation.isPending}
              onClick={async () => {
                await warningMutation.mutateAsync({ note: warningNote.trim() });
                setWarningNote('');
                setActiveModal(null);
              }}
            >
              경고 부여
            </Button>
          </div>
        </div>
      </Modal>

      {/* 출석 처리 */}
      <Modal open={activeModal === 'attendance'} onClose={() => setActiveModal(null)} title="출석 처리">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">교시</label>
            <select
              value={attendanceForm.periodNumber}
              onChange={(e) => setAttendanceForm((v) => ({ ...v, periodNumber: Number(e.target.value) }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {selectablePeriods.map((p) => (
                <option key={p.period_number} value={p.period_number}>{p.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">상태</label>
            <select
              value={attendanceForm.status}
              onChange={(e) => setAttendanceForm((v) => ({ ...v, status: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="present">출석</option>
              <option value="late">지각</option>
              <option value="absent">결석</option>
              <option value="excused">인정결석</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setActiveModal(null)}>취소</Button>
            <Button
              className="flex-1"
              disabled={upsertAttendanceMutation.isPending}
              onClick={async () => {
                await upsertAttendanceMutation.mutateAsync({
                  studentId,
                  classDate: new Date().toISOString().slice(0, 10),
                  periodNumber: attendanceForm.periodNumber,
                  status: attendanceForm.status,
                });
                setActiveModal(null);
              }}
            >
              처리
            </Button>
          </div>
        </div>
      </Modal>

      {/* 공지 보내기 */}
      <Modal open={activeModal === 'announcement'} onClose={() => setActiveModal(null)} title="공지 보내기">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500">학생 채팅방에 공지 메시지를 전송합니다.</p>
          <textarea
            rows={4}
            value={announcementText}
            onChange={(e) => setAnnouncementText(e.target.value)}
            placeholder="공지 내용을 입력하세요..."
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 resize-none"
          />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => { setActiveModal(null); setAnnouncementText(''); }}>취소</Button>
            <Button
              className="flex-1"
              disabled={!announcementText.trim() || sendMsgMutation.isPending || !roomId}
              onClick={async () => {
                if (!roomId || !announcementText.trim()) return;
                await sendMsgMutation.mutateAsync({
                  senderId: adminId,
                  senderRole: 'admin',
                  content: announcementText.trim(),
                  messageType: 'announcement',
                });
                setAnnouncementText('');
                setActiveModal(null);
              }}
            >
              전송
            </Button>
          </div>
        </div>
      </Modal>

      {/* 학생 정보 */}
      <Modal open={activeModal === 'student-info'} onClose={() => setActiveModal(null)} title="학생 정보">
        <div className="space-y-2">
          {[
            { label: '이름', value: student.name },
            { label: '전화번호', value: student.phone },
            { label: '학교', value: student.school ?? '-' },
            { label: '학년', value: student.grade ?? '-' },
            { label: '학번', value: student.studentNumber ?? '-' },
            { label: '보호자 연락처', value: student.guardianPhone ?? '-' },
            { label: '등록일', value: fmtDateKo(student.enrollmentDate) },
            { label: '이용권 상태', value: student.membershipStatus },
            { label: '벌점', value: `${penaltyProfile?.currentPenaltyPoints ?? 0}점` },
            { label: '경고 횟수', value: `${penaltyProfile?.warningCount ?? 0}회` },
            ...(student.memo ? [{ label: '메모', value: student.memo }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-2">
              <span className="w-24 flex-shrink-0 text-xs text-gray-400">{label}</span>
              <span className="text-xs text-gray-700">{value}</span>
            </div>
          ))}
        </div>
        <Button className="mt-4 w-full" variant="secondary" onClick={() => setActiveModal(null)}>닫기</Button>
      </Modal>

      {/* 최근 신청 내역 */}
      <Modal open={activeModal === 'requests'} onClose={() => setActiveModal(null)} title="최근 신청 내역">
        {!(recentRequests ?? []).length ? (
          <p className="text-sm text-gray-400 text-center py-4">신청 내역이 없습니다</p>
        ) : (
          <div className="space-y-2">
            {(recentRequests ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-gray-100 p-2">
                <div>
                  <p className="text-sm font-medium text-gray-700">{REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}</p>
                  <p className="text-xs text-gray-400">{r.reason}</p>
                  <p className="text-[10px] text-gray-300">{fmtDateKo(r.created_at)}</p>
                </div>
                <Badge tone={REQUEST_STATUS_TONE[r.status] ?? 'default'}>
                  {r.status === 'approved' ? '승인' : r.status === 'rejected' ? '반려' : '대기'}
                </Badge>
              </div>
            ))}
          </div>
        )}
        <Button className="mt-4 w-full" variant="secondary" onClick={() => setActiveModal(null)}>닫기</Button>
      </Modal>
    </div>
  );
}
