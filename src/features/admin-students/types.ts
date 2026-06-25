export interface StudentSummary {
  id: string;
  name: string;
  phone: string;
  userStatus: string;
  studentNumber: string | null;
  school: string | null;
  grade: string | null;
  guardianPhone: string | null;
  enrollmentDate: string;
  membershipStatus: string;
  currentPenaltyPoints: number;
  warningCount: number;
  memo: string | null;
}

export interface CreateStudentInput {
  phone: string;
  name: string;
  password: string;
  school?: string;
  grade?: string;
  studentNumber?: string;
  guardianPhone?: string;
}

export interface UpdateStudentInput {
  name: string;
  phone: string;
  userStatus: string;
  school: string | null;
  grade: string | null;
  studentNumber: string | null;
  guardianPhone: string | null;
  membershipStatus: string;
  memo: string | null;
}
