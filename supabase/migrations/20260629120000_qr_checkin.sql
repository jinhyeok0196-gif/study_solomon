-- =========================================================================
-- QR 등하원 체크인 시스템
-- 운영 방식:
--   문 앞 키오스크(관리자 계정)가 current_checkin_token() 으로 받은
--   회전 토큰 QR(약 30초마다 갱신)을 화면에 표시한다.
--   로그인된 학생이 본인 폰으로 스캔하면 /checkin?token=... 페이지가 열려
--   checkin_by_qr(p_token) RPC 를 호출한다.
--
-- 지각 기준 : 그날 학생이 신청한 첫 교시(start_time 최소)의 시작 시각.
-- 지각 벌점 : 1분이라도 늦으면 LATE(2점) 즉시 정액 부여(분 단위 기록).
-- 조퇴 벌점 : 하원 시 아직 끝나지 않은(시작 전) 신청 교시가 남아 있으면 조퇴로 보고,
--            승인된 조퇴 신청(leave_requests)으로 커버되지 않은 교시가 있으면
--            UNAUTHORIZED_EARLY_LEAVE(무단조퇴, 10점) 부여. 승인분은 면제 처리.
-- 토큰 보안 : HMAC(window, secret) 기반. 약 60~180초만 유효 → 집에서 원격 체크인 차단.
--            (로그인 지연을 고려해 윈도우 60초 + 최근 3개 윈도우 허용)
--
-- 주의: 모든 시각 계산은 DB 서버 타임존 기준이다. 운영 DB 타임존을 카페 현지
--       시간(Asia/Seoul)과 일치시켜야 한다. (기존 무단결석 감지 함수와 동일 전제)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) QR 비밀키 저장 (RLS로 완전 차단, SECURITY DEFINER 함수만 접근)
-- -------------------------------------------------------------------------
create table if not exists public.qr_config (
  id          smallint primary key default 1 check (id = 1),
  secret      text not null,
  updated_at  timestamptz not null default now()
);

alter table public.qr_config enable row level security;
-- 정책을 하나도 만들지 않음 → anon/authenticated 는 행을 읽을 수 없다.

-- grants.sql 의 default privileges 로 authenticated 에 부여된 테이블 권한을 회수해
-- 비밀키 테이블 접근을 이중으로 차단한다(SECURITY DEFINER 함수는 소유자 권한으로 접근).
revoke all on public.qr_config from anon, authenticated;

-- pgcrypto(gen_random_bytes/hmac)는 extensions 스키마에 있으므로 search_path에 포함.
set search_path = public, extensions;

insert into public.qr_config (id, secret)
values (1, encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- -------------------------------------------------------------------------
-- 2) 토큰 계산 (내부 전용)
-- -------------------------------------------------------------------------
create or replace function public._checkin_token(p_window bigint)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select encode(
    hmac(p_window::text, (select secret from public.qr_config where id = 1), 'sha256'),
    'hex'
  );
$$;

-- 내부 전용: 일반 사용자에게 실행 권한을 주지 않는다.
revoke all on function public._checkin_token(bigint) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3) 키오스크용 현재 토큰 발급 (관리자 전용)
--    반환 형식: '<window>.<hmac>'  (예: '56489123.ab12...')
-- -------------------------------------------------------------------------
create or replace function public.current_checkin_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window bigint;
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다.';
  end if;
  v_window := floor(extract(epoch from now()) / 60)::bigint;
  return v_window::text || '.' || public._checkin_token(v_window);
end;
$$;

