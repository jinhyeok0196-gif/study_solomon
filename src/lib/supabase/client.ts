import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 빌드 시점에 환경변수가 비어 있어도 모듈 로드 자체가 깨지지 않도록 placeholder로 createClient를
// 통과시키고, 실제 사용 가능 여부는 App.tsx에서 화면에 표시해 배포 설정 오류를 바로 알 수 있게 한다.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
