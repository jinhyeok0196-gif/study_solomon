import { useQuery } from '@tanstack/react-query';
import { fetchAttendanceRecords } from './api';

export function useAttendanceRecordsQuery(studentId: string) {
  return useQuery({
    queryKey: ['attendance-records', studentId],
    queryFn: () => fetchAttendanceRecords(studentId),
  });
}
