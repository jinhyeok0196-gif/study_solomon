import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

const MONITOR_STUDENTS_KEY = ['admin-monitor-students'];
const EVENT_LOG_KEY = ['admin-monitor-events'];
const DASHBOARD_KEY = ['admin-dashboard-summary'];

export function useMonitorRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const invalidateAll = () => {
      qc.invalidateQueries({ queryKey: MONITOR_STUDENTS_KEY });
      qc.invalidateQueries({ queryKey: EVENT_LOG_KEY });
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
    };

    const invalidateStudents = () => {
      qc.invalidateQueries({ queryKey: MONITOR_STUDENTS_KEY });
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
    };

    const channel = supabase
      .channel('monitor-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bathroom_logs' }, invalidateAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'power_nap_logs' }, invalidateAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, invalidateStudents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_study_logs' }, invalidateStudents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'penalty_records' }, () => {
        qc.invalidateQueries({ queryKey: EVENT_LOG_KEY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_profiles' }, invalidateStudents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_layouts' }, () => {
        qc.invalidateQueries({ queryKey: ['seat-layouts'] });
        qc.invalidateQueries({ queryKey: MONITOR_STUDENTS_KEY });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
