-- =========================================================================
-- 외출(bathroom_logs)·파워냅(power_nap_logs) 사유 기록
--   학생이 외출/파워냅 시작 시 선택한 사유를 저장한다.
--   - 미리 정의된 사유(예: 졸음, 화장실)는 그 라벨을 그대로 저장
--   - '기타' 선택 시 학생이 직접 입력한 내용을 저장
--   기존 행은 reason NULL (사유 미기록)로 둔다.
-- =========================================================================

alter table public.power_nap_logs add column if not exists reason text;
alter table public.bathroom_logs add column if not exists reason text;
