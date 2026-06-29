import { useState, useMemo, useCallback } from 'react';
import {
  useSeatLayoutsQuery,
  useMonitorStudentsQuery,
  useEventLogQuery,
  useSeatAssignMutations,
} from '@/features/admin-monitor/hooks';
import { useMonitorRealtime } from '@/features/admin-monitor/useMonitorRealtime';
import { useDashboardSummaryQuery } from '@/features/admin-dashboard/hooks';
import { useChatRoomQuery } from '@/features/chat/hooks';
import { usePeriods } from '@/hooks/usePeriods';
import { useScheduleStatus } from '@/hooks/useScheduleStatus';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { deriveStatus } from '@/features/admin-monitor/api';
import { StudentStatusPanel } from '@/features/chat/components/StudentStatusPanel';
import { SeatGrid } from '@/features/admin-monitor/components/SeatGrid';
import { EventLog } from '@/features/admin-monitor/components/EventLog';
import { MiniChat } from '@/features/admin-monitor/components/MiniChat';
import { SeatAssignModal } from '@/features/admin-monitor/components/SeatAssignModal';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { SeatData } from '@/features/admin-monitor/types';

const SUMMARY_ITEMS = [
  { key: 'presentNowCount', label: '착석', bg: 'bg-green-50', text: 'text-green-700' },
  { key: 'outingNowCount', label: '외출', bg: 'bg-orange-50', text: 'text-orange-700' },
  { key: 'powerNapNowCount', label: '파워냅', bg: 'bg-purple-50', text: 'text-purple-700' },
  { key: 'absentTodayCount', label: '결석', bg: 'bg-red-50', text: 'text-red-600' },
  { key: 'lateTodayCount', label: '지각', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  { key: 'totalStudents', label: '전체', bg: 'bg-gray-50', text: 'text-gray-700' },
] as const;

function StudentRoomBridge({ studentId }: { studentId: string }) {
  const { data: roomId } = useChatRoomQuery(studentId);
  return (
    <StudentStatusPanel
      studentId={studentId}
      roomId={roomId ?? null}
      className="flex-1 overflow-hidden border-b border-gray-100"
    />
  );
}

interface SeatActionBarProps {
  seatLabel: string | null;
  studentName: string;
  onUnassign: () => void;
  isUnassigning: boolean;
}

function SeatActionBar({ seatLabel, studentName, onUnassign, isUnassigning }: SeatActionBarProps) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-1.5">
      <span className="text-xs text-gray-500">
        <span className="font-semibold text-gray-700">{studentName}</span>
        {seatLabel && <span className="ml-1 text-gray-400">· {seatLabel}석</span>}
      </span>
      <button
        type="button"
        onClick={onUnassign}
        disabled={isUnassigning}
        className="rounded-md px-2 py-0.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        좌석 해제
      </button>
    </div>
  );
}

