import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { fetchUserProfile, signInWithPhone, signOutCurrentUser } from '@/features/auth/api';
import type { AuthenticatedUser } from '@/types/domain';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (phone: string, password: string) => Promise<AuthenticatedUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function syncUserFromSession(userId: string | undefined) {
      if (!userId) {
        if (isMounted) setUser(null);
        return;
      }
      const profile = await fetchUserProfile(userId);
      if (isMounted) setUser(profile);
    }

    supabase.auth.getSession().then(({ data }) => {
      syncUserFromSession(data.session?.user.id).finally(() => {
        if (isMounted) setIsLoading(false);
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUserFromSession(session?.user.id);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    login: async (phone, password) => {
      await signInWithPhone(phone, password);
      const { data } = await supabase.auth.getUser();
      const profile = data.user ? await fetchUserProfile(data.user.id) : null;
      if (!profile) {
        await signOutCurrentUser();
        throw new Error('계정 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.');
      }
      setUser(profile);
      return profile;
    },
    logout: async () => {
      await signOutCurrentUser();
      setUser(null);
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
