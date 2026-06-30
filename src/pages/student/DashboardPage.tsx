import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePeriods } from '@/hooks/usePeriods';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { useScheduleStatus } from '@/hooks/useScheduleStatus';
import { useAttendanceRecordsQuery } from '@/features/attendance/hooks';
import { usePenaltyProfileQuery } from '@/features/penalty/hooks';
import { computeRiskLevel } from '@/features/penalty/risk';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { getWeekStartDate, todayDayOfWeekKey } from '@/features/schedule/dates';
import { STUDENT_PATHS } from '@/routes/paths';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { CurrentPeriodCard } from '@/components/schedule/CurrentPeriodCard';
import { ScheduleTimeline, type SlotRequestStatus } from '@/components/schedule/ScheduleTimeline';
import { StudentStatusBadge } from '@/components/schedule/StudentStatusBadge';
import { ExtraStudyCard } from '@/features/extra-study/components/ExtraStudyCard';
import { ActivityCalendar } from '@/features/activity-calendar/components/ActivityCalendar';
import { NoticeBoard } from '@/features/notices/components/NoticeBoard';
import { BoardSection } from '@/features/board/components/BoardSection';
import { toLocalDateKey } from '@/features/activity-calendar/aggregate';
import { liveStudySecondsFromSchedule, presenceSpanFromRecords } from '@/features/attendance/stats';
import { periodActivityBadges, type ActivityBadge } from '@/components/schedule/activityBadges';
import { useOngoingOutingQuery, useAllOutingsQuery } from '@/features/outing/hooks';
import { useTodayNapQuery, useRecentNapsQuery } from '@/features/powernap/hooks';
import { useAllExtraStudyQuery } from '@/features/extra-study/hooks';
import { useMyRequestsQuery } from '@/features/requests/hooks';

