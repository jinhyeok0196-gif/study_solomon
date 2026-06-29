-- =====================================================================
-- [읽기 전용 / 데이터 변경 없음] 무단결석 오기록 점검
--
-- 크론 detect_unauthorized_absences()의 과거 버그로, 등원해서 실제로 자리에
-- 있었는데도(재실) absent(source='system')로 잘못 찍힌 교시를 찾는다.
--
-- 판정 기준(수정된 크론과 동일): 그날 재실 구간(min 등원 ~ max 하원, 하원기록
-- 없으면 '계속 재실'로 간주)이 교시 구간과 한 순간이라도 겹치면 → 잘못된 absent.
--
-- 주의: source='system'(크론 자동)만 대상. 관리자가 수동으로 찍은 absent는 제외.
-- 사용법: Supabase 대시보드 → SQL Editor에서 아래 1)·2)·3) 블록을 '하나씩 선택 실행'
--         (SQL Editor는 여러 문장 실행 시 마지막 결과만 보여줌)
-- =====================================================================


-- ───────────────────────────────────────────────────────────────────
-- 1) 요약: 영향 규모 (오기록 교시 수 / 학생 수 / 기간)
-- ───────────────────────────────────────────────────────────────────
with day_presence as (
  select student_id, class_date,
         min(checked_in_at)  as day_in,
         max(checked_out_at) as day_out
  from public.attendance_records
  group by student_id, class_date
),
candidates as (
  select ar.student_id, ar.class_date, ar.period_number
  from public.attendance_records ar
  join public.periods p on p.period_number = ar.period_number
  join day_presence dp on dp.student_id = ar.student_id and dp.class_date = ar.class_date
  where ar.status = 'absent'
    and ar.source = 'system'
    and dp.day_in is not null
    and dp.day_in < (ar.class_date + p.end_time)::timestamptz
    and (dp.day_out is null or dp.day_out > (ar.class_date + p.start_time)::timestamptz)
)
select
  count(*)                    as 오기록_교시수,
  count(distinct student_id)  as 영향_학생수,
  min(class_date)             as 최초일,
  max(class_date)             as 최종일
from candidates;


-- ───────────────────────────────────────────────────────────────────
-- 2) 상세 목록: 어떤 학생의 어느 날 몇 교시가 잘못 찍혔는지
-- ───────────────────────────────────────────────────────────────────
with day_presence as (
  select student_id, class_date,
         min(checked_in_at)  as day_in,
         max(checked_out_at) as day_out
  from public.attendance_records
  group by student_id, class_date
)
select
  u.name              as 학생,
  ar.class_date       as 날짜,
  ar.period_number    as 교시,
  p.start_time        as 교시시작,
  p.end_time          as 교시종료,
  dp.day_in           as 등원,
  dp.day_out          as 하원,
  case when dp.day_out is null
       then '재실추정(하원기록없음)'
       else '확실(하원기록으로 재실 확인)'
  end                 as 신뢰도,
  ar.note             as 기존노트
from public.attendance_records ar
join public.periods p     on p.period_number = ar.period_number
join public.users u       on u.id = ar.student_id
join day_presence dp      on dp.student_id = ar.student_id and dp.class_date = ar.class_date
where ar.status = 'absent'
  and ar.source = 'system'
  and dp.day_in is not null
  and dp.day_in < (ar.class_date + p.end_time)::timestamptz
  and (dp.day_out is null or dp.day_out > (ar.class_date + p.start_time)::timestamptz)
order by ar.class_date desc, u.name, ar.period_number;


-- ───────────────────────────────────────────────────────────────────
-- 3) (참고/검토용) 위 오기록과 같은 학생·날짜에 부여된 '무단결석' 벌점
--    UNAUTHORIZED_ABSENCE는 관리자가 수동 부여하는 코드라 자동 회수 대상이 아니다.
--    잘못된 absent를 보고 관리자가 벌점을 줬을 수 있으니, 사람이 직접 검토하라는 목록.
-- ───────────────────────────────────────────────────────────────────
with day_presence as (
  select student_id, class_date,
         min(checked_in_at)  as day_in,
         max(checked_out_at) as day_out
  from public.attendance_records
  group by student_id, class_date
),
candidates as (
  select distinct ar.student_id, ar.class_date
  from public.attendance_records ar
  join public.periods p on p.period_number = ar.period_number
  join day_presence dp on dp.student_id = ar.student_id and dp.class_date = ar.class_date
  where ar.status = 'absent'
    and ar.source = 'system'
    and dp.day_in is not null
    and dp.day_in < (ar.class_date + p.end_time)::timestamptz
    and (dp.day_out is null or dp.day_out > (ar.class_date + p.start_time)::timestamptz)
)
select
  u.name                       as 학생,
  pr.created_at                as 부여시각,
  pr.points                    as 점수,
  pr.adjustment_type           as 가감,
  pr.description               as 설명
from public.penalty_records pr
join public.users u on u.id = pr.student_id
join candidates c
  on c.student_id = pr.student_id
 and c.class_date = (pr.created_at at time zone 'Asia/Seoul')::date
where pr.reason_code = 'UNAUTHORIZED_ABSENCE'
order by pr.created_at desc;
