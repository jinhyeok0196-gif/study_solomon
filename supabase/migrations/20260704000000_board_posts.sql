-- =========================================================================
-- 익명 불만 / 건의 게시판 (board_posts)
-- 학생이 작성(작성 시 '익명' 선택 가능), 모든 인증 사용자가 열람, 관리자가 답글.
-- category: '불만(complaint)' / '건의(suggestion)'
-- 익명성: author_name 은 비익명일 때만 실명 스냅샷, 익명이면 null.
--   학생은 users 조회 권한이 없어(created_by uuid 로 실명 역추적 불가) 익명이 보장된다.
--   관리자는 users 를 join 해 작성자 실명을 확인할 수 있다.
-- =========================================================================

create table if not exists public.board_posts (
  id             uuid primary key default gen_random_uuid(),
  category       text not null default 'complaint' check (category in ('complaint', 'suggestion')),
  content        text not null,
  is_anonymous   boolean not null default false,
  author_name    text,            -- 비익명 작성 시 실명 스냅샷(트리거가 채움), 익명이면 null
  created_by     uuid references public.users(id) on delete set null,
  admin_reply    text,
  admin_reply_by uuid references public.users(id) on delete set null,
  admin_reply_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_board_posts_created on public.board_posts (created_at desc);

drop trigger if exists board_posts_set_updated_at on public.board_posts;
create trigger board_posts_set_updated_at
  before update on public.board_posts
  for each row execute function public.set_updated_at();

-- 작성자/이름 스냅샷을 서버에서 강제 (위조·사칭 방지)
create or replace function public.set_board_post_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  if new.is_anonymous then
    new.author_name := null;
  else
    select name into new.author_name from public.users where id = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists board_posts_set_author on public.board_posts;
create trigger board_posts_set_author
  before insert on public.board_posts
  for each row execute function public.set_board_post_author();

-- -------------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------------
alter table public.board_posts enable row level security;

-- 열람: 모든 인증 사용자 (모두 공개)
drop policy if exists "board_posts_select_all" on public.board_posts;
create policy "board_posts_select_all" on public.board_posts
  for select using (auth.uid() is not null);

-- 작성: 인증 사용자 (created_by 는 트리거가 auth.uid() 로 강제)
drop policy if exists "board_posts_insert_auth" on public.board_posts;
create policy "board_posts_insert_auth" on public.board_posts
  for insert with check (auth.uid() is not null);

-- 수정(답글): 관리자만
drop policy if exists "board_posts_update_admin" on public.board_posts;
create policy "board_posts_update_admin" on public.board_posts
  for update using (public.is_admin());

-- 삭제: 관리자 또는 본인 글
drop policy if exists "board_posts_delete_admin_or_self" on public.board_posts;
create policy "board_posts_delete_admin_or_self" on public.board_posts
  for delete using (public.is_admin() or created_by = auth.uid());

-- -------------------------------------------------------------------------
-- Realtime
-- -------------------------------------------------------------------------
alter table public.board_posts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'board_posts'
  ) then
    alter publication supabase_realtime add table public.board_posts;
  end if;
end $$;
