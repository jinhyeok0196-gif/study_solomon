import { supabase } from '@/lib/supabase/client';
import type { SeatLayout, MonitorStudentRow, EventLogEntry, SeatStatus } from './types';

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── seat_layouts (DB 타입 미생성 → 직접 정의) ──────────────────────────

interface SeatLayoutRow {
  id: string;
  seat_number: number;
  display_name: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  rotation: number;
  is_active: boolean;
  sort_order: number;
}

export async function fetchSeatLayouts(): Promise<SeatLayout[]> {
  const { data, error } = await supabase
    .from('seat_layouts')
    .select('id, seat_number, display_name, pos_x, pos_y, width, height, rotation, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data as unknown as SeatLayoutRow[]).map((row) => ({
    id: row.id,
    seatNumber: row.seat_number,
    displayName: row.display_name,
    posX: row.pos_x,
    posY: row.pos_y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }));
}

// ── student_profiles + 현황 (seat_number 컬럼은 migration 후 추가됨) ──

interface StudentProfileRow {
  id: string;
  seat_number: number | null;
  membership_status: string;
  current_penalty_points: number;
  warning_count: number;
  users: { name: string } | null;
}

interface OutingRow {
  id: string;
  student_id: string;
  started_at: string;
  status: string;
}

interface PowerNapRow {
  id: string;
  student_id: string;
  started_at: string;
  planned_end_at: string;
  status: string;
}

interface AttendanceRow {
  student_id: string;
  period_number: number;
  status: string;
}

export function deriveStatus(student: MonitorStudentRow): SeatStatus {
  if (student.membershipStatus !== 'active') return 'inactive';
  if (student.ongoingOuting) return 'outing';
  if (student.ongoingPowerNap) return 'power_nap';
  const statuses = student.todayAttendances.map((a) => a.status);
  if (statuses.includes('present')) return 'studying';
  if (statuses.includes('late') && !statuses.includes('present')) return 'late';
  if (statuses.some((s) => s === 'absent' || s === 'excused_absence')) return 'absent';
  return 'not_arrived';
}

export async function fetchMonitorStudents(): Promise<MonitorStudentRow[]> {
  const today = todayDateString();

  const [studentsRes, outingRes, napRes, attendanceRes] = await Promise.all([
    supabase
      .from('student_profiles')
      .select('id, seat_number, membership_status, current_penalty_points, warning_count, users(name)')
      .not('seat_number', 'is', null),
    supabase
      .from('bathroom_logs')
      .select('id, student_id, started_at, status')
      .eq('status', 'ongoing'),
    supabase
      .from('power_nap_logs')
      .select('id, student_id, started_at, planned_end_at, status')
      .eq('status', 'ongoing')
      .eq('nap_date', today),
    supabase
      .from('attendance_records')
      .select('student_id, period_number, status')
      .eq('class_date', today),
  ]);

  if (studentsRes.error) throw studentsRes.error;
  if (outingRes.error) throw outingRes.error;
  if (napRes.error) throw napRes.error;
  if (attendanceRes.error) throw attendanceRes.error;

  const outingMap = new Map(
    (outingRes.data as unknown as OutingRow[]).map((o) => [o.student_id, o])
  );
  const napMap = new Map(
    (napRes.data as unknown as PowerNapRow[]).map((n) => [n.student_id, n])
  );
  const attendanceMap = new Map<string, AttendanceRow[]>();
  (attendanceRes.data as unknown as AttendanceRow[]).forEach((a) => {
    const existing = attendanceMap.get(a.student_id) ?? [];
    existing.push(a);
    attendanceMap.set(a.student_id, existing);
  });

  return (studentsRes.data as unknown as StudentProfileRow[])
    .filter((s) => s.seat_number !== null)
    .map((s) => {
      const outing = outingMap.get(s.id);
      const nap = napMap.get(s.id);
      return {
        id: s.id,
        seatNumber: s.seat_number!,
        studentName: s.users?.name ?? '(알 수 없음)',
        membershipStatus: s.membership_status,
        currentPenaltyPoints: s.current_penalty_points,
        warningCount: s.warning_count,
        ongoingOuting: outing
          ? { id: outing.id, startedAt: outing.started_at }
          : undefined,
        ongoingPowerNap: nap
          ? { id: nap.id, startedAt: nap.started_at, plannedEndAt: nap.planned_end_at }
          : undefined,
        todayAttendances: (attendanceMap.get(s.id) ?? []).map((a) => ({
          periodNumber: a.period_number,
          status: a.status,
        })),
      };
    });
}

// ── 이벤트 로그 ──────────────────────────────────────────────────────────

interface OutingEventRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  student_profiles: { users: { name: string } | null } | null;
}

interface NapEventRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  student_profiles: { users: { name: string } | null } | null;
}

interface PenaltyEventRow {
  id: string;
  points: number;
  created_at: string;
  student_profiles: { users: { name: string } | null } | null;
}

export async function fetchRecentEvents(limit = 40): Promise<EventLogEntry[]> {
  const today = todayDateString();

  const [outingRes, napRes, penaltyRes] = await Promise.all([
    supabase
      .from('bathroom_logs')
      .select('id, started_at, ended_at, status, student_profiles(users(name))')
      .gte('started_at', `${today}T00:00:00+00:00`)
      .order('started_at', { ascending: false })
      .limit(20),
    supabase
      .from('power_nap_logs')
      .select('id, started_at, ended_at, status, student_profiles(users(name))')
      .eq('nap_date', today)
      .order('started_at', { ascending: false })
      .limit(20),
    supabase
      .from('penalty_records')
      .select('id, points, created_at, student_profiles(users(name))')
      .gte('created_at', `${today}T00:00:00+00:00`)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const events: EventLogEntry[] = [];

  for (const row of (outingRes.data as unknown as OutingEventRow[]) ?? []) {
    const name = row.student_profiles?.users?.name ?? '(알 수 없음)';
    events.push({ id: `o-start-${row.id}`, time: row.started_at, studentName: name, type: 'outing_start', label: '외출 시작' });
    if (row.ended_at) {
      events.push({ id: `o-end-${row.id}`, time: row.ended_at, studentName: name, type: 'outing_end', label: '복귀' });
    }
  }

  for (const row of (napRes.data as unknown as NapEventRow[]) ?? []) {
    const name = row.student_profiles?.users?.name ?? '(알 수 없음)';
    events.push({ id: `n-start-${row.id}`, time: row.started_at, studentName: name, type: 'nap_start', label: '파워냅 시작' });
    if (row.ended_at) {
      events.push({ id: `n-end-${row.id}`, time: row.ended_at, studentName: name, type: 'nap_end', label: '파워냅 종료' });
    }
  }

  for (const row of (penaltyRes.data as unknown as PenaltyEventRow[]) ?? []) {
    const name = row.student_profiles?.users?.name ?? '(알 수 없음)';
    events.push({ id: `p-${row.id}`, time: row.created_at, studentName: name, type: 'penalty', label: `벌점 +${row.points}점` });
  }

  return events.sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
}
