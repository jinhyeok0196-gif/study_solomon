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
import { ScheduleTimeline } from '@/components/schedule/ScheduleTimeline';
import { StudentStatusBadge } from '@/components/schedule/StudentStatusBadge';
import { ExtraStudyCard } from '@/features/extra-study/components/ExtraStudyCard';
import { ActivityCalendar } from '@/features/activity-calendar/components/ActivityCalendar';
import { toLocalDateKey } from '@/features/activity-calendar/aggregate';
import { studySecondsForDay } from '@/features/attendance/stats';
import { useOngoingOutingQuery, useAllOutingsQuery } from '@/features/outing/hooks';
import { useTodayNapQuery, useRecentNapsQuery } from '@/features/powernap/hooks';
import { useAllExtraStudyQuery } from '@/features/extra-study/hooks';

const QUICK_LINKS = [
  { to: STUDENT_PATHS.outing, label: '외출' },
  { to: STUDENT_PATHS.powerNap, label: '파워냅' },
  { to: STUDENT_PATHS.absenceRequest, label: '결석 신청' },
  { to: STUDENT_PATHS.leaveRequest, label: '조퇴 신청' },
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

  const { data: extraLogs } = useAllExtraStudyQuery(studentId);
  const { data: outingLogs } = useAllOutingsQuery(studentId);
  const { data: napLogs } = useRecentNapsQuery(studentId);

  const allRecords = attendanceRecords ?? [];
  const risk = penaltyProfile ? computeRiskLevel(penaltyProfile.currentPenaltyPoints) : null;

  const todayKey = toLocalDateKey(now.toISOString());
  // 오늘 순공시간은 매초 실시간 계산한다 (now가 의존성에 있어 1초마다 재계산).
  const todayStudySeconds = useMemo(() => {
    const todayRecords = allRecords.filter((r) => r.classDate === todayKey);
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
    return studySecondsForDay(todayRecords, todayExtra, todayAway, now.getTime());
  }, [allRecords, extraLogs, outingLogs, napLogs, todayKey, now]);

  const studyH = Math.floor(todayStudySeconds / 3600);
  const studyM = Math.floor((todayStudySeconds % 3600) / 60);
  const studyS = todayStudySeconds % 60;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 인사 + 현재 상태 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{user!.name}님, 안녕하세요</h2>
          <p className="text-sm text-gray-500">솔로몬스터디카페</p>
        </div>
        <StudentStatusBadge currentSlot={scheduleStatus.currentSlot} />
      </div>

      {/* 현재 진행 중 + 남은 시간 + 다음 일정 */}
      <CurrentPeriodCard status={scheduleStatus} upcomingAlert={scheduleStatus.upcomingClassAlert} />

      {/* 교시외공부 (쉬는시간/식사시간 등 비수업 시간에만 노출) */}
      <ExtraStudyCard
        studentId={studentId}
        currentSlot={scheduleStatus.currentSlot}
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

      {/* 빠른 링크 */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center justify-center rounded-md border border-gray-200 bg-white py-3 text-xs font-medium text-gray-700 hover:border-brand-300"
          >
            {link.label}
          </Link>
        ))}
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
          <ScheduleTimeline timeline={todayTimeline} />
        )}
      </div>

      {/* 활동 캘린더 (출결·벌점·경고·파워냅 개요 + 날짜별 상세) */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-700">활동 캘린더</p>
        <ActivityCalendar studentId={studentId} />
      </div>
    </div>
  );
}
