-- =========================================================================
-- Supabase Realtime publication 설정
-- 관리자 대시보드/알림 센터가 실시간으로 반영해야 하는 테이블만 추가한다.
-- 각 테이블은 이미 RLS가 적용되어 있어, Realtime도 구독자의 권한 범위 내에서만
-- 변경 이벤트를 전달한다.
-- =========================================================================

alter publication supabase_realtime add table public.bathroom_logs;
alter publication supabase_realtime add table public.power_nap_logs;
alter publication supabase_realtime add table public.attendance_records;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.warning_records;
