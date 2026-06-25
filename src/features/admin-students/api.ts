import { supabase } from '@/lib/supabase/client';
import type { CreateStudentInput, StudentSummary, UpdateStudentInput } from './types';

interface StudentProfileJoinRow {
  id: string;
  student_number: string | null;
  school: string | null;
  grade: string | null;
  guardian_phone: string | null;
  enrollment_date: string;
  membership_status: string;
  current_penalty_points: number;
  warning_count: number;
  memo: string | null;
  users: { name: string; phone: string; status: string } | null;
}

function mapRow(row: StudentProfileJoinRow): StudentSummary {
  return {
    id: row.id,
    name: row.users?.name ?? '(알 수 없음)',
    phone: row.users?.phone ?? '',
    userStatus: row.users?.status ?? 'active',
    studentNumber: row.student_number,
    school: row.school,
    grade: row.grade,
    guardianPhone: row.guardian_phone,
    enrollmentDate: row.enrollment_date,
    membershipStatus: row.membership_status,
    currentPenaltyPoints: row.current_penalty_points,
    warningCount: row.warning_count,
    memo: row.memo,
  };
}

export async function fetchAllStudents(): Promise<StudentSummary[]> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select(
      'id, student_number, school, grade, guardian_phone, enrollment_date, membership_status, current_penalty_points, warning_count, memo, users(name, phone, status)'
    )
    .order('enrollment_date', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as unknown as StudentProfileJoinRow));
}

export async function fetchStudentDetail(studentId: string): Promise<StudentSummary> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select(
      'id, student_number, school, grade, guardian_phone, enrollment_date, membership_status, current_penalty_points, warning_count, memo, users(name, phone, status)'
    )
    .eq('id', studentId)
    .single();

  if (error) throw error;
  return mapRow(data as unknown as StudentProfileJoinRow);
}

export async function createStudent(input: CreateStudentInput): Promise<void> {
  const { error } = await supabase.functions.invoke('create-user-account', {
    body: {
      phone: input.phone,
      name: input.name,
      password: input.password,
      role: 'student',
      studentProfile: {
        school: input.school,
        grade: input.grade,
        studentNumber: input.studentNumber,
        guardianPhone: input.guardianPhone,
      },
    },
  });
  if (error) throw error;
}

export async function updateStudent(studentId: string, input: UpdateStudentInput): Promise<void> {
  const { error: usersError } = await supabase
    .from('users')
    .update({ name: input.name, phone: input.phone, status: input.userStatus })
    .eq('id', studentId);
  if (usersError) throw usersError;

  const { error: profileError } = await supabase
    .from('student_profiles')
    .update({
      school: input.school,
      grade: input.grade,
      student_number: input.studentNumber,
      guardian_phone: input.guardianPhone,
      membership_status: input.membershipStatus,
      memo: input.memo,
    })
    .eq('id', studentId);
  if (profileError) throw profileError;
}

export async function deleteStudent(studentId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-user-account', {
    body: { userId: studentId },
  });
  if (error) throw error;
}
