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
