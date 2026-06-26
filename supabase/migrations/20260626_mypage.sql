-- =========================================================================
-- 마이페이지: request_logs 테이블, 이용권 컬럼, 승인/반려 함수
-- =========================================================================

-- 이용권 정보 컬럼 추가
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS membership_type text,
  ADD COLUMN IF NOT EXISTS membership_start_date date,
  ADD COLUMN IF NOT EXISTS membership_end_date date;

-- -------------------------------------------------------------------------
-- request_logs: 이름/전화번호 변경 요청 및 회원탈퇴 요청 통합 관리
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.request_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid        NOT NULL REFERENCES public.users(id),
  request_type   text        NOT NULL CHECK (request_type IN ('name_change', 'phone_change', 'withdrawal')),
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  new_value      text,
  reason         text        NOT NULL,
  admin_note     text,
  reviewed_at    timestamptz,
  reviewed_by    uuid        REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "request_logs_select_self_or_admin" ON public.request_logs
  FOR SELECT USING (student_id = auth.uid() OR public.is_admin());

CREATE POLICY "request_logs_insert_self" ON public.request_logs
  FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "request_logs_update_admin" ON public.request_logs
  FOR UPDATE USING (public.is_admin());

-- -------------------------------------------------------------------------
-- approve_request_log: 요청 승인 + 실제 데이터 변경 + 학생 알림
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_request_log(
  p_request_id uuid,
  p_admin_id   uuid,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req request_logs%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM request_logs WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'already processed'; END IF;

  UPDATE request_logs
  SET status = 'approved', reviewed_at = now(), reviewed_by = p_admin_id,
      admin_note = p_admin_note, updated_at = now()
  WHERE id = p_request_id;

  CASE v_req.request_type
    WHEN 'name_change' THEN
      UPDATE users SET name = v_req.new_value, updated_at = now()
      WHERE id = v_req.student_id;
    WHEN 'phone_change' THEN
      UPDATE users SET phone = v_req.new_value, updated_at = now()
      WHERE id = v_req.student_id;
    WHEN 'withdrawal' THEN
      UPDATE users SET status = 'withdrawn', updated_at = now()
      WHERE id = v_req.student_id;
    ELSE NULL;
  END CASE;

  INSERT INTO notifications (recipient_id, recipient_role, related_student_id, type, title, message)
  VALUES (
    v_req.student_id, 'student', v_req.student_id,
    v_req.request_type || '_approved',
    CASE v_req.request_type
      WHEN 'name_change'  THEN '이름 변경 승인'
      WHEN 'phone_change' THEN '전화번호 변경 승인'
      WHEN 'withdrawal'   THEN '회원탈퇴 승인'
    END,
    CASE v_req.request_type
      WHEN 'name_change'  THEN '이름 변경 요청이 승인되었습니다. 새 이름: ' || v_req.new_value
      WHEN 'phone_change' THEN '전화번호 변경 요청이 승인되었습니다. 새 번호: ' || v_req.new_value
      WHEN 'withdrawal'   THEN '회원탈퇴 요청이 승인되었습니다.'
    END
  );
END;
$$;

-- -------------------------------------------------------------------------
-- reject_request_log: 요청 반려 + 학생 알림
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_request_log(
  p_request_id uuid,
  p_admin_id   uuid,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req request_logs%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM request_logs WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'already processed'; END IF;

  UPDATE request_logs
  SET status = 'rejected', reviewed_at = now(), reviewed_by = p_admin_id,
      admin_note = p_admin_note, updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO notifications (recipient_id, recipient_role, related_student_id, type, title, message)
  VALUES (
    v_req.student_id, 'student', v_req.student_id,
    v_req.request_type || '_rejected',
    CASE v_req.request_type
      WHEN 'name_change'  THEN '이름 변경 반려'
      WHEN 'phone_change' THEN '전화번호 변경 반려'
      WHEN 'withdrawal'   THEN '회원탈퇴 반려'
    END,
    CASE
      WHEN p_admin_note IS NOT NULL THEN '요청이 반려되었습니다. 사유: ' || p_admin_note
      ELSE '요청이 반려되었습니다.'
    END
  );
END;
$$;

-- realtime 구독 추가
ALTER PUBLICATION supabase_realtime ADD TABLE public.request_logs;
