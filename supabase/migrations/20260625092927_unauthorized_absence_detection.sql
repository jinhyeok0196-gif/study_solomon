-- =========================================================================
-- 무단결석 자동 감지
-- 10분마다 실행되어, 종료된 교시인데도 출결 기록이 없고 승인된 결석 신청도 없는
-- 학생을 찾아 attendance_records.status='absent' 를 자동 기록한다.
-- 이 INSERT는 notification_triggers.sql 의 attendance_records 트리거를 통해
-- '무단결석' 알림을 자동으로 발생시킨다.
-- 주의: 서버(DB) 타임존 기준으로 계산되므로, 운영 환경의 타임존이 카페 현지 시간과
-- 일치해야 한다.
-- =========================================================================

create extension if not exists pg_cron;

create or replace function public.detect_unauthorized_absences()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key text := (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from current_date)::int];
  v_week_start date := current_date - (extract(isodow from current_date)::int - 1);
begin
  insert into public.attendance_records (student_id, class_date, period_number, status, source)
  select ws.student_id, current_date, si.period_number, 'absent', 'system'
  from public.schedule_items si
  join public.weekly_schedules ws on ws.id = si.weekly_schedule_id and ws.week_start_date = v_week_start
  join public.periods p on p.period_number = si.period_number
  where si.day_of_week = v_day_key
    and p.end_time < current_time
    and not exists (
      select 1 from public.attendance_records ar
      where ar.student_id = ws.student_id
        and ar.class_date = current_date
        and ar.period_number = si.period_number
    )
    and not exists (
      select 1 from public.absence_requests ab
      where ab.student_id = ws.student_id
        and ab.request_date = current_date
        and ab.status = 'approved'
        and si.period_number = any(ab.period_numbers)
    )
  on conflict (student_id, class_date, period_number) do nothing;
end;
$$;

select cron.schedule(
  'detect-unauthorized-absences',
  '*/10 * * * *',
  $$select public.detect_unauthorized_absences();$$
);
