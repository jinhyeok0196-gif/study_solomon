-- =========================================================================
-- 학생 자가 등록 함수 (SECURITY DEFINER)
-- 구글 OAuth로 가입한 학생이 public.users / student_profiles에 직접 INSERT할 수
-- 없도록 RLS가 막혀 있으므로, SECURITY DEFINER 함수를 통해 안전하게 생성한다.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.register_student(
  p_name  text,
  p_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 이미 등록된 경우 무시 (멱등성)
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_uid) THEN
    RETURN;
  END IF;

  INSERT INTO public.users (id, name, phone, role)
  VALUES (v_uid, p_name, p_phone, 'student');

  INSERT INTO public.student_profiles (id)
  VALUES (v_uid);
END;
$$;
