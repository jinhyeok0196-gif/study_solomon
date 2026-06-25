import { createContext, useContext, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@/types/domain';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// 실제 Supabase Auth 연동은 3단계(인증 시스템 구현)에서 채워집니다.
export function AuthProvider({ children }: { children: ReactNode }) {
  const value: AuthContextValue = {
    user: null,
    isLoading: false,
    login: async () => {
      throw new Error('인증 시스템이 아직 연동되지 않았습니다 (3단계에서 구현 예정).');
    },
    logout: async () => {
      throw new Error('인증 시스템이 아직 연동되지 않았습니다 (3단계에서 구현 예정).');
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext는 AuthProvider 내부에서만 사용할 수 있습니다.');
  }
  return ctx;
}
