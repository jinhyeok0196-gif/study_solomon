-- =========================================================================
-- 시간표 수정 권한 요청 (schedule_unlock) 지원
-- request_logs.request_type에 schedule_unlock 추가
-- approve/reject 함수 업데이트
-- =========================================================================

-- request_type CHECK 제약 재설정
ALTER TABLE public.request_logs
  DROP CONSTRAINT IF EXISTS request_logs_request_type_check;

ALTER TABLE public.request_logs
  ADD CONSTRAINT request_logs_request_type_check
  CHECK (request_type IN ('name_change', 'phone_change', 'withdrawal', 'schedule_unlock'));

-- -------------------------------------------------------------------------
-- approve_request_log: schedule_unlock 처리 추가
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
    WHEN 'schedule_unlock' THEN
      UPDATE weekly_schedules
      SET status = 'draft', updated_at = now()
      WHERE student_id = v_req.student_id
        AND week_start_date = v_req.new_value;
    ELSE NULL;
  END CASE;

  INSERT INTO notifications (recipient_id, recipient_role, related_student_id, type, title, message)
  VALUES (
    v_req.student_id, 'student', v_req.student_id,
    v_req.request_type || '_approved',
    CASE v_req.request_type
      WHEN 'name_change'      THEN '이름 변경 승인'
      WHEN 'phone_change'     THEN '전화번호 변경 승인'
      WHEN 'withdrawal'       THEN '회원탈퇴 승인'
      WHEN 'schedule_unlock'  THEN '시간표 수정 권한 승인'
    END,
    CASE v_req.request_type
      WHEN 'name_change'      THEN '이름 변경 요청이 승인되었습니다. 새 이름: ' || v_req.new_value
      WHEN 'phone_change'     THEN '전화번호 변경 요청이 승인되었습니다. 새 번호: ' || v_req.new_value
      WHEN 'withdrawal'       THEN '회원탈퇴 요청이 승인되었습니다.'
      WHEN 'schedule_unlock'  THEN '시간표 수정 권한이 승인되었습니다. 이제 시간표를 수정할 수 있습니다.'
    END
  );
END;
$$;

-- -------------------------------------------------------------------------
-- reject_request_log: schedule_unlock 처리 추가
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
      WHEN 'name_change'      THEN '이름 변경 반려'
      WHEN 'phone_change'     THEN '전화번호 변경 반려'
      WHEN 'withdrawal'       THEN '회원탈퇴 반려'
      WHEN 'schedule_unlock'  THEN '시간표 수정 권한 반려'
    END,
    CASE
      WHEN p_admin_note IS NOT NULL THEN '요청이 반려되었습니다. 사유: ' || p_admin_note
      ELSE '요청이 반려되었습니다.'
    END
  );
END;
$$;
