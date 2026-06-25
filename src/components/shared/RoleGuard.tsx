import type { ReactNode } from 'react';
import type { UserRole } from '@/types/domain';

interface RoleGuardProps {
  role: UserRole;
  children: ReactNode;
}

// 역할 기반 접근 제어는 3단계(인증 시스템 구현)에서 채워집니다.
export function RoleGuard({ children }: RoleGuardProps) {
  return <>{children}</>;
}
