import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

export async function fetchAttendanceForDate(date: string): Promise<Tables<'attendance_records'>[]> {
  const { data, error } = await supabase.from('attendance_records').select('*').eq('class_date', date);
  if (error) throw error;
  return data ?? [];
}

export async function upsertAttendance(params: {
  studentId: string;
  classDate: string;
  periodNumber: number;
  status: string;
}): Promise<void> {
  const { error } = await supabase
    .from('attendance_records')
    .upsert(
      {
        student_id: params.studentId,
        class_date: params.classDate,
        period_number: params.periodNumber,
        status: params.status,
        source: 'admin',
      },
      { onConflict: 'student_id,class_date,period_number' }
    );
  if (error) throw error;
}
