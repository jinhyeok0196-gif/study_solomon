-- seat_layouts 테이블: 물리적 좌석 배치 관리 (향후 드래그앤드롭 편집 지원)
CREATE TABLE IF NOT EXISTS public.seat_layouts (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  seat_number  int         NOT NULL,
  display_name text        NOT NULL,
  pos_x        int         NOT NULL DEFAULT 0,
  pos_y        int         NOT NULL DEFAULT 0,
  width        int         NOT NULL DEFAULT 1,
  height       int         NOT NULL DEFAULT 1,
  rotation     int         NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seat_layouts_pkey       PRIMARY KEY (id),
  CONSTRAINT seat_layouts_seat_number_key UNIQUE (seat_number)
);

-- 초기 좌석 8개 (4×2 배치, 통로 gap = pos_y 1)
INSERT INTO public.seat_layouts (seat_number, display_name, pos_x, pos_y, sort_order)
VALUES
  (1, '1번', 0, 0, 10),
  (2, '2번', 1, 0, 20),
  (3, '3번', 2, 0, 30),
  (4, '4번', 3, 0, 40),
  (5, '5번', 0, 2, 50),
  (6, '6번', 1, 2, 60),
  (7, '7번', 2, 2, 70),
  (8, '8번', 3, 2, 80)
ON CONFLICT (seat_number) DO NOTHING;

-- student_profiles에 좌석 번호 추가
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS seat_number int
  REFERENCES public.seat_layouts(seat_number) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.seat_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seat_layouts_select_all" ON public.seat_layouts;
CREATE POLICY "seat_layouts_select_all" ON public.seat_layouts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "seat_layouts_modify_admin" ON public.seat_layouts;
CREATE POLICY "seat_layouts_modify_admin" ON public.seat_layouts
  FOR ALL USING (public.is_admin());

-- Realtime 설정
ALTER TABLE public.seat_layouts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'seat_layouts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seat_layouts;
  END IF;
END $$;

-- student_profiles 좌석 변경도 Realtime 에 포함 (이미 등록돼 있으면 skip)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'student_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.student_profiles;
  END IF;
END $$;
