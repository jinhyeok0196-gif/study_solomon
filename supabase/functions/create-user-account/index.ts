// 관리자가 학생/관리자 계정을 발급하는 전용 엔드포인트.
// 회원가입 폼 없이 운영자가 직접 계정을 만드는 관리형 스터디카페 운영 방식에 맞춰,
// service role 권한으로 auth 계정과 public.users/student_profiles row를 함께 생성한다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { phoneToAuthEmail, normalizePhone } from '../_shared/phone.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateUserAccountPayload {
  phone: string;
  name: string;
  password: string;
  role: 'student' | 'admin';
  studentProfile?: {
    studentNumber?: string;
    school?: string;
    grade?: string;
    guardianPhone?: string;
  };
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: '인증이 필요합니다.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return jsonResponse({ error: '유효하지 않은 인증 정보입니다.' }, 401);
  }

  const { data: callerProfile } = await callerClient
    .from('users')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (callerProfile?.role !== 'admin') {
    return jsonResponse({ error: '관리자만 계정을 생성할 수 있습니다.' }, 403);
  }

  const payload = (await req.json()) as CreateUserAccountPayload;
  if (!payload.phone || !payload.name || !payload.password || !payload.role) {
    return jsonResponse({ error: 'phone, name, password, role는 필수입니다.' }, 400);
  }
  if (payload.password.length < 6) {
    return jsonResponse({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const normalizedPhone = normalizePhone(payload.phone);

  const { data: createdAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
    email: phoneToAuthEmail(payload.phone),
    password: payload.password,
    email_confirm: true,
    user_metadata: { name: payload.name },
  });

  if (createAuthError || !createdAuthUser.user) {
    return jsonResponse({ error: `계정 생성 실패: ${createAuthError?.message}` }, 400);
  }

  const newUserId = createdAuthUser.user.id;

  const { error: usersInsertError } = await adminClient.from('users').insert({
    id: newUserId,
    role: payload.role,
    name: payload.name,
    phone: normalizedPhone,
  });

  if (usersInsertError) {
    await adminClient.auth.admin.deleteUser(newUserId);
    return jsonResponse({ error: `프로필 생성 실패: ${usersInsertError.message}` }, 400);
  }

  if (payload.role === 'student') {
    const { error: profileInsertError } = await adminClient.from('student_profiles').insert({
      id: newUserId,
      student_number: payload.studentProfile?.studentNumber ?? null,
      school: payload.studentProfile?.school ?? null,
      grade: payload.studentProfile?.grade ?? null,
      guardian_phone: payload.studentProfile?.guardianPhone ?? null,
    });

    if (profileInsertError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: `학생 프로필 생성 실패: ${profileInsertError.message}` }, 400);
    }
  }

  return jsonResponse(
    { id: newUserId, name: payload.name, phone: normalizedPhone, role: payload.role },
    201
  );
});
