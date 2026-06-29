import { supabase } from '@/lib/supabase/client';
import { getWeekStartDate, todayDayOfWeekKey } from '@/features/schedule/dates';

export interface DashboardSummary {
  totalStudents: number;
  activeStudents: number;
  expectedTodayCount: number;
  presentNowCount: number;
  outingNowCount: number;
  powerNapNowCount: number;
  absentTodayCount: number;
  lateTodayCount: number;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function countDistinct(rows: { student_id: string }[]): number {
  return new Set(rows.map((row) => row.student_id)).size;
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const today = todayDateString();
  const weekStartDate = getWeekStartDate(0);
  const todayKey = todayDayOfWeekKey();

  const [
    totalStudentsResult,
    activeStudentsResult,
    expectedTodayResult,
    outingNowResult,
    powerNapNowResult,
    todayAttendanceResult,
  ] = await Promise.all([
    supabase.from('student_profiles').select('id', { count: 'exact', head: true }),
    supabase
      .from('student_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('membership_status', 'active'),
    supabase
      .from('schedule_items')
      .select('weekly_schedules!inner(student_id, week_start_date)')
      .eq('day_of_week', todayKey)
      .eq('weekly_schedules.week_start_date', weekStartDate),
    supabase.from('bathroom_logs').select('id', { count: 'exact', head: true }).eq('status', 'ongoing'),
    supabase
      .from('power_nap_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ongoing')
      .eq('nap_date', today),
    supabase.from('attendance_records').select('student_id, status').eq('class_date', today),
  ]);

  if (totalStudentsResult.error) throw totalStudentsResult.error;
  if (activeStudentsResult.error) throw activeStudentsResult.error;
  if (expectedTodayResult.error) throw expectedTodayResult.error;
  if (outingNowResult.error) throw outingNowResult.error;
  if (powerNapNowResult.error) throw powerNapNowResult.error;
  if (todayAttendanceResult.error) throw todayAttendanceResult.error;

  const expectedStudentIds = new Set(
    (expectedTodayResult.data as unknown as { weekly_schedules: { student_id: string } }[]).map(
      (row) => row.weekly_schedules.student_id
    )
  );

  const todayRecords = todayAttendanceResult.data ?? [];
  const presentToday = countDistinct(todayRecords.filter((r) => r.status === 'present' || r.status === 'late'));
  const absentToday = countDistinct(todayRecords.filter((r) => r.status === 'absent' || r.status === 'excused_absence'));
  const lateToday = countDistinct(todayRecords.filter((r) => r.status === 'late'));

  const outingNowCount = outingNowResult.count ?? 0;
  const powerNapNowCount = powerNapNowResult.count ?? 0;

  return {
    totalStudents: totalStudentsResult.count ?? 0,
    activeStudents: activeStudentsResult.count ?? 0,
    expectedTodayCount: expectedStudentIds.size,
    presentNowCount: Math.max(0, presentToday - outingNowCount - powerNapNowCount),
    outingNowCount,
    powerNapNowCount,
    absentTodayCount: absentToday,
    lateTodayCount: lateToday,
  };
}
