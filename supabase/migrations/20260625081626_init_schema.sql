-- =========================================================================
-- 솔로몬스터디카페 - 초기 스키마
-- =========================================================================

-- -------------------------------------------------------------------------
-- users: auth.users 1:1 프로필. role 기반 권한 분기의 기준 테이블.
-- -------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'admin')),
  name text not null,
  phone text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended', 'expelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_role_idx on public.users (role);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- student_profiles: 학생 전용 부가 정보 + 벌점/경고 누적치(조회 성능을 위한 비정규화 캐시).
-- -------------------------------------------------------------------------
create table public.student_profiles (
  id uuid primary key references public.users (id) on delete cascade,
  student_number text unique,
  school text,
  grade text,
  guardian_phone text,
  enrollment_date date not null default current_date,
  membership_status text not null default 'active'
    check (membership_status in ('active', 'paused', 'expelled')),
  current_penalty_points smallint not null default 0,
  warning_count smallint not null default 0,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index student_profiles_membership_status_idx on public.student_profiles (membership_status);

create trigger student_profiles_set_updated_at
  before update on public.student_profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- periods: 1~8교시 마스터 데이터 (관리자가 시간 조정 가능).
-- -------------------------------------------------------------------------
create table public.periods (
  period_number smallint primary key check (period_number between 1 and 8),
  label text not null,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger periods_set_updated_at
  before update on public.periods
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- system_settings: 전역 운영 설정 key-value (파워냅 제한 시간, 벌점 임계값 등).
-- -------------------------------------------------------------------------
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

create trigger system_settings_set_updated_at
  before update on public.system_settings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- weekly_schedules: 학생이 제출하는 주간 시간표 1건 (월요일 기준 주 단위).
-- -------------------------------------------------------------------------
create table public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  week_start_date date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, week_start_date)
);

create index weekly_schedules_student_id_idx on public.weekly_schedules (student_id);
create index weekly_schedules_week_start_date_idx on public.weekly_schedules (week_start_date);

create trigger weekly_schedules_set_updated_at
  before update on public.weekly_schedules
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- schedule_items: 주간 시간표 내 (요일, 교시) 선택 항목.
-- 수정 이력은 activity_logs 에 별도로 기록한다.
-- -------------------------------------------------------------------------
create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  weekly_schedule_id uuid not null references public.weekly_schedules (id) on delete cascade,
  day_of_week text not null check (day_of_week in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  period_number smallint not null references public.periods (period_number),
  created_at timestamptz not null default now(),
  unique (weekly_schedule_id, day_of_week, period_number)
);

create index schedule_items_weekly_schedule_id_idx on public.schedule_items (weekly_schedule_id);

-- -------------------------------------------------------------------------
-- attendance_records: 교시 단위 실제 출결 결과. 출석률/통계 산출의 기준 테이블.
-- -------------------------------------------------------------------------
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  class_date date not null,
  period_number smallint not null references public.periods (period_number),
  status text not null check (
    status in ('present', 'absent', 'late', 'early_leave', 'excused_absence', 'excused_early_leave')
  ),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  source text not null default 'system' check (source in ('self', 'admin', 'system')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, class_date, period_number)
);

create index attendance_records_student_id_idx on public.attendance_records (student_id);
create index attendance_records_class_date_idx on public.attendance_records (class_date);
create index attendance_records_status_idx on public.attendance_records (status);

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- absence_requests: 결석 신청.
-- -------------------------------------------------------------------------
create table public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  request_date date not null,
  period_numbers smallint[] not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index absence_requests_student_id_idx on public.absence_requests (student_id);
create index absence_requests_status_idx on public.absence_requests (status);

create trigger absence_requests_set_updated_at
  before update on public.absence_requests
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- leave_requests: 조퇴 신청 (구조는 absence_requests 와 동일).
-- -------------------------------------------------------------------------
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  request_date date not null,
  period_numbers smallint[] not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leave_requests_student_id_idx on public.leave_requests (student_id);
create index leave_requests_status_idx on public.leave_requests (status);

