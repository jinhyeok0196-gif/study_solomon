import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// 환경변수에 끝 공백·줄바꿈이 섞이면 (예: 대시보드 붙여넣기 시 trailing \n)
// REST 헤더는 통과해도 Realtime WebSocket의 apikey 쿼리파라미터는 %0A로 인코딩되어
// "HTTP Authentication failed"로 연결이 실패한다. 항상 trim 한다.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

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
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

// Realtime WebSocket 연결은 HTTP REST와 별도로 JWT를 전달해야 한다.
// 세션 로드/갱신 시 setAuth를 호출하지 않으면 WebSocket이 anon 권한으로만
// 연결되어 RLS 채널(postgres_changes, presence)이 SUBSCRIBED에 도달하지 못한다.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    supabase.realtime.setAuth(session.access_token);
  }
});
