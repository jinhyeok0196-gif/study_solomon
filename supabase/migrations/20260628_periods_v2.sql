-- =========================================================================
-- periods 테이블 v2: display_name, category, duration_minutes, display_color,
-- sort_order, is_selectable 컬럼 추가 및 데이터 업데이트
-- =========================================================================

-- period_number 범위 제약(1~8) 제거: 0교시, 식사, 자율학습 추가를 위해
ALTER TABLE public.periods DROP CONSTRAINT IF EXISTS periods_period_number_check;

ALTER TABLE public.periods
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'class'
    CHECK (category IN ('class', 'meal', 'arrival', 'free')),
  ADD COLUMN IF NOT EXISTS duration_minutes smallint,
  ADD COLUMN IF NOT EXISTS display_color text NOT NULL DEFAULT '#16a34a',
  ADD COLUMN IF NOT EXISTS sort_order smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_selectable boolean NOT NULL DEFAULT true;

-- 기존 1~8교시 데이터 업데이트 (운영 시간 반영)
UPDATE public.periods SET
  display_name = label,
  category = 'class',
  is_selectable = true,
  duration_minutes = CASE period_number
    WHEN 1 THEN 80 WHEN 2 THEN 100 WHEN 3 THEN 80
    WHEN 4 THEN 80 WHEN 5 THEN 70  WHEN 6 THEN 80
    WHEN 7 THEN 60 WHEN 8 THEN 80
  END,
  display_color = CASE WHEN period_number = 8 THEN '#4ade80' ELSE '#16a34a' END,
  sort_order = CASE period_number
    WHEN 1 THEN 10 WHEN 2 THEN 20 WHEN 3 THEN 40
    WHEN 4 THEN 50 WHEN 5 THEN 60 WHEN 6 THEN 80
    WHEN 7 THEN 90 WHEN 8 THEN 100
  END,
  start_time = CASE period_number
    WHEN 1 THEN '09:00'::time WHEN 2 THEN '10:40'::time WHEN 3 THEN '13:40'::time
    WHEN 4 THEN '15:20'::time WHEN 5 THEN '17:00'::time WHEN 6 THEN '19:30'::time
    WHEN 7 THEN '21:00'::time WHEN 8 THEN '22:20'::time
  END,
  end_time = CASE period_number
    WHEN 1 THEN '10:20'::time WHEN 2 THEN '12:20'::time WHEN 3 THEN '15:00'::time
    WHEN 4 THEN '16:40'::time WHEN 5 THEN '18:10'::time WHEN 6 THEN '20:50'::time
    WHEN 7 THEN '22:00'::time WHEN 8 THEN '23:40'::time
  END
WHERE period_number BETWEEN 1 AND 8;

-- 비선택 교시 삽입 (0=등원, 21=점심, 22=저녁, 23=자율학습)
INSERT INTO public.periods
  (period_number, label, display_name, start_time, end_time, category, duration_minutes, display_color, sort_order, is_selectable, is_active)
VALUES
  (0,  '0교시',   '0교시',   '08:30', '09:00', 'arrival', 30,   '#9ca3af', 5,   false, true),
  (21, '점심식사', '점심식사', '12:20', '13:40', 'meal',    80,   '#eab308', 30,  false, true),
  (22, '저녁식사', '저녁식사', '18:10', '19:30', 'meal',    80,   '#eab308', 70,  false, true),
  (23, '자율학습', '자율학습', '23:40', '08:30', 'free',    NULL, '#bbf7d0', 110, false, true)
ON CONFLICT (period_number) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  category         = EXCLUDED.category,
  duration_minutes = EXCLUDED.duration_minutes,
  display_color    = EXCLUDED.display_color,
  sort_order       = EXCLUDED.sort_order,
  is_selectable    = EXCLUDED.is_selectable,
  start_time       = EXCLUDED.start_time,
  end_time         = EXCLUDED.end_time;
