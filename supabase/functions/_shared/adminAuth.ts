import { createClient } from 'npm:@supabase/supabase-js@2';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface AdminAuthResult {
  ok: true;
  adminClient: ReturnType<typeof createClient>;
  callerId: string;
}

interface AdminAuthError {
  ok: false;
  response: Response;
}

// 호출자가 관리자(role='admin')인지 확인하고, 통과 시 service role 클라이언트를 반환한다.
export async function requireAdmin(req: Request): Promise<AdminAuthResult | AdminAuthError> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { ok: false, response: jsonResponse({ error: '인증이 필요합니다.' }, 401) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return { ok: false, response: jsonResponse({ error: '유효하지 않은 인증 정보입니다.' }, 401) };
  }

  const { data: callerProfile } = await callerClient
    .from('users')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (callerProfile?.role !== 'admin') {
    return { ok: false, response: jsonResponse({ error: '관리자만 접근할 수 있습니다.' }, 403) };
  }

  return {
    ok: true,
    adminClient: createClient(supabaseUrl, serviceRoleKey),
    callerId: callerData.user.id,
  };
}