const QUICK_LINKS = [
  { to: STUDENT_PATHS.outing, label: '외출', desc: '교시 중 잠시 자리를 비울 경우 (화장실, 식사, 전화 등)' },
  { to: STUDENT_PATHS.powerNap, label: '파워냅', desc: '교시 중 집중력 회복을 위한 짧은 휴식' },
  { to: STUDENT_PATHS.absenceRequest, label: '결석 신청', desc: '예정된 교시에 참석할 수 없는 경우' },
  { to: STUDENT_PATHS.leaveRequest, label: '조퇴 신청', desc: '학습을 중단하고 귀가할 경우' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const studentId = user!.id;
  const now = useCurrentTime(1000);

  const weekStartDate = getWeekStartDate(0);
  const { data: periods } = usePeriods();
  const { data: attendanceRecords } = useAttendanceRecordsQuery(studentId);
  const { data: penaltyProfile } = usePenaltyProfileQuery(studentId);
  const { data: weekSchedule } = useWeeklyScheduleQuery(studentId, weekStartDate);

  const scheduleStatus = useScheduleStatus(periods, now);
  const { data: ongoingOuting } = useOngoingOutingQuery(studentId);
  const { data: todayNap } = useTodayNapQuery(studentId);
  const isBusyWithOtherActivity = Boolean(ongoingOuting) || Boolean(todayNap && todayNap.status !== 'completed');

  // 오늘 일정은 본인이 신청한 교시만 표시한다 (전체 운영 교시 X).
  const todayPeriodNumbers = useMemo(() => {
    const todayKey = todayDayOfWeekKey();
    return new Set<number>(
      (weekSchedule?.cells ?? [])
        .filter((cell) => cell.dayOfWeek === todayKey)
        .map((cell) => cell.periodNumber)
    );
  }, [weekSchedule]);

  const todayTimeline = useMemo(
    () =>
      scheduleStatus.timeline.filter(
        (slot) => slot.periodNumber != null && todayPeriodNumbers.has(slot.periodNumber)
      ),
    [scheduleStatus.timeline, todayPeriodNumbers]
  );

  const todayKey = toLocalDateKey(now.toISOString());

  // QR 등원(체크인)했고 아직 하원하지 않았는지. 상태 뱃지(미등원/등원/공부중) 판별용.
  const isCheckedIn = useMemo(() => {
    const todayRecords = (attendanceRecords ?? []).filter((r) => r.classDate === todayKey);
    const span = presenceSpanFromRecords(todayRecords);
    return span != null && span.end == null;
  }, [attendanceRecords, todayKey]);

  // 현재 진행 중인 교시가 '본인이 신청한' 수업 교시인지 (= 이미 순공에 집계됨).
  // 신청하지 않은 교시 시간대에는 교시외공부로 직접 기록할 수 있게 카드를 노출한다.
  const isRegisteredClass = useMemo(() => {
    const slot = scheduleStatus.currentSlot;
    return (
      slot?.category === 'class' &&
      slot.periodNumber != null &&
      todayPeriodNumbers.has(slot.periodNumber)
    );
  }, [scheduleStatus.currentSlot, todayPeriodNumbers]);

  const { data: extraLogs } = useAllExtraStudyQuery(studentId);
  const { data: outingLogs } = useAllOutingsQuery(studentId);
  const { data: napLogs } = useRecentNapsQuery(studentId);
  const { data: absenceRequests } = useMyRequestsQuery('absence', studentId);
  const { data: leaveRequests } = useMyRequestsQuery('leave', studentId);

  const allRecords = attendanceRecords ?? [];
  const risk = penaltyProfile ? computeRiskLevel(penaltyProfile.currentPenaltyPoints) : null;

  // 오늘 순공시간은 매초 실시간 계산한다 (now가 의존성에 있어 1초마다 재계산).
  // 교시 구간은 '출결 레코드'가 아니라 '오늘 신청한 수업 교시 시간표'로 만든다 →
  // 아직 레코드가 없는 진행 중 교시(첫 교시 이후)도 재실 중이면 매초 카운팅된다.
  const todayStudySeconds = useMemo(() => {
    const todayRecords = allRecords.filter((r) => r.classDate === todayKey);
    const presence = presenceSpanFromRecords(todayRecords);
    const classIntervals = (periods ?? [])
      .filter((p) => todayPeriodNumbers.has(p.period_number))
      .map((p) => ({
        start: new Date(`${todayKey}T${p.start_time}`).getTime(),
        end: new Date(`${todayKey}T${p.end_time}`).getTime(),
      }))
      .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start);
    const todayExtra = (extraLogs ?? [])
      .filter((e) => e.study_date === todayKey)
      .map((e) => ({ startedAt: e.started_at, endedAt: e.ended_at }));
    const todayAway = [
      ...(outingLogs ?? [])
        .filter((o) => toLocalDateKey(o.started_at) === todayKey)
        .map((o) => ({ startedAt: o.started_at, endedAt: o.ended_at })),
      ...(napLogs ?? [])
        .filter((n) => n.nap_date === todayKey)
        .map((n) => ({ startedAt: n.started_at, endedAt: n.ended_at })),
    ];
    return liveStudySecondsFromSchedule(classIntervals, presence, todayExtra, todayAway, now.getTime());
  }, [allRecords, periods, todayPeriodNumbers, extraLogs, outingLogs, napLogs, todayKey, now]);

  const studyH = Math.floor(todayStudySeconds / 3600);
  const studyM = Math.floor((todayStudySeconds % 3600) / 60);
  const studyS = todayStudySeconds % 60;

  // 오늘 일정 각 교시에 겹치는 외출/파워냅 뱃지 (now 의존 → 진행 중이면 매초 갱신)
  const badgesBySlot = useMemo(() => {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    const baseMs = base.getTime();
    const nowMs = now.getTime();
    const outings = (outingLogs ?? []).map((o) => ({
      startedAt: o.started_at,
      endedAt: o.ended_at,
      reason: o.reason,
    }));
    const naps = (napLogs ?? []).map((n) => ({
      startedAt: n.started_at,
      endedAt: n.ended_at,
      reason: n.reason,
    }));
    const map = new Map<string, ActivityBadge[]>();
    for (const slot of todayTimeline) {
      const badges = periodActivityBadges(
        baseMs + slot.startMinutes * 60000,
        baseMs + slot.endMinutes * 60000,
        outings,
        naps,
        nowMs
      );
      if (badges.length) map.set(slot.id, badges);
    }
    return map;
  }, [todayTimeline, outingLogs, napLogs, now]);

  // 오늘 일정에 반영할 승인된 결석/조퇴 신청 (교시 슬롯별).
  // 승인(approved)이면 해당 교시에 결석/조퇴 표시, 승인취소(pending)되면 자동으로 사라진다.
  const requestStatusBySlot = useMemo(() => {
    const map = new Map<string, SlotRequestStatus>();
    const apply = (
      requests: { requestDate: string; periodNumbers: number[]; reason: string; status: string }[] | undefined,
      kind: SlotRequestStatus['kind']
    ) => {
      for (const req of requests ?? []) {
        if (req.status !== 'approved' || req.requestDate !== todayKey) continue;
        const periodSet = new Set(req.periodNumbers);
        for (const slot of todayTimeline) {
          if (slot.periodNumber != null && periodSet.has(slot.periodNumber)) {
            map.set(slot.id, { kind, reason: req.reason });
          }
        }
      }
    };
    apply(absenceRequests, 'absence');
    apply(leaveRequests, 'leave');
    return map;
  }, [absenceRequests, leaveRequests, todayTimeline, todayKey]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 인사 + 현재 상태 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{user!.name}님, 안녕하세요</h2>
          <p className="text-sm text-gray-500">솔로몬스터디카페</p>
        </div>
        <StudentStatusBadge
          currentSlot={scheduleStatus.currentSlot}
          isCheckedIn={isCheckedIn}
          isRegisteredClass={isRegisteredClass}
        />
      </div>

      {/* 현재 진행 중 + 남은 시간 + 다음 일정 */}
      <CurrentPeriodCard status={scheduleStatus} upcomingAlert={scheduleStatus.upcomingClassAlert} />

      {/* 교시외공부 (본인이 신청한 수업 교시 중이 아니면 노출: 쉬는시간·식사·집 공부 등) */}
      <ExtraStudyCard
        studentId={studentId}
        isRegisteredClass={isRegisteredClass}
        disabled={isBusyWithOtherActivity}
      />

      {/* 통계 */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-gray-500">오늘 순공시간</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">
            {studyH}시간 {studyM}분 {String(studyS).padStart(2, '0')}초
          </p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">현재 벌점</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-gray-900">{penaltyProfile?.currentPenaltyPoints ?? 0}점</p>
            {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
          </div>
        </Card>
      </div>

      {/* 빠른 링크 (버튼 아래 회색 안내 문구) */}
      <div className="grid grid-cols-1 gap-2">
        {QUICK_LINKS.map((link) => {
          // 오늘 파워냅을 이미 사용 완료했으면 '사용완료'로 비활성화
          const napDone = link.to === STUDENT_PATHS.powerNap && todayNap?.status === 'completed';
          if (napDone) {
            return (
              <div
                key={link.to}
                aria-disabled="true"
                className="flex cursor-not-allowed flex-col rounded-md border border-gray-200 bg-gray-100 px-3 py-2.5"
              >
                <span className="text-sm font-medium text-gray-400">{link.label} · 사용완료</span>
                <span className="mt-0.5 text-xs text-gray-400">{link.desc}</span>
              </div>
            );
          }
          return (
            <Link
              key={link.to}
              to={link.to}
              className="flex flex-col rounded-md border border-gray-200 bg-white px-3 py-2.5 hover:border-brand-300"
            >
              <span className="text-sm font-medium text-gray-700">{link.label}</span>
              <span className="mt-0.5 text-xs text-gray-400">{link.desc}</span>
            </Link>
          );
        })}
      </div>

      {/* 오늘 일정 타임라인 (본인이 신청한 교시만) */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-700">오늘 일정</p>
        {todayTimeline.length === 0 ? (
          <EmptyState
            title="오늘 신청한 교시가 없습니다"
            description="시간표에서 오늘 공부할 교시를 신청해보세요."
          />
        ) : (
          <ScheduleTimeline
            timeline={todayTimeline}
            badgesBySlot={badgesBySlot}
            requestStatusBySlot={requestStatusBySlot}
          />
        )}
      </div>

      {/* 공지사항 · 이용수칙 */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-700">공지사항 · 이용수칙</p>
        <NoticeBoard />
      </div>

      {/* 활동 캘린더 (출결·벌점·경고·파워냅 개요 + 날짜별 상세) */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-700">활동 캘린더</p>
        <ActivityCalendar studentId={studentId} />
      </div>

      {/* 불만·건의 게시판 (홈 제일 아래) */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-700">불만·건의 게시판</p>
        <BoardSection />
      </div>
    </div>
  );
}
