  -- =========================================================================
  -- 무단결석 자동 감지 보정: 실제 재실(등원) 학생의 중간 교시를 absent로 오기록하던 버그 수정
  --
  -- 문제:
  --   QR 등원(checkin_by_qr)은 그날 '첫 교시' 1개에만 present 레코드를 만든다.
  --   기존 detect_unauthorized_absences()는 "종료됐는데 레코드 없는 신청 교시"를
  --   무조건 absent로 찍어, 실제로 자리에 있던(등원 후 미하원) 학생의 2·3·4교시가
  --   무단결석으로 잘못 기록되고 벌점/알림까지 발생했다.
  --
  -- 수정:
  --   등원(checked_in_at)~하원(checked_out_at, 없으면 현재) '재실 구간'이 교시와
  --   겹치면 present(재실 자동 출석), 겹치지 않으면(미등원·교시 종료 후 등원·교시 전
  --   하원) absent로 기록한다. 출석 INSERT는 absent가 아니므로 무단결석 알림 트리거
  --   (notify_unauthorized_absence: status='absent'에서만 발동)도 울리지 않는다.
  --
  -- 주의: 추후 카메라+AI 재실 판정이 붙으면 이 함수의 재실 판단을 AI 결과로 교체/보강한다.
  --   서버(DB) 타임존이 카페 현지(Asia/Seoul)와 일치해야 한다는 전제는 동일.
  -- =========================================================================

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
    insert into public.attendance_records (student_id, class_date, period_number, status, source, note)
    select
      t.student_id,
      current_date,
      t.period_number,
      case when t.attended then 'present' else 'absent' end,
      'system',
      case when t.attended then '재실 자동 출석 (QR 등원 기준)' else null end
    from (
      select
        ws.student_id,
        si.period_number,
        -- 재실 구간(등원~하원/현재)이 교시 구간과 한 순간이라도 겹치면 출석으로 인정
        (
          pres.checked_in_at is not null
          and pres.checked_in_at < (current_date + p.end_time)::timestamptz
          and coalesce(pres.checked_out_at, now()) > (current_date + p.start_time)::timestamptz
        ) as attended
      from public.schedule_items si
      join public.weekly_schedules ws
        on ws.id = si.weekly_schedule_id and ws.week_start_date = v_week_start
      join public.periods p on p.period_number = si.period_number
      left join lateral (
        select
          min(ar.checked_in_at) as checked_in_at,
          max(ar.checked_out_at) as checked_out_at
        from public.attendance_records ar
        where ar.student_id = ws.student_id
          and ar.class_date = current_date
      ) pres on true
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
    ) t
    on conflict (student_id, class_date, period_number) do nothing;
  end;
  $$;
