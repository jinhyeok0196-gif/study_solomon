-- =========================================================================
-- 솔로몬스터디카페 - 인증 헬퍼 함수
-- public.users 테이블 생성 이후에 적용되어야 한다.
-- =========================================================================

-- 현재 로그인한 사용자가 관리자인지 여부 (RLS 정책에서 재사용)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 현재 로그인한 사용자의 역할
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;
