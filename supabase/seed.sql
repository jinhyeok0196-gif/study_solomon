-- 1~8교시 기본 시간표 (관리자가 추후 시간 조정 가능)
insert into public.periods (period_number, label, start_time, end_time) values
  (1, '1교시', '09:00', '10:20'),
  (2, '2교시', '10:30', '11:50'),
  (3, '3교시', '12:00', '13:20'),
  (4, '4교시', '13:30', '14:50'),
  (5, '5교시', '15:00', '16:20'),
  (6, '6교시', '16:30', '17:50'),
  (7, '7교시', '18:00', '19:20'),
  (8, '8교시', '19:30', '20:50')
on conflict (period_number) do nothing;

-- 운영 규칙 기본값
insert into public.system_settings (key, value, description) values
  ('power_nap_max_minutes', '40', '파워냅 1회 최대 이용 시간(분)'),
  ('power_nap_daily_limit', '1', '파워냅 1일 이용 가능 횟수'),
  ('warning_threshold_first', '10', '1차 경고 발생 누적 벌점'),
  ('warning_threshold_second', '20', '2차 경고 발생 누적 벌점'),
  ('warning_threshold_expulsion', '30', '퇴원 처리 누적 벌점'),
  ('penalty_monthly_reset_day', '1', '매월 벌점 초기화 기준일(1=매월 1일)')
on conflict (key) do nothing;

-- =========================================================================
-- 로컬 개발용 최초 관리자 계정 (운영 환경에는 적용되지 않음 — supabase db reset 으로
-- 로컬 스택에만 생성됨). 전화번호 01000000000 / 비밀번호 admin1234.
-- 이후 계정 생성은 supabase/functions/create-user-account 를 통해서만 이루어진다.
-- =========================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'p01000000000@members.solomonstudycafe.internal',
  crypt('admin1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"운영자"}',
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"p01000000000@members.solomonstudycafe.internal"}',
  'email',
  now(), now()
)
on conflict do nothing;

insert into public.users (id, role, name, phone) values
  ('00000000-0000-0000-0000-000000000001', 'admin', '운영자', '01000000000')
on conflict (id) do nothing;
