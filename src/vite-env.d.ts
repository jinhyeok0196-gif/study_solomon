/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // v0.6-pre: 로컬 preview bridge 서버 URL(설정 시에만 로컬 미리보기 활성). 예: http://127.0.0.1:8765
  readonly VITE_LOCAL_PREVIEW_BRIDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
