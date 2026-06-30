-- =========================================================================
-- AI Rule Decisions — 관리자 읽기 전용(read-only) + Realtime
-- =========================================================================
-- 20260708000000_ai_rule_decisions.sql 에서 만든 ai_rule_decisions 테이블에
-- "관리자만 SELECT" RLS 정책과 Realtime 발행을 추가한다.
--
-- ⚠️ 읽기 전용이다.
--    - INSERT/UPDATE/DELETE 정책은 만들지 않는다(저장은 기존처럼 서버 service role 만).
--    - 학생/일반 사용자는 조회 불가(is_admin() 만 허용).
--    - 이 단계는 "관리자가 AI 판정 결과를 보기만" 한다 — 학생 상태/출결/벌점/알림은 건드리지 않는다.
-- =========================================================================

-- 관리자만 읽기. 기존 is_admin() 헬퍼(20260625081627_auth_helpers.sql)를 재사용.
drop policy if exists "ai_rule_decisions_select_admin" on public.ai_rule_decisions;
create policy "ai_rule_decisions_select_admin" on public.ai_rule_decisions
  for select
  to authenticated
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- Realtime: 새 판정 INSERT 시 관리자 대시보드가 갱신되도록 발행에 추가.
-- -------------------------------------------------------------------------
alter table public.ai_rule_decisions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ai_rule_decisions'
  ) then
    alter publication supabase_realtime add table public.ai_rule_decisions;
  end if;
end $$;
