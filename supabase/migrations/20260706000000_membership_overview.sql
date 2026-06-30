-- =========================================================================
-- 이용권 현황(자동연장) 지원
--   student_profiles.auto_renew: 이용권 자동연장 대상 여부
--   대시보드 이용권 현황 카드 실시간 갱신을 위해 student_profiles 를 realtime 에 추가
-- =========================================================================

alter table public.student_profiles
  add column if not exists auto_renew boolean not null default false;

alter table public.student_profiles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'student_profiles'
  ) then
    alter publication supabase_realtime add table public.student_profiles;
  end if;
end $$;
