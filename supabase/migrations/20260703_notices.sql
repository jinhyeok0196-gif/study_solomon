-- =========================================================================
-- 공지사항 / 이용수칙 (notices)
-- 관리자가 작성·수정·삭제하고, 모든 인증 사용자가 열람한다.
-- category 로 '공지사항(notice)' / '이용수칙(rule)' 을 구분하고,
-- is_pinned 로 홈 상단 고정 여부를 둔다.
-- =========================================================================

create table if not exists public.notices (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'notice' check (category in ('notice', 'rule')),
  title       text not null,
  content     text not null,
  is_pinned   boolean not null default false,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_notices_pinned_created
  on public.notices (is_pinned desc, created_at desc);

drop trigger if exists notices_set_updated_at on public.notices;
create trigger notices_set_updated_at
  before update on public.notices
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- RLS: 열람은 모든 인증 사용자, 작성/수정/삭제는 관리자만
-- -------------------------------------------------------------------------
alter table public.notices enable row level security;

drop policy if exists "notices_select_all" on public.notices;
create policy "notices_select_all" on public.notices
  for select using (auth.uid() is not null);

drop policy if exists "notices_insert_admin" on public.notices;
create policy "notices_insert_admin" on public.notices
  for insert with check (public.is_admin());

drop policy if exists "notices_update_admin" on public.notices;
create policy "notices_update_admin" on public.notices
  for update using (public.is_admin());

drop policy if exists "notices_delete_admin" on public.notices;
create policy "notices_delete_admin" on public.notices
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- Realtime (홈/관리자 화면 실시간 반영)
-- -------------------------------------------------------------------------
alter table public.notices replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notices'
  ) then
    alter publication supabase_realtime add table public.notices;
  end if;
end $$;
