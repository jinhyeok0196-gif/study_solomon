import { useMemo } from 'react';
import { useActiveOutingQuery, useActivePowerNapQuery, useTodayAttendanceSummaryQuery } from '@/features/admin-monitor/hooks';
import { useDashboardSummaryQuery } from '@/features/admin-dashboard/hooks';
import { useRealtimeTableSync } from '@/hooks/useRealtimeTableSync';
import { usePeriods } from '@/hooks/usePeriods';
import { useScheduleStatus } from '@/hooks/useScheduleStatus';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { formatElapsed, formatRemaining } from '@/lib/time';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

const OUTING_KEY = ['admin-monitor-outing'];
const POWERNAP_KEY = ['admin-monitor-powernap'];
const ATTENDANCE_KEY = ['admin-monitor-attendance-summary'];
const DASHBOARD_KEY = ['admin-dashboard-summary'];

const OUTING_WARNING_MINUTES = 20;

export default function MonitorPage() {
  const now = useCurrentTime(1000);
  const { data: periods } = usePeriods();
  const scheduleStatus = useScheduleStatus(periods, now);

  const { data: outing, isLoading: outingLoading } = useActiveOutingQuery();
  const { data: powerNap, isLoading: powerNapLoading } = useActivePowerNapQuery();
  const { data: attendanceSummary } = useTodayAttendanceSummaryQuery();
  const { data: summary } = useDashboardSummaryQuery();

  useRealtimeTableSync('bathroom_logs', [OUTING_KEY, DASHBOARD_KEY]);
  useRealtimeTableSync('power_nap_logs', [POWERNAP_KEY, DASHBOARD_KEY]);
  useRealtimeTableSync('attendance_records', [ATTENDANCE_KEY, DASHBOARD_KEY]);

  const currentTimeStr = useMemo(
    () =>
      now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    [now]
  );

  const currentDateStr = useMemo(
    () =>
      now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
    [now]
  );

  const summaryCards = [
    { label: '착석 중', value: summary?.presentNowCount ?? 0, color: 'text-green-600', bg: 'bg-green-50' },
    { label: '외출 중', value: summary?.outingNowCount ?? 0, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: '파워냅 중', value: summary?.powerNapNowCount ?? 0, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: '오늘 결석', value: attendanceSummary?.absentCount ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
    { label: '오늘 지각', value: attendanceSummary?.lateCount ?? 0, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: '오늘 출석', value: attendanceSummary?.presentCount ?? 0, color: 'text-blue-600', bg: 'bg-blue-50' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">실시간 관제</h2>
          <p className="text-sm text-gray-500">{currentDateStr}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold text-brand-700">{currentTimeStr}</p>
          {scheduleStatus.currentSlot ? (
            <p className="text-sm text-gray-600">
              현재:{' '}
              <span className="font-medium" style={{ color: scheduleStatus.currentSlot.displayColor }}>
                {scheduleStatus.currentSlot.label}
              </span>
              {scheduleStatus.currentSlot.category === 'class' && (
                <span className="ml-1 text-gray-400">
                  (잔여 {Math.floor(scheduleStatus.remainingSeconds / 60)}분)
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-gray-400">교시 외 시간</p>
          )}
          {scheduleStatus.nextSlot && (
            <p className="text-xs text-gray-400">다음: {scheduleStatus.nextSlot.label}</p>
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {summaryCards.map((card) => (
          <Card key={card.label} className={cn('text-center', card.bg)}>
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={cn('text-2xl font-bold', card.color)}>{card.value}</p>
            <p className="text-xs text-gray-400">명</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 외출 중 학생 */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-400" />
            외출 중 학생
            <Badge tone="warning">{outing?.length ?? 0}명</Badge>
          </h3>
          {outingLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : !outing || outing.length === 0 ? (
            <Card>
              <p className="py-4 text-center text-sm text-gray-400">외출 중인 학생이 없습니다</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {outing.map((row) => {
                const elapsedSec = Math.floor((now.getTime() - new Date(row.startedAt).getTime()) / 1000);
                const elapsedMin = Math.floor(elapsedSec / 60);
                const isWarning = elapsedMin >= OUTING_WARNING_MINUTES;
                return (
                  <Card key={row.id} className={cn(isWarning && 'border-orange-300 bg-orange-50')}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{row.studentName}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(row.startedAt).toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                          에 출발
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn('font-mono text-lg font-bold', isWarning ? 'text-orange-600' : 'text-gray-700')}>
                          {formatElapsed(row.startedAt, now)}
                        </p>
                        {isWarning && (
                          <Badge tone="warning" className="text-xs">
                            장시간 외출
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* 파워냅 중 학생 */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-400" />
            파워냅 중 학생
            <Badge>{powerNap?.length ?? 0}명</Badge>
          </h3>
          {powerNapLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : !powerNap || powerNap.length === 0 ? (
            <Card>
              <p className="py-4 text-center text-sm text-gray-400">파워냅 중인 학생이 없습니다</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {powerNap.map((row) => {
                const isOverdue = now > new Date(row.plannedEndAt);
                return (
                  <Card key={row.id} className={cn(isOverdue && 'border-red-300 bg-red-50')}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{row.studentName}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(row.startedAt).toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                          시작 →{' '}
                          {new Date(row.plannedEndAt).toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                          까지
                        </p>
                      </div>
                      <div className="text-right">
                        {isOverdue ? (
                          <>
                            <p className="font-mono text-lg font-bold text-red-600">
                              +{formatElapsed(row.plannedEndAt, now)}
                            </p>
                            <Badge tone="danger" className="text-xs">
                              초과
                            </Badge>
                          </>
                        ) : (
                          <p className="font-mono text-lg font-bold text-purple-600">
                            {formatRemaining(row.plannedEndAt, now)}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 오늘 출결 현황 상세 */}
      {attendanceSummary && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">오늘 출결 현황</h3>
          <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
            {[
              { label: '출석', value: attendanceSummary.presentCount, tone: 'success' as const },
              { label: '지각', value: attendanceSummary.lateCount, tone: 'warning' as const },
              { label: '결석', value: attendanceSummary.absentCount, tone: 'danger' as const },
              { label: '조퇴', value: attendanceSummary.earlyLeaveCount, tone: 'warning' as const },
              { label: '공결', value: attendanceSummary.excusedAbsenceCount, tone: 'default' as const },
              { label: '공조퇴', value: attendanceSummary.excusedEarlyLeaveCount, tone: 'default' as const },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <Badge tone={item.tone}>{item.label}</Badge>
                <p className="mt-1 text-xl font-bold text-gray-800">{item.value}</p>
                <p className="text-xs text-gray-400">명</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