-- -------------------------------------------------------------------------
-- 4) 학생 QR 체크인 / 체크아웃 (등원·하원 자동 판별)
-- -------------------------------------------------------------------------
create or replace function public.checkin_by_qr(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_cur_window   bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_window       bigint;
  v_hmac         text;
  v_dot          int;
  v_today        date := current_date;
  v_day_key      text := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from current_date)::int];
  v_week_start   date := current_date - (extract(isodow from current_date)::int - 1);
  v_now          time := localtime;
  v_first_period smallint;
  v_first_start  time;
  v_existing     public.attendance_records%rowtype;
  v_status       text;
  v_minutes_late int := 0;
  v_attendance_id uuid;
  v_student_name text;
  v_approved     smallint[];
  v_unexcused    int := 0;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (select 1 from public.users where id = v_uid and role = 'student') then
    raise exception '학생 계정만 체크인할 수 있습니다.';
  end if;

  -- --- 토큰 검증: '<window>.<hmac>' ---
  v_dot := position('.' in p_token);
  if v_dot = 0 then
    raise exception '유효하지 않은 QR입니다.';
  end if;
  begin
    v_window := substring(p_token from 1 for v_dot - 1)::bigint;
  exception when others then
    raise exception '유효하지 않은 QR입니다.';
  end;
  v_hmac := substring(p_token from v_dot + 1);

  -- 최근 3개 window 만 허용 (약 60~180초, 로그인 지연 고려)
  if (v_cur_window - v_window) not in (0, 1, 2) then
    raise exception 'QR이 만료되었습니다. 입구 화면의 새 QR을 스캔해주세요.';
  end if;
  if v_hmac <> public._checkin_token(v_window) then
    raise exception '유효하지 않은 QR입니다.';
  end if;

  -- --- 그날 첫 신청 교시 ---
  select si.period_number, p.start_time
  into v_first_period, v_first_start
  from public.schedule_items si
  join public.weekly_schedules ws
    on ws.id = si.weekly_schedule_id
   and ws.week_start_date = v_week_start
   and ws.student_id = v_uid
  join public.periods p on p.period_number = si.period_number
  where si.day_of_week = v_day_key
  order by p.start_time asc
  limit 1;

  if v_first_period is null then
    raise exception '오늘 신청한 시간표가 없습니다.';
  end if;

  -- --- 기존 등원 기록 확인 (첫 교시 레코드 기준) ---
  select * into v_existing
  from public.attendance_records
  where student_id = v_uid and class_date = v_today and period_number = v_first_period;

  if v_existing.id is not null and v_existing.checked_in_at is not null then
    -- 이미 하원까지 완료
    if v_existing.checked_out_at is not null then
      return jsonb_build_object(
        'action', 'already_out',
        'status', v_existing.status,
        'scanned_at', now()
      );
    end if;
    -- 등원 직후 중복 스캔(5분 이내)은 무시
    if now() - v_existing.checked_in_at < interval '5 minutes' then
      return jsonb_build_object(
        'action', 'already_in',
        'status', v_existing.status,
        'scanned_at', now()
      );
    end if;

    -- --- 조퇴 판정: 아직 시작 전인(start_time > 현재) 신청 교시가 남아 있는가 ---
    -- 승인된 조퇴 신청(leave_requests)이 커버하는 교시 집합
    select coalesce(array_agg(distinct pn), '{}')::smallint[]
    into v_approved
    from public.leave_requests lr, unnest(lr.period_numbers) as pn
    where lr.student_id = v_uid and lr.request_date = v_today and lr.status = 'approved';

    -- 남은(미시작) 신청 교시를 조퇴/승인조퇴로 기록 (cron 무단결석 방지)
    insert into public.attendance_records
      (student_id, class_date, period_number, status, source, note)
    select
      v_uid, v_today, si.period_number,
      case when si.period_number = any(v_approved) then 'excused_early_leave' else 'early_leave' end,
      'self',
      case when si.period_number = any(v_approved) then '승인 조퇴 (QR 하원)' else '조퇴 (QR 하원)' end
    from public.schedule_items si
    join public.weekly_schedules ws
      on ws.id = si.weekly_schedule_id
     and ws.week_start_date = v_week_start
     and ws.student_id = v_uid
    join public.periods p on p.period_number = si.period_number
    where si.day_of_week = v_day_key
      and p.start_time > v_now
    on conflict (student_id, class_date, period_number)
    do update set status = excluded.status, note = excluded.note, updated_at = now();

    -- 승인되지 않은(무단) 조퇴 교시 수
    select count(*)
    into v_unexcused
    from public.schedule_items si
    join public.weekly_schedules ws
      on ws.id = si.weekly_schedule_id
     and ws.week_start_date = v_week_start
     and ws.student_id = v_uid
    join public.periods p on p.period_number = si.period_number
    where si.day_of_week = v_day_key
      and p.start_time > v_now
      and si.period_number <> all(v_approved);

    -- --- 하원 처리: 출석한 레코드에 checked_out_at 기록 ---
    update public.attendance_records
    set checked_out_at = now(), updated_at = now()
    where student_id = v_uid and class_date = v_today
      and checked_in_at is not null and checked_out_at is null;

    -- 무단 조퇴 벌점 (트리거가 누적/경고 처리)
    if v_unexcused > 0 then
      insert into public.penalty_records
        (student_id, reason_code, adjustment_type, points, description, created_by)
      values
        (v_uid, 'UNAUTHORIZED_EARLY_LEAVE', 'add', 10, '무단 조퇴 ' || v_unexcused || '교시 (QR 자동)', null);

      select name into v_student_name from public.users where id = v_uid;
      perform public.notify_admins(
        'early_leave',
        '무단 조퇴',
        coalesce(v_student_name, '학생') || ' 학생이 무단 조퇴했습니다. (' || v_unexcused || '교시, 벌점 10점)',
        v_uid
      );
    end if;

    return jsonb_build_object(
      'action', 'out',
      'status', v_existing.status,
      'early_leave', v_unexcused > 0,
      'points_added', case when v_unexcused > 0 then 10 else 0 end,
      'scanned_at', now()
    );
  end if;

  -- --- 등원 처리: 지각 판정 ---
  if v_now <= v_first_start then
    v_status := 'present';
    v_minutes_late := 0;
  else
    v_status := 'late';
    v_minutes_late := ceil(extract(epoch from (v_now - v_first_start)) / 60.0)::int;
  end if;

  insert into public.attendance_records
    (student_id, class_date, period_number, status, checked_in_at, source, note)
  values
    (v_uid, v_today, v_first_period, v_status, now(), 'self',
     case when v_status = 'late' then v_minutes_late || '분 지각 (QR 등원)' else 'QR 등원' end)
  on conflict (student_id, class_date, period_number)
  do update set
    status        = excluded.status,
    checked_in_at = excluded.checked_in_at,
    source        = excluded.source,
    note          = excluded.note,
    updated_at    = now()
  returning id into v_attendance_id;

  -- --- 지각 벌점 (트리거가 누적/경고 처리) ---
  if v_status = 'late' then
    insert into public.penalty_records
      (student_id, reason_code, adjustment_type, points, description, related_attendance_id, created_by)
    values
      (v_uid, 'LATE', 'add', 2, v_minutes_late || '분 지각 (QR 자동)', v_attendance_id, null);

    select name into v_student_name from public.users where id = v_uid;
    perform public.notify_admins(
      'late_checkin',
      '지각 등원',
      coalesce(v_student_name, '학생') || ' 학생이 ' || v_minutes_late || '분 지각 등원했습니다. (벌점 2점)',
      v_uid
    );
  end if;

  return jsonb_build_object(
    'action', 'in',
    'status', v_status,
    'minutes_late', v_minutes_late,
    'points_added', case when v_status = 'late' then 2 else 0 end,
    'period_number', v_first_period,
    'scanned_at', now()
  );
end;
$$;

grant execute on function public.current_checkin_token() to authenticated;
grant execute on function public.checkin_by_qr(text) to authenticated;
