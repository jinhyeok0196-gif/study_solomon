import { supabase } from '@/lib/supabase/client';
import type { AuthenticatedUser } from '@/types/domain';
import { phoneToAuthEmail } from './phone';

export async function signInWithPhone(phone: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(phone),
    password,
  });

  if (error) {
    throw new Error('전화번호 또는 비밀번호가 올바르지 않습니다.');
  }

  return data.session;
}

export async function signOutCurrentUser() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function fetchUserProfile(userId: string): Promise<AuthenticatedUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, role, name, phone')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    role: data.role as AuthenticatedUser['role'],
    name: data.name,
    phone: data.phone,
  };
}
