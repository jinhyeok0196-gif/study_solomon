import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { ATTENDANCE_STATUS_LABEL } from '@/features/attendance/labels';
import { PENALTY_REASON_LABEL, type PenaltyReasonCode } from '@/constants/penaltyRules';
import { useAttendanceRecordsQuery } from '@/features/attendance/hooks';
import { usePenaltyRecordsQuery, useWarningRecordsQuery } from '@/features/penalty/hooks';
import { useRecentNapsQuery } from '@/features/powernap/hooks';
import { attendanceTone, buildActivityMap, type DayActivity } from '../aggregate';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function fmtTime(iso: string | null): string {
  return iso ? format(new Date(iso), 'HH:mm') : '-';
}

function Dot({ className }: { className: string }) {
  return <span className={cn('h-1.5 w-1.5 rounded-full', className)} />;
}

function SectionCard({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', color)} />
        <p className="text-sm font-semibold text-gray-700">{title}</p>
      </div>
      <div className="flex flex-col gap-1.5 text-sm text-gray-600">{children}</div>
    </div>
  );
}

interface Props {
  studentId: string;
}

export function ActivityCalendar({ studentId }: Props) {
  const { data: attendance } = useAttendanceRecordsQuery(studentId);
  const { data: penalties } = usePenaltyRecordsQuery(studentId);
  const { data: warnings } = useWarningRecordsQuery(studentId);
  const { data: naps } = useRecentNapsQuery(studentId);

  const [month, setMonth] = useState<Date>(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string>(() => dateKey(new Date()));

  const activityMap = useMemo(
    () => buildActivityMap(attendance ?? [], penalties ?? [], warnings ?? [], naps ?? []),
    [attendance, penalties, warnings, naps]
  );

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const selected: DayActivity | undefined = activityMap.get(selectedKey);
  const selectedDate = useMemo(() => new Date(`${selectedKey}T00:00:00`), [selectedKey]);

  return (
    <Card>
      {/* 월 이동 헤더 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setMonth((m) => subMonths(m, 1))}
          className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100"
          aria-label="이전 달"
        >
          ‹
        </button>
        <p className="text-sm font-bold text-gray-800">{format(month, 'yyyy년 M월')}</p>
        <button
          onClick={() => setMonth((m) => addMonths(m, 1))}
          className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100"
          aria-label="다음 달"
        >
          ›
        </button>
      </div>

      {/* 요일 */}
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-gray-400">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = dateKey(day);
          const act = activityMap.get(key);
          const inMonth = isSameMonth(day, month);
          const isSelected = key === selectedKey;
          const isToday = isSameDay(day, new Date());
          const tone = act ? attendanceTone(act.attendance) : null;

          return (
            <button
              key={key}
              onClick={() => setSelectedKey(key)}
              className={cn(
                'flex h-12 flex-col items-center justify-start rounded-md border py-1 transition-colors',
                isSelected ? 'border-brand-500 bg-brand-50' : 'border-transparent hover:bg-gray-50',
                tone === 'absent' && !isSelected && 'bg-red-50',
                !inMonth && 'opacity-40'
              )}
            >
              <span
                className={cn(
                  'text-xs',
                  isToday ? 'font-bold text-brand-600' : 'text-gray-700'
                )}
              >
                {format(day, 'd')}
              </span>
              {act && (
                <span className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5">
                  {tone && (
                    <Dot
                      className={cn(
                        tone === 'absent' && 'bg-red-500',
                        tone === 'late' && 'bg-amber-500',
                        tone === 'present' && 'bg-emerald-500'
                      )}
                    />
                  )}
                  {act.penalties.length > 0 && <Dot className="bg-rose-600" />}
                  {act.warnings.length > 0 && <Dot className="bg-orange-600" />}
                  {act.naps.length > 0 && <Dot className="bg-purple-500" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <Dot className="bg-emerald-500" /> 출석
        </span>
        <span className="flex items-center gap-1">
          <Dot className="bg-amber-500" /> 지각
        </span>
        <span className="flex items-center gap-1">
          <Dot className="bg-red-500" /> 결석
        </span>
        <span className="flex items-center gap-1">
          <Dot className="bg-rose-600" /> 벌점
        </span>
        <span className="flex items-center gap-1">
          <Dot className="bg-orange-600" /> 경고
        </span>
        <span className="flex items-center gap-1">
          <Dot className="bg-purple-500" /> 파워냅
        </span>
      </div>

      {/* 선택한 날짜 상세 (카테고리별) */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="mb-2 text-sm font-bold text-gray-800">
          {format(selectedDate, 'M월 d일 (EEE)', { locale: ko })}
        </p>

        {!selected ||
        (selected.attendance.length === 0 &&
          selected.penalties.length === 0 &&
          selected.warnings.length === 0 &&
          selected.naps.length === 0) ? (
          <p className="py-4 text-center text-sm text-gray-400">기록이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {selected.attendance.length > 0 && (
              <SectionCard title="출결" color="bg-emerald-500">
                {[...selected.attendance]
                  .sort((a, b) => a.periodNumber - b.periodNumber)
                  .map((a) => (
                    <div key={a.periodNumber} className="flex items-center justify-between">
                      <span>
                        {a.periodNumber}교시 ·{' '}
                        <b className="text-gray-700">
                          {ATTENDANCE_STATUS_LABEL[a.status] ?? a.status}
                        </b>
                      </span>
                      {(a.checkedInAt || a.checkedOutAt) && (
                        <span className="text-xs text-gray-400">
                          {fmtTime(a.checkedInAt)}
                          {a.checkedOutAt ? ` ~ ${fmtTime(a.checkedOutAt)}` : ''}
                        </span>
                      )}
                    </div>
                  ))}
              </SectionCard>
            )}

            {selected.penalties.length > 0 && (
              <SectionCard title="벌점" color="bg-rose-600">
                {selected.penalties.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <span>
                      {PENALTY_REASON_LABEL[p.reason_code as PenaltyReasonCode] ?? p.reason_code}
                      {p.description ? (
                        <span className="text-xs text-gray-400"> · {p.description}</span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        'flex-shrink-0 font-semibold',
                        p.adjustment_type === 'subtract' ? 'text-blue-600' : 'text-rose-600'
                      )}
                    >
                      {p.adjustment_type === 'subtract' ? '-' : '+'}
                      {p.points}점
                    </span>
                  </div>
                ))}
              </SectionCard>
            )}

            {selected.warnings.length > 0 && (
              <SectionCard title="경고" color="bg-orange-600">
                {selected.warnings.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2">
                    <span>
                      <b className="text-gray-700">
                        {w.warning_level >= 3 ? '퇴원' : `${w.warning_level}차 경고`}
                      </b>
                      {w.note ? <span className="text-xs text-gray-400"> · {w.note}</span> : null}
                    </span>
                    <span className="flex-shrink-0 text-xs text-gray-400">
                      누적 {w.triggered_penalty_total}점
                    </span>
                  </div>
                ))}
              </SectionCard>
            )}

            {selected.naps.length > 0 && (
              <SectionCard title="파워냅" color="bg-purple-500">
                {selected.naps.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-2">
                    <span>
                      {fmtTime(n.started_at)}
                      {n.ended_at ? ` ~ ${fmtTime(n.ended_at)}` : ' ~ 진행 중'}
                    </span>
                    {n.is_unauthorized && (
                      <span className="flex-shrink-0 text-xs font-medium text-rose-600">무단</span>
                    )}
                  </div>
                ))}
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
