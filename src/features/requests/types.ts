export type RequestKind = 'absence' | 'leave';

export interface RequestRecord {
  id: string;
  requestDate: string;
  periodNumbers: number[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  absence: '결석',
  leave: '조퇴',
};

export const REQUEST_STATUS_LABEL: Record<RequestRecord['status'], string> = {
  pending: '대기중',
  approved: '승인됨',
  rejected: '거절됨',
};
