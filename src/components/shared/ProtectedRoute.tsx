import type { ReactNode } from 'react';

// 인증 여부에 따른 리다이렉트는 3단계(인증 시스템 구현)에서 채워집니다.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
