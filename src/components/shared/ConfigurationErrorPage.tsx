export function ConfigurationErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4 text-center">
      <h1 className="text-xl font-bold text-red-600">배포 설정 오류</h1>
      <p className="max-w-md text-sm text-gray-600">
        VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다. Cloudflare
        Pages 프로젝트 설정의 Environment Variables에 두 값을 추가한 뒤 다시 배포해주세요.
      </p>
    </div>
  );
}
