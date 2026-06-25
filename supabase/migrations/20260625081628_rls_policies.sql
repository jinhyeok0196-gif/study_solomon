-- =========================================================================
-- 솔로몬스터디카페 - Row Level Security
-- 원칙: 관리자(is_admin())는 전체 접근, 학생은 본인 데이터만 접근.
-- =========================================================================

alter table public.users enable row level security;
alter table public.student_profiles enable row level security;
alter table public.periods enable row level security;
alter table public.system_settings enable row level security;
alter table public.weekly_schedules enable row level security;
alter table public.schedule_items enable row level security;
alter table public.attendance_records enable row level security;
alter table public.absence_requests enable row level security;
alter table public.leave_requests enable row level security;
alter table public.bathroom_logs enable row level security;
alter table public.power_nap_logs enable row level security;
alter table public.penalty_records enable row level security;
alter table public.warning_records enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;

-- -------------------------------------------------------------------------
-- users
-- -------------------------------------------------------------------------
create policy "users_select_self_or_admin" on public.users
  for select using (id = auth.uid() or public.is_admin());

create policy "users_insert_admin" on public.users
  for insert with check (public.is_admin());

create policy "users_update_admin" on public.users
  for update using (public.is_admin());

create policy "users_delete_admin" on public.users
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- student_profiles
-- -------------------------------------------------------------------------
create policy "student_profiles_select_self_or_admin" on public.student_profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "student_profiles_insert_admin" on public.student_profiles
  for insert with check (public.is_admin());

create policy "student_profiles_update_admin" on public.student_profiles
  for update using (public.is_admin());

create policy "student_profiles_delete_admin" on public.student_profiles
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- periods / system_settings: 모든 인증 사용자가 조회, 변경은 관리자만.
-- -------------------------------------------------------------------------
create policy "periods_select_authenticated" on public.periods
  for select using (auth.uid() is not null);

create policy "periods_write_admin" on public.periods
  for all using (public.is_admin()) with check (public.is_admin());

create policy "system_settings_select_authenticated" on public.system_settings
  for select using (auth.uid() is not null);

create policy "system_settings_write_admin" on public.system_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------------------
-- weekly_schedules / schedule_items: 학생 본인이 직접 작성/수정.
-- -------------------------------------------------------------------------
create policy "weekly_schedules_select_self_or_admin" on public.weekly_schedules
  for select using (student_id = auth.uid() or public.is_admin());

create policy "weekly_schedules_insert_self_or_admin" on public.weekly_schedules
  for insert with check (student_id = auth.uid() or public.is_admin());

create policy "weekly_schedules_update_self_or_admin" on public.weekly_schedules
  for update using (student_id = auth.uid() or public.is_admin());

create policy "weekly_schedules_delete_self_or_admin" on public.weekly_schedules
  for delete using (student_id = auth.uid() or public.is_admin());

create policy "schedule_items_select_self_or_admin" on public.schedule_items
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.weekly_schedules ws
      where ws.id = schedule_items.weekly_schedule_id and ws.student_id = auth.uid()
    )
  );

create policy "schedule_items_insert_self_or_admin" on public.schedule_items
  for insert with check (
    public.is_admin()
    or exists (
      select 1 from public.weekly_schedules ws
      where ws.id = schedule_items.weekly_schedule_id and ws.student_id = auth.uid()
    )
  );

