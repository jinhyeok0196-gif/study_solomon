-- =========================================================================
-- chat_messages, message_reads 테이블 REPLICA IDENTITY FULL 설정
-- Supabase Realtime postgres_changes + RLS 동작에 필수
-- 없으면 INSERT 이벤트가 클라이언트에 전달되지 않음
-- =========================================================================
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reads REPLICA IDENTITY FULL;
ALTER TABLE public.chat_rooms REPLICA IDENTITY FULL;
