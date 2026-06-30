-- =========================================================================
-- 승인 대기 항목(결석·조퇴 신청, 회원 요청)을 관리자 화면에 실시간 팝업하기 위해
-- 해당 테이블을 realtime publication 에 추가한다.
-- =========================================================================

alter table public.absence_requests replica identity full;
alter table public.leave_requests replica identity full;
alter table public.request_logs replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'absence_requests'
  ) then
    alter publication supabase_realtime add table public.absence_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'leave_requests'
  ) then
    alter publication supabase_realtime add table public.leave_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'request_logs'
  ) then
    alter publication supabase_realtime add table public.request_logs;
  end if;
end $$;
