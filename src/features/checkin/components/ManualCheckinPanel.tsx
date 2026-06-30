import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePeriods } from '@/hooks/usePeriods';
import { useStudentsQuery } from '@/features/admin-students/hooks';
import { fetchAttendanceForDate } from '@/features/admin-attendance/api';
import { fetchStudentWeekScheduleCells } from '@/features/chat/studentPanelApi';
import { getWeekStartDate } from '@/features/schedule/dates';
import { adminCheckinStudent } from '../api';
import { cn } from '@/lib/utils';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function ManualCheckinPanel() {
  const qc = useQueryClient();
  const { data: students } = useStudentsQuery();
  const { data: periods } = usePeriods();

  const today = new Date().toISOString().slice(0, 10);
  const todayDow = DAY_KEYS[new Date().getDay()];
  const weekStart = getWeekStartDate(0);

  const attendanceKey = ['attendance-today', today];
  const { data: todayAttendance } = useQuery({
    queryKey: attendanceKey,
    queryFn: () => fetchAttendanceForDate(today),
    refetchInterval: 15000,
  });

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const checkedInIds = useMemo(
    () => new Set((todayAttendance ?? []).filter((a) => a.checked_in_at).map((a) => a.student_id)),
    [todayAttendance]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (students ?? []).filter(
      (s) => !q || s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q)
    );
    // 미등원 학생을 위로
    return list.sort((a, b) => {
      const ai = checkedInIds.has(a.id) ? 1 : 0;
      const bi = checkedInIds.has(b.id) ? 1 : 0;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
  }, [students, search, checkedInIds]);

  async function handleCheckin(studentId: string) {
    setBusyId(studentId);
    try {
      const { cells } = await fetchStudentWeekScheduleCells(studentId, weekStart);
      const periodNums = new Set(
        cells.filter((c) => c.day_of_week === todayDow).map((c) => c.period_number)
      );
      const candidate = (periods ?? [])
        .filter((p) => periodNums.has(p.period_number) && p.category === 'class')
        .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
      if (!candidate) {
        window.alert('이 학생은 오늘 신청한 교시가 없어 등원 처리할 수 없습니다.');
        return;
      }
      await adminCheckinStudent({ studentId, classDate: today, periodNumber: candidate.period_number });
      await qc.invalidateQueries({ queryKey: attendanceKey });
    } catch {
      window.alert('등원 처리 중 오류가 발생했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  const notCheckedInCount = (students ?? []).filter((s) => !checkedInIds.has(s.id)).length;

  return (
    <div className="flex w-full flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-gray-800">수동 등원 처리</h2>
        <span className="text-xs text-gray-400">미등원 {notCheckedInCount}명</span>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        QR을 못 찍은 학생을 직접 등원 처리합니다. (오늘 신청한 첫 교시에 등원 기록 → 순공시간 집계 시작)
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="이름·전화번호 검색"
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="flex max-h-[460px] flex-col gap-1.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">학생이 없습니다</p>
        ) : (
          filtered.map((s) => {
            const checkedIn = checkedInIds.has(s.id);
            return (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{s.name}</p>
                  <p className="truncate text-[11px] text-gray-400">{s.phone}</p>
                </div>
                {checkedIn ? (
                  <span className="flex-shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-600">
                    ✓ 등원완료
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCheckin(s.id)}
                    disabled={busyId === s.id}
                    className={cn(
                      'flex-shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50'
                    )}
                  >
                    {busyId === s.id ? '처리 중...' : '등원 처리'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
