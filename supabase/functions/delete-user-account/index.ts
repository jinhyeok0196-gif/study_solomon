// 관리자가 학생/관리자 계정을 완전히 삭제하는 전용 엔드포인트.
// auth.users 삭제가 public.users -> student_profiles -> 관련 기록 전체로 cascade 되므로,
// 반드시 service role로 auth.admin.deleteUser를 통해서만 삭제해야 한다(클라이언트가 직접
// public.users 행만 지우면 auth 계정이 고아 상태로 남는다).
import { CORS_HEADERS, jsonResponse, requireAdmin } from '../_shared/adminAuth.ts';

interface DeleteUserAccountPayload {
  userId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { adminClient, callerId } = auth;

  const payload = (await req.json()) as DeleteUserAccountPayload;
  if (!payload.userId) {
    return jsonResponse({ error: 'userId는 필수입니다.' }, 400);
  }
  if (payload.userId === callerId) {
    return jsonResponse({ error: '자기 자신의 계정은 삭제할 수 없습니다.' }, 400);
  }

  const { error } = await adminClient.auth.admin.deleteUser(payload.userId);
  if (error) {
    return jsonResponse({ error: `삭제 실패: ${error.message}` }, 400);
  }

  return jsonResponse({ id: payload.userId }, 200);
});
