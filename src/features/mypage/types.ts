export type RequestType = 'name_change' | 'phone_change' | 'withdrawal';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface RequestLog {
  id: string;
  studentId: string;
  requestType: RequestType;
  status: RequestStatus;
  newValue: string | null;
  reason: string;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface MyProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  createdAt: string;
  enrollmentDate: string;
  membershipStatus: string;
  membershipType: string | null;
  membershipStartDate: string | null;
  membershipEndDate: string | null;
  currentPenaltyPoints: number;
  warningCount: number;
}

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  name_change: '이름 변경',
  phone_change: '전화번호 변경',
  withdrawal: '회원탈퇴',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
};

export const REQUEST_STATUS_TONE: Record<RequestStatus, 'default' | 'success' | 'danger' | 'warning'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};