export default function MonitorPage() {
  const now = useCurrentTime(1000);
  const { data: periods } = usePeriods();
  const scheduleStatus = useScheduleStatus(periods, now);

  const { data: seatLayouts, isLoading: seatsLoading } = useSeatLayoutsQuery();
  const { data: monitorStudents, isLoading: studentsLoading } = useMonitorStudentsQuery();
  const { data: events } = useEventLogQuery();
  const { data: summary } = useDashboardSummaryQuery();

  useMonitorRealtime();

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [assignSeat, setAssignSeat] = useState<{ seatNumber: number; label: string } | null>(null);
  const { unassign } = useSeatAssignMutations();

  const currentSlotCategory = scheduleStatus.currentSlot?.category;
  const seatDataList: SeatData[] = useMemo(() => {
    if (!seatLayouts) return [];
    const studentMap = new Map((monitorStudents ?? []).map((s) => [s.seatNumber, s]));
    return seatLayouts.map((seat) => {
      const student = studentMap.get(seat.seatNumber) ?? null;
      const status = student ? deriveStatus(student, currentSlotCategory) : 'empty';
      return { seat, student, status };
    });
  }, [seatLayouts, monitorStudents, currentSlotCategory]);

  const handleSeatClick = useCallback(
    (studentId: string | null, seatNumber: number) => {
      if (studentId === null) {
        // 빈 좌석 → 학생 배정 모달
        const seat = seatLayouts?.find((s) => s.seatNumber === seatNumber);
        setAssignSeat({ seatNumber, label: seat?.displayName ?? `${seatNumber}번` });
        return;
      }
      setSelectedStudentId((prev) => (prev === studentId ? null : studentId));
    },
    [seatLayouts]
  );

  const selectedSeat = useMemo(
    () => seatDataList.find((sd) => sd.student?.id === selectedStudentId) ?? null,
    [seatDataList, selectedStudentId]
  );

  const currentSlotLabel = scheduleStatus.currentSlot?.label ?? null;
  const remainingSeconds = scheduleStatus.remainingSeconds;

  const currentTimeStr = useMemo(
    () =>
      now.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [now]
  );

  const currentDateStr = useMemo(
    () => now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }),
    [now]
  );

  const isLoading = seatsLoading || studentsLoading;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* ── 상단 요약 바 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-700">실시간 관제</h2>
          <span className="text-xs text-gray-400">{currentDateStr}</span>
          {/* 현재 교시 */}
          {scheduleStatus.currentSlot && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: scheduleStatus.currentSlot.displayColor }}
            >
              {scheduleStatus.currentSlot.label}
              {scheduleStatus.currentSlot.category === 'class' && remainingSeconds > 0
                ? ` · ${Math.floor(remainingSeconds / 60)}분`
                : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 요약 카운트 */}
          {summary &&
            SUMMARY_ITEMS.map((item) => (
              <div
                key={item.key}
                className={cn('rounded-lg px-2.5 py-1 text-center', item.bg)}
              >
                <span className={cn('text-sm font-bold', item.text)}>
                  {summary[item.key]}
                </span>
                <span className="ml-0.5 text-[10px] text-gray-500">{item.label}</span>
              </div>
            ))}
          {/* 시계 */}
          <span className="font-mono text-lg font-bold text-brand-700 tabular-nums ml-2">
            {currentTimeStr}
          </span>
        </div>
      </div>

      {/* ── 메인 콘텐츠 ── */}
      <div className="flex flex-1 gap-3 overflow-hidden min-h-0">
        {/* 좌석 배치 (메인) */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : seatDataList.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-gray-500">좌석 배치 정보가 없습니다</p>
              <p className="text-xs text-gray-400">
                seat_layouts 마이그레이션(20260702)이 적용되면
                <br />
                좌석이 표시되고, 빈 좌석을 클릭해 학생을 배정할 수 있습니다.
              </p>
            </div>
          ) : (
            <SeatGrid
              seats={seatDataList}
              selectedStudentId={selectedStudentId}
              onSeatClick={handleSeatClick}
              now={now}
              currentSlotLabel={currentSlotLabel}
              remainingSeconds={remainingSeconds}
            />
          )}
        </div>

        {/* 우측 패널 */}
        <div className="hidden w-80 flex-shrink-0 flex-col gap-3 overflow-hidden lg:flex">
          {selectedStudentId ? (
            <>
              {/* 선택된 학생 패널 */}
              <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white min-h-0">
                <SeatActionBar
                  seatLabel={selectedSeat?.seat.displayName ?? null}
                  studentName={selectedSeat?.student?.studentName ?? ''}
                  isUnassigning={unassign.isPending}
                  onUnassign={() => {
                    unassign.mutate(selectedStudentId);
                    setSelectedStudentId(null);
                  }}
                />
                {/* 학생 상태 패널 (스크롤 가능) */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  <StudentRoomBridge studentId={selectedStudentId} />
                </div>
                {/* 채팅 (하단 고정) */}
                <MiniChat studentId={selectedStudentId} />
              </div>
            </>
          ) : (
            <div className="flex flex-col rounded-lg border border-gray-100 bg-white/50 p-4">
              <p className="text-center text-xs text-gray-400">
                좌석을 클릭하면
                <br />
                학생 상태와 채팅이 표시됩니다
              </p>
            </div>
          )}

          {/* 이벤트 로그 */}
          <div className="flex-shrink-0">
            <EventLog events={events ?? []} />
          </div>
        </div>
      </div>

      {/* 모바일: 선택된 학생 패널 오버레이 */}
      {selectedStudentId && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSelectedStudentId(null)}
          />
          <div className="relative z-50 flex w-full max-h-[85vh] flex-col rounded-t-2xl bg-white overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <p className="text-sm font-semibold text-gray-700">학생 정보</p>
              <button
                type="button"
                onClick={() => setSelectedStudentId(null)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            <SeatActionBar
              seatLabel={selectedSeat?.seat.displayName ?? null}
              studentName={selectedSeat?.student?.studentName ?? ''}
              isUnassigning={unassign.isPending}
              onUnassign={() => {
                unassign.mutate(selectedStudentId);
                setSelectedStudentId(null);
              }}
            />
            <div className="flex-1 overflow-y-auto min-h-0">
              <StudentRoomBridge studentId={selectedStudentId} />
            </div>
            <MiniChat studentId={selectedStudentId} />
          </div>
        </div>
      )}

      {/* 좌석 배정 모달 */}
      <SeatAssignModal
        open={assignSeat !== null}
        seatNumber={assignSeat?.seatNumber ?? null}
        seatLabel={assignSeat?.label ?? ''}
        onClose={() => setAssignSeat(null)}
      />
    </div>
  );
}
