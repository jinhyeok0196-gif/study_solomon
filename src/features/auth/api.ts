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

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    throw new Error('구글 로그인에 실패했습니다.');
  }
}

export async function createStudentProfile(userId: string, name: string, phone: string): Promise<AuthenticatedUser> {
  const { error: userError } = await supabase
    .from('users')
    .upsert({ id: userId, name, phone, role: 'student' }, { onConflict: 'id' });

  if (userError) throw new Error(`users 등록 실패: ${userError.message}`);

  const { error: profileError } = await supabase
    .from('student_profiles')
    .upsert({ id: userId }, { onConflict: 'id' });

  if (profileError) throw new Error(`student_profiles 등록 실패: ${profileError.message}`);

  return { id: userId, name, phone, role: 'student' };
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
