-- =====================================================================
-- 무단결석 오기록 보정
--
-- detect_unauthorized_absences() 버그로 재실(등원)했는데 absent(source='system')로
-- 잘못 찍힌 교시를 present로 되돌린다.
--
-- 판정 기준은 inspect_wrong_absences.sql 과 동일(재실 구간 ∩ 교시 겹침).
-- attendance 'absent'→'present' 변경은 무단결석 알림 트리거(status='absent'에서만
-- 발동)를 울리지 않고, 자동 벌점과도 무관하다.
--
-- 사용법: A) 먼저 '미리보기'로 바뀔 행을 확인 → B) '보정 실행'.
--         더 안전하게 하려면 begin; (B 실행) (RETURNING 결과 확인) commit; / 이상하면 rollback;
-- =====================================================================


-- ───────────────────────────────────────────────────────────────────
-- A) 미리보기 — 무엇이 present로 바뀔지 (변경 없음)
-- ───────────────────────────────────────────────────────────────────
with day_presence as (
  select student_id, class_date,
         min(checked_in_at)  as day_in,
         max(checked_out_at) as day_out
  from public.attendance_records
  group by student_id, class_date
)
select
  u.name           as 학생,
  ar.class_date    as 날짜,
  ar.period_number as 교시,
  ar.status        as 현재상태,
  'present'        as 변경후,
  dp.day_in        as 등원,
  dp.day_out       as 하원
from public.attendance_records ar
join public.periods p  on p.period_number = ar.period_number
join public.users u    on u.id = ar.student_id
join day_presence dp   on dp.student_id = ar.student_id and dp.class_date = ar.class_date
where ar.status = 'absent'
  and ar.source = 'system'
  and dp.day_in is not null
  and dp.day_in < (ar.class_date + p.end_time)::timestamptz
  and (dp.day_out is null or dp.day_out > (ar.class_date + p.start_time)::timestamptz)
order by ar.class_date desc, u.name, ar.period_number;


-- ───────────────────────────────────────────────────────────────────
-- B) 보정 실행 — 잘못된 absent를 present로 변경 (RETURNING으로 변경 행 표시)
-- ───────────────────────────────────────────────────────────────────
with day_presence as (
  select student_id, class_date,
         min(checked_in_at)  as day_in,
         max(checked_out_at) as day_out
  from public.attendance_records
  group by student_id, class_date
),
to_fix as (
  select ar.id
  from public.attendance_records ar
  join public.periods p on p.period_number = ar.period_number
  join day_presence dp on dp.student_id = ar.student_id and dp.class_date = ar.class_date
  where ar.status = 'absent'
    and ar.source = 'system'
    and dp.day_in is not null
    and dp.day_in < (ar.class_date + p.end_time)::timestamptz
    and (dp.day_out is null or dp.day_out > (ar.class_date + p.start_time)::timestamptz)
)
update public.attendance_records ar
set status     = 'present',
    note       = '재실 자동 출석 (오기록 보정)',
    updated_at = now()
where ar.id in (select id from to_fix)
returning ar.student_id, ar.class_date, ar.period_number, ar.status, ar.note;