create policy "schedule_items_delete_self_or_admin" on public.schedule_items
  for delete using (
    public.is_admin()
    or exists (
      select 1 from public.weekly_schedules ws
      where ws.id = schedule_items.weekly_schedule_id and ws.student_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------------
-- attendance_records: 학생은 조회만, 기록/수정은 관리자(또는 시스템) 권한.
-- -------------------------------------------------------------------------
create policy "attendance_records_select_self_or_admin" on public.attendance_records
  for select using (student_id = auth.uid() or public.is_admin());

create policy "attendance_records_write_admin" on public.attendance_records
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------------------
-- absence_requests / leave_requests: 학생이 신청, 승인/거절은 관리자.
-- 학생은 pending 상태인 자신의 신청만 수정/취소할 수 있다.
-- -------------------------------------------------------------------------
create policy "absence_requests_select_self_or_admin" on public.absence_requests
  for select using (student_id = auth.uid() or public.is_admin());

create policy "absence_requests_insert_self" on public.absence_requests
  for insert with check (student_id = auth.uid());

create policy "absence_requests_update_self_pending_or_admin" on public.absence_requests
  for update using (
    public.is_admin() or (student_id = auth.uid() and status = 'pending')
  );

create policy "absence_requests_delete_self_pending_or_admin" on public.absence_requests
  for delete using (
    public.is_admin() or (student_id = auth.uid() and status = 'pending')
  );

create policy "leave_requests_select_self_or_admin" on public.leave_requests
  for select using (student_id = auth.uid() or public.is_admin());

create policy "leave_requests_insert_self" on public.leave_requests
  for insert with check (student_id = auth.uid());

create policy "leave_requests_update_self_pending_or_admin" on public.leave_requests
  for update using (
    public.is_admin() or (student_id = auth.uid() and status = 'pending')
  );

create policy "leave_requests_delete_self_pending_or_admin" on public.leave_requests
  for delete using (
    public.is_admin() or (student_id = auth.uid() and status = 'pending')
  );

-- -------------------------------------------------------------------------
-- bathroom_logs (외출): 학생이 시작/복귀를 직접 기록.
-- -------------------------------------------------------------------------
create policy "bathroom_logs_select_self_or_admin" on public.bathroom_logs
  for select using (student_id = auth.uid() or public.is_admin());

create policy "bathroom_logs_insert_self" on public.bathroom_logs
  for insert with check (student_id = auth.uid());

create policy "bathroom_logs_update_self_or_admin" on public.bathroom_logs
  for update using (student_id = auth.uid() or public.is_admin());

create policy "bathroom_logs_delete_admin" on public.bathroom_logs
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- power_nap_logs: 학생이 시작/종료를 직접 기록.
-- -------------------------------------------------------------------------
create policy "power_nap_logs_select_self_or_admin" on public.power_nap_logs
  for select using (student_id = auth.uid() or public.is_admin());

create policy "power_nap_logs_insert_self" on public.power_nap_logs
  for insert with check (student_id = auth.uid());

create policy "power_nap_logs_update_self_or_admin" on public.power_nap_logs
  for update using (student_id = auth.uid() or public.is_admin());

create policy "power_nap_logs_delete_admin" on public.power_nap_logs
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- penalty_records / warning_records: 학생은 조회만, 관리자만 기록.
-- -------------------------------------------------------------------------
create policy "penalty_records_select_self_or_admin" on public.penalty_records
  for select using (student_id = auth.uid() or public.is_admin());

create policy "penalty_records_write_admin" on public.penalty_records
  for all using (public.is_admin()) with check (public.is_admin());

create policy "warning_records_select_self_or_admin" on public.warning_records
  for select using (student_id = auth.uid() or public.is_admin());

create policy "warning_records_write_admin" on public.warning_records
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------------------
-- notifications: 본인에게 온 알림 또는 관리자 대상 알림만 조회.
-- 알림 생성은 관리자 화면 또는 SECURITY DEFINER 트리거를 통해서만 이루어진다.
-- -------------------------------------------------------------------------
create policy "notifications_select_recipient_or_admin" on public.notifications
  for select using (
    recipient_id = auth.uid()
    or (recipient_role = 'admin' and public.is_admin())
  );

create policy "notifications_insert_admin" on public.notifications
  for insert with check (public.is_admin());

create policy "notifications_update_recipient_or_admin" on public.notifications
  for update using (recipient_id = auth.uid() or public.is_admin());

create policy "notifications_delete_admin" on public.notifications
  for delete using (public.is_admin());

-- -------------------------------------------------------------------------
-- activity_logs: 누구나 본인 행동을 기록할 수 있으나, 조회는 관리자만.
-- 변경/삭제 정책은 두지 않아 기본적으로 막혀 있다(불변 감사 로그).
-- -------------------------------------------------------------------------
create policy "activity_logs_select_admin" on public.activity_logs
  for select using (public.is_admin());

create policy "activity_logs_insert_self_or_admin" on public.activity_logs
  for insert with check (actor_id = auth.uid() or public.is_admin());