create trigger leave_requests_set_updated_at
  before update on public.leave_requests
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- bathroom_logs: 외출 시작/복귀 기록 (카카오톡 보고 절차 대체).
-- -------------------------------------------------------------------------
create table public.bathroom_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'ongoing' check (status in ('ongoing', 'completed', 'overdue')),
  created_at timestamptz not null default now()
);

create index bathroom_logs_student_id_idx on public.bathroom_logs (student_id);
create index bathroom_logs_status_idx on public.bathroom_logs (status);
-- 학생당 진행 중(ongoing) 외출은 동시에 1건만 허용.
create unique index bathroom_logs_one_ongoing_per_student_idx
  on public.bathroom_logs (student_id)
  where (status = 'ongoing');

-- -------------------------------------------------------------------------
-- power_nap_logs: 파워냅 기록. 1일 1회, 최대 40분 제한을 unique 제약 + 애플리케이션
-- 로직으로 강제한다.
-- -------------------------------------------------------------------------
create table public.power_nap_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  nap_date date not null default current_date,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_end_at timestamptz not null,
  status text not null default 'ongoing'
    check (status in ('ongoing', 'completed', 'overdue', 'unauthorized')),
  is_unauthorized boolean not null default false,
  created_at timestamptz not null default now(),
  unique (student_id, nap_date)
);

create index power_nap_logs_student_id_idx on public.power_nap_logs (student_id);
create index power_nap_logs_status_idx on public.power_nap_logs (status);

-- -------------------------------------------------------------------------
-- penalty_records: 벌점 부여/차감 이력. adjustment_type 으로 가감을 구분한다.
-- -------------------------------------------------------------------------
create table public.penalty_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  reason_code text not null,
  adjustment_type text not null check (adjustment_type in ('add', 'subtract')),
  points smallint not null check (points > 0),
  description text,
  related_attendance_id uuid references public.attendance_records (id),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index penalty_records_student_id_idx on public.penalty_records (student_id);
create index penalty_records_created_at_idx on public.penalty_records (created_at);

-- -------------------------------------------------------------------------
-- warning_records: 1차/2차 경고, 퇴원 처리 이력. 벌점 초기화와 무관하게 영구 보관.
-- -------------------------------------------------------------------------
create table public.warning_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  warning_level smallint not null check (warning_level in (1, 2, 3)),
  triggered_penalty_total smallint not null,
  is_auto_generated boolean not null default true,
  issued_by uuid references public.users (id),
  note text,
  issued_at timestamptz not null default now()
);

create index warning_records_student_id_idx on public.warning_records (student_id);

-- -------------------------------------------------------------------------
-- notifications: 실시간 알림 (외출/복귀/파워냅/무단결석/경고 등).
-- recipient_id 가 null 이면 전체 관리자 대상 알림.
-- -------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role text not null check (recipient_role in ('admin', 'student')),
  recipient_id uuid references public.users (id),
  type text not null,
  title text not null,
  message text not null,
  related_student_id uuid references public.student_profiles (id),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_recipient_id_idx on public.notifications (recipient_id);
create index notifications_recipient_role_idx on public.notifications (recipient_role);
create index notifications_created_at_idx on public.notifications (created_at desc);

-- -------------------------------------------------------------------------
-- activity_logs: 범용 감사 로그 (시간표 수정 이력 포함). 확장에 열려있는 구조.
-- -------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id),
  actor_role text,
  action text not null,
  target_table text,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index activity_logs_actor_id_idx on public.activity_logs (actor_id);
create index activity_logs_target_idx on public.activity_logs (target_table, target_id);
create index activity_logs_created_at_idx on public.activity_logs (created_at desc);

-- 참고: 향후 ai_activity_logs(좌석 CCTV 분석 결과)를 추가할 때는
-- student_id, seat_id, captured_at, status('seated'|'studying'|'phone_use'|'drowsy'|'away'),
-- confidence, raw_meta(jsonb) 형태로 본 activity_logs 와 분리된 테이블로 확장한다.
