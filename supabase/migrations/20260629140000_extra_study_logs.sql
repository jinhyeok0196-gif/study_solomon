-- =========================================================================
-- 교시외공부 기록 (extra_study_logs)
-- 쉬는시간/식사시간/자율시간 등 "수업 교시가 아닌" 시간에 공부한 경우,
-- 학생이 직접 시작/종료(스톱워치)로 기록한다. 이 시간만 순공시간에 추가 합산된다.
-- (교시 시간은 attendance_records 기반으로 별도 합산 → 쉬는/식사시간은 제외됨)
-- 외출(bathroom_logs)/파워냅(power_nap_logs)과 동일한 시작/종료 패턴.
-- =========================================================================

create table if not exists public.extra_study_logs (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  study_date  date not null default current_date,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  status      text not null default 'ongoing' check (status in ('ongoing', 'completed')),
  created_at  timestamptz not null default now()
);

-- 동시에 1건만 진행 가능
create unique index if not exists extra_study_logs_one_ongoing
  on public.extra_study_logs (student_id) where status = 'ongoing';

create index if not exists idx_extra_study_logs_student_date
  on public.extra_study_logs (student_id, study_date);

-- -------------------------------------------------------------------------
-- RLS (bathroom_logs 와 동일 원칙: 학생 본인이 직접 기록, 관리자는 전체)
-- -------------------------------------------------------------------------
alter table public.extra_study_logs enable row level security;

drop policy if exists "extra_study_logs_select_self_or_admin" on public.extra_study_logs;
create policy "extra_study_logs_select_self_or_admin" on public.extra_study_logs
  for select using (student_id = auth.uid() or public.is_admin());

drop policy if exists "extra_study_logs_insert_self" on public.extra_study_logs;
create policy "extra_study_logs_insert_self" on public.extra_study_logs
  for insert with check (student_id = auth.uid());

drop policy if exists "extra_study_logs_update_self_or_admin" on public.extra_study_logs;
create policy "extra_study_logs_update_self_or_admin" on public.extra_study_logs
  for update using (student_id = auth.uid() or public.is_admin());

drop policy if exists "extra_study_logs_delete_admin" on public.extra_study_logs;
create policy "extra_study_logs_delete_admin" on public.extra_study_logs
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- Realtime (관제 화면 실시간 반영)
-- -------------------------------------------------------------------------
alter table public.extra_study_logs replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'extra_study_logs'
  ) then
    alter publication supabase_realtime add table public.extra_study_logs;
  end if;
end $$;
