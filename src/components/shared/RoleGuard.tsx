import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { UserRole } from '@/types/domain';

interface RoleGuardProps {
  role: UserRole;
  fallback: string;
  children: ReactNode;
}

export function RoleGuard({ role, fallback, children }: RoleGuardProps) {
  const { user } = useAuth();

  if (user && user.role !== role) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
