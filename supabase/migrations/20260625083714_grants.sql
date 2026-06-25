-- =========================================================================
-- 솔로몬스터디카페 - 테이블 권한 부여
-- 최신 Supabase는 신규 테이블을 anon/authenticated/service_role 에 자동 노출하지
-- 않으므로(auto_expose_new_tables 기본 off), RLS 정책과 별개로 테이블 단위 GRANT가
-- 반드시 필요하다. service_role은 RLS는 우회하지만 테이블 권한 자체는 별도로 필요하다.
-- 실제 행 단위 접근 제어는 위 마이그레이션의 RLS 정책이 담당한다.
-- =========================================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

-- 이후 추가되는 테이블에도 동일한 권한이 자동으로 부여되도록 기본값을 설정한다.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
