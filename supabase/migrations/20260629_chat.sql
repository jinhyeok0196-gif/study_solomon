-- =========================================================================
-- 채팅 시스템
-- =========================================================================

-- 채팅방 (학생당 1개)
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.users(id) UNIQUE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 채팅 메시지
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.users(id),
  sender_role text NOT NULL CHECK (sender_role IN ('student', 'admin', 'system')),
  content text NOT NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'announcement')),
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- 읽음 확인
CREATE TABLE IF NOT EXISTS public.message_reads (
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  reader_id uuid NOT NULL REFERENCES public.users(id),
  read_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (message_id, reader_id)
);

-- 빠른 답변 (관리자용)
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- 기본 빠른 답변 삽입
INSERT INTO public.quick_replies (content, sort_order) VALUES
  ('확인했습니다.', 1),
  ('잠시만 기다려주세요.', 2),
  ('승인되었습니다.', 3),
  ('반려되었습니다.', 4),
  ('출석해주세요.', 5),
  ('전화 부탁드립니다.', 6),
  ('좋습니다.', 7)
ON CONFLICT DO NOTHING;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON public.chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_reads_reader_id ON public.message_reads(reader_id);

-- -------------------------------------------------------------------------
-- 채팅방 가져오기/생성 함수 (SECURITY DEFINER)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_chat_room(p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_room_id uuid;
BEGIN
  SELECT id INTO v_room_id FROM chat_rooms WHERE student_id = p_student_id;
  IF v_room_id IS NULL THEN
    INSERT INTO chat_rooms (student_id) VALUES (p_student_id) RETURNING id INTO v_room_id;
  END IF;
  UPDATE chat_rooms SET updated_at = now() WHERE id = v_room_id;
  RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_chat_room TO authenticated;

-- -------------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------------
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

-- chat_rooms
CREATE POLICY "student_own_room" ON public.chat_rooms FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "admin_all_rooms" ON public.chat_rooms FOR SELECT USING (is_admin());

-- chat_messages: 학생은 본인 방 메시지만, 관리자는 전체
CREATE POLICY "student_read_own_messages" ON public.chat_messages FOR SELECT
  USING (room_id IN (SELECT id FROM chat_rooms WHERE student_id = auth.uid()));
CREATE POLICY "student_insert_own_messages" ON public.chat_messages FOR INSERT
  WITH CHECK (
    room_id IN (SELECT id FROM chat_rooms WHERE student_id = auth.uid())
    AND sender_id = auth.uid()
    AND sender_role = 'student'
    AND message_type = 'text'
  );
CREATE POLICY "admin_read_all_messages" ON public.chat_messages FOR SELECT USING (is_admin());
CREATE POLICY "admin_insert_any_message" ON public.chat_messages FOR INSERT WITH CHECK (is_admin());

-- message_reads
CREATE POLICY "student_own_reads" ON public.message_reads FOR ALL
  USING (reader_id = auth.uid()) WITH CHECK (reader_id = auth.uid());
CREATE POLICY "admin_all_reads" ON public.message_reads FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- quick_replies: 관리자만
CREATE POLICY "admin_quick_replies" ON public.quick_replies FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- -------------------------------------------------------------------------
-- Realtime
-- -------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
