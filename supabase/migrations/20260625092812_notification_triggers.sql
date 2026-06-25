-- =========================================================================
-- 실시간 알림 자동 생성 트리거
-- 외출 시작/복귀, 파워냅 시작/종료, 경고/퇴원 발생, 무단결석 시
-- notifications(recipient_role='admin') 행을 자동으로 생성한다.
-- 프런트엔드는 Supabase Realtime으로 notifications 테이블 변경을 구독해 반영한다.
-- =========================================================================

create or replace function public.notify_admins(
  p_type text,
  p_title text,
  p_message text,
  p_related_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (recipient_role, type, title, message, related_student_id)
  values ('admin', p_type, p_title, p_message, p_related_student_id);
end;
$$;

-- -------------------------------------------------------------------------
-- 외출 시작 / 복귀
-- -------------------------------------------------------------------------
create or replace function public.notify_outing_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.users where id = new.student_id;
  perform public.notify_admins('outing_start', '외출 시작', format('%s님이 외출을 시작했습니다.', v_name), new.student_id);
  return new;
end;
$$;

create trigger bathroom_logs_notify_start
  after insert on public.bathroom_logs
  for each row execute function public.notify_outing_started();

create or replace function public.notify_outing_returned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if old.status = 'ongoing' and new.status = 'completed' then
    select name into v_name from public.users where id = new.student_id;
    perform public.notify_admins('outing_return', '외출 복귀', format('%s님이 외출에서 복귀했습니다.', v_name), new.student_id);
  end if;
  return new;
end;
$$;

create trigger bathroom_logs_notify_return
  after update on public.bathroom_logs
  for each row execute function public.notify_outing_returned();

-- -------------------------------------------------------------------------
-- 파워냅 시작 / 종료
-- -------------------------------------------------------------------------
create or replace function public.notify_power_nap_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.users where id = new.student_id;
  perform public.notify_admins('power_nap_start', '파워냅 시작', format('%s님이 파워냅을 시작했습니다.', v_name), new.student_id);
  return new;
end;
$$;

create trigger power_nap_logs_notify_start
  after insert on public.power_nap_logs
  for each row execute function public.notify_power_nap_started();

create or replace function public.notify_power_nap_ended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if old.status = 'ongoing' and new.status = 'completed' then
    select name into v_name from public.users where id = new.student_id;
    perform public.notify_admins('power_nap_end', '파워냅 종료', format('%s님이 파워냅을 종료했습니다.', v_name), new.student_id);
  end if;
  return new;
end;
$$;

create trigger power_nap_logs_notify_end
  after update on public.power_nap_logs
  for each row execute function public.notify_power_nap_ended();

-- -------------------------------------------------------------------------
-- 무단결석 (출결이 'absent'로 기록되는 시점에 알림 — 자동 감지는 별도 cron이 처리)
-- -------------------------------------------------------------------------
create or replace function public.notify_unauthorized_absence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status = 'absent' and (tg_op = 'INSERT' or old.status is distinct from 'absent') then
    select name into v_name from public.users where id = new.student_id;
    perform public.notify_admins(
      'unauthorized_absence',
      '무단결석',
      format('%s님이 %s %s교시에 무단결석했습니다.', v_name, new.class_date, new.period_number),
      new.student_id
    );
  end if;
  return new;
end;
$$;

create trigger attendance_records_notify_absence
  after insert or update on public.attendance_records
  for each row execute function public.notify_unauthorized_absence();

-- -------------------------------------------------------------------------
-- 경고 발생 / 퇴원 조건 충족 (4단계 트리거에 알림 발행을 추가)
-- -------------------------------------------------------------------------
create or replace function public.apply_penalty_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total smallint;
  current_warning_count smallint;
  v_name text;
begin
  update public.student_profiles
  set current_penalty_points = greatest(
    0,
    current_penalty_points + case when new.adjustment_type = 'add' then new.points else -new.points end
  )
  where id = new.student_id
  returning current_penalty_points, warning_count into new_total, current_warning_count;

  if new.adjustment_type = 'add' then
    select name into v_name from public.users where id = new.student_id;

    if new_total >= 30 and current_warning_count < 3 then
      insert into public.warning_records (student_id, warning_level, triggered_penalty_total, is_auto_generated)
      values (new.student_id, 3, new_total, true);

      update public.student_profiles
      set warning_count = 3, membership_status = 'expelled'
      where id = new.student_id;

      perform public.notify_admins(
        'expulsion', '퇴원 조건 충족',
        format('%s님이 누적 벌점 %s점으로 퇴원 조건에 도달했습니다.', v_name, new_total),
        new.student_id
      );
    elsif new_total >= 20 and current_warning_count < 2 then
      insert into public.warning_records (student_id, warning_level, triggered_penalty_total, is_auto_generated)
      values (new.student_id, 2, new_total, true);

      update public.student_profiles set warning_count = 2 where id = new.student_id;

      perform public.notify_admins(
        'warning', '2차 경고 발생',
        format('%s님이 누적 벌점 %s점으로 2차 경고를 받았습니다.', v_name, new_total),
        new.student_id
      );
    elsif new_total >= 10 and current_warning_count < 1 then
      insert into public.warning_records (student_id, warning_level, triggered_penalty_total, is_auto_generated)
      values (new.student_id, 1, new_total, true);

      update public.student_profiles set warning_count = 1 where id = new.student_id;

      perform public.notify_admins(
        'warning', '1차 경고 발생',
        format('%s님이 누적 벌점 %s점으로 1차 경고를 받았습니다.', v_name, new_total),
        new.student_id
      );
    end if;
  end if;

  return new;
end;
$$;
