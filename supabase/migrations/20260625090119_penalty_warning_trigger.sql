-- =========================================================================
-- 벌점 자동 반영 + 경고/퇴원 자동 발생
-- 운영 규칙: 벌점 10점 1차 경고, 20점 2차 경고, 30점 퇴원(다음 달 재등록 불가).
-- warning_count는 "현재 사이클에서 도달한 최고 경고 단계(0~3)"를 의미하며,
-- 매월 벌점 초기화 시(별도 운영 작업) 0으로 되돌리되 warning_records 이력은 보존한다.
-- =========================================================================

create or replace function public.apply_penalty_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total smallint;
  current_warning_count smallint;
begin
  update public.student_profiles
  set current_penalty_points = greatest(
    0,
    current_penalty_points + case when new.adjustment_type = 'add' then new.points else -new.points end
  )
  where id = new.student_id
  returning current_penalty_points, warning_count into new_total, current_warning_count;

  if new.adjustment_type = 'add' then
    if new_total >= 30 and current_warning_count < 3 then
      insert into public.warning_records (student_id, warning_level, triggered_penalty_total, is_auto_generated)
      values (new.student_id, 3, new_total, true);

      update public.student_profiles
      set warning_count = 3, membership_status = 'expelled'
      where id = new.student_id;
    elsif new_total >= 20 and current_warning_count < 2 then
      insert into public.warning_records (student_id, warning_level, triggered_penalty_total, is_auto_generated)
      values (new.student_id, 2, new_total, true);

      update public.student_profiles set warning_count = 2 where id = new.student_id;
    elsif new_total >= 10 and current_warning_count < 1 then
      insert into public.warning_records (student_id, warning_level, triggered_penalty_total, is_auto_generated)
      values (new.student_id, 1, new_total, true);

      update public.student_profiles set warning_count = 1 where id = new.student_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger penalty_records_apply_adjustment
  after insert on public.penalty_records
  for each row execute function public.apply_penalty_adjustment();
