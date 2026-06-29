-- =========================================================================
-- 결석/조퇴 신청 취소 정책 완화
--   기존: 학생은 status='pending'인 본인 신청만 삭제 가능.
--   변경: 승인(approved)된 신청도 학생 본인이 직접 취소(삭제)할 수 있도록 허용한다.
--         (관리자는 기존대로 모두 가능)
--   학생이 승인된 결석/조퇴를 취소하면 면제도 함께 사라진다(다시 정상 출석 대상).
-- =========================================================================

drop policy if exists "absence_requests_delete_self_pending_or_admin" on public.absence_requests;
create policy "absence_requests_delete_self_or_admin" on public.absence_requests
  for delete using (public.is_admin() or student_id = auth.uid());

drop policy if exists "leave_requests_delete_self_pending_or_admin" on public.leave_requests;
create policy "leave_requests_delete_self_or_admin" on public.leave_requests
  for delete using (public.is_admin() or student_id = auth.uid());
