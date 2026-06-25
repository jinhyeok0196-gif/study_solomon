import { supabase } from '@/lib/supabase/client';

export interface AttendanceRecordWithPeriod {
  classDate: string;
  periodNumber: number;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  periodStartTime: string;
  periodEndTime: string;
}

export async function fetchAttendanceRecords(studentId: string): Promise<AttendanceRecordWithPeriod[]> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('class_date, period_number, status, checked_in_at, checked_out_at, periods(start_time, end_time)')
    .eq('student_id', studentId)
    .order('class_date', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((record) => ({
    classDate: record.class_date,
    periodNumber: record.period_number,
    status: record.status,
    checkedInAt: record.checked_in_at,
    checkedOutAt: record.checked_out_at,
    periodStartTime: record.periods?.start_time ?? '00:00:00',
    periodEndTime: record.periods?.end_time ?? '00:00:00',
  }));
}
