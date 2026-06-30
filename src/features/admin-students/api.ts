import { supabase } from '@/lib/supabase/client';
import type { CreateStudentInput, GrantMembershipInput, StudentSummary, UpdateStudentInput } from './types';

interface StudentProfileJoinRow {
  id: string;
  student_number: string | null;
  school: string | null;
  grade: string | null;
  guardian_phone: string | null;
  enrollment_date: string;
  membership_status: string;
  membership_type: string | null;
  membership_start_date: string | null;
  membership_end_date: string | null;
  auto_renew: boolean;
  current_penalty_points: number;
  warning_count: number;
  memo: string | null;
  users: { name: string; phone: string; status: string } | null;
}

const STUDENT_SELECT =
  'id, student_number, school, grade, guardian_phone, enrollment_date, membership_status, membership_type, membership_start_date, membership_end_date, auto_renew, current_penalty_points, warning_count, memo, users(name, phone, status)';

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
    membershipType: row.membership_type,
    membershipStartDate: row.membership_start_date,
    membershipEndDate: row.membership_end_date,
    autoRenew: row.auto_renew,
    currentPenaltyPoints: row.current_penalty_points,
    warningCount: row.warning_count,
    memo: row.memo,
  };
}

export async function fetchAllStudents(): Promise<StudentSummary[]> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select(STUDENT_SELECT)
    .order('enrollment_date', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as unknown as StudentProfileJoinRow));
}

export async function fetchStudentDetail(studentId: string): Promise<StudentSummary> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select(STUDENT_SELECT)
    .eq('id', studentId)
    .single();

  if (error) throw error;
  return mapRow(data as unknown as StudentProfileJoinRow);
}

export async function grantMembership(
  studentId: string,
  input: GrantMembershipInput
): Promise<void> {
  const { error } = await supabase
    .from('student_profiles')
    .update({
      membership_type: input.type,
      membership_start_date: input.startDate,
      membership_end_date: input.endDate,
      membership_status: 'active',
    })
    .eq('id', studentId);
  if (error) throw new Error('이용권 부여 중 오류가 발생했습니다.');
}

export async function setAutoRenew(studentId: string, autoRenew: boolean): Promise<void> {
  const { error } = await supabase
    .from('student_profiles')
    .update({ auto_renew: autoRenew })
    .eq('id', studentId);
  if (error) throw new Error('자동연장 설정 변경 중 오류가 발생했습니다.');
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
