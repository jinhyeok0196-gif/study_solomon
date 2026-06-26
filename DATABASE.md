# DATABASE — 스키마 및 RLS 정책

Supabase(PostgreSQL) 기반. 모든 테이블은 `public` 스키마에 위치합니다.

---

## 테이블 목록

| 테이블 | 설명 |
|---|---|
| `users` | 전체 사용자 (학생+관리자). auth.users 1:1 미러 |
| `student_profiles` | 학생 전용 부가 정보 + 벌점/경고 캐시 |
| `periods` | 1~8교시 마스터 데이터 (시간 조정 가능) |
| `system_settings` | 전역 운영 설정 key-value |
| `weekly_schedules` | 학생이 제출하는 주간 시간표 헤더 |
| `schedule_items` | 주간 시간표 내 (요일×교시) 선택 항목 |
| `attendance_records` | 교시 단위 실제 출결 결과 |
| `absence_requests` | 결석 신청 |
| `leave_requests` | 조퇴 신청 |
| `bathroom_logs` | 외출 시작/복귀 기록 |
| `power_nap_logs` | 파워냅 기록 |
| `penalty_records` | 벌점 부여/차감 이력 |
| `warning_records` | 경고·퇴원 이력 |
| `notifications` | 실시간 알림 |
| `activity_logs` | 범용 감사 로그 |
| `chat_rooms` | 1:1 채팅방 (학생당 1개) |
| `chat_messages` | 채팅 메시지 |
| `message_reads` | 메시지 읽음 확인 |
| `quick_replies` | 관리자용 빠른 답변 템플릿 |
| `seat_layouts` | 물리적 좌석 배치 (실시간 관제판, 향후 드래그앤드롭 편집) |

---

## 테이블 상세 스키마

### users
```sql
id            uuid      PK  -- auth.users.id 참조
role          text      -- 'student' | 'admin'
name          text
phone         text      UNIQUE
status        text      -- 'active' | 'suspended' | 'expelled'
created_at    timestamptz
updated_at    timestamptz
```

### student_profiles
```sql
id                    uuid      PK  -- users.id 참조
student_number        text      UNIQUE NULL
school                text      NULL
grade                 text      NULL
guardian_phone        text      NULL
enrollment_date       date
membership_status     text      -- 'active' | 'paused' | 'expelled'
current_penalty_points smallint  DEFAULT 0  -- 비정규화 캐시
warning_count         smallint  DEFAULT 0  -- 비정규화 캐시
seat_number           int       NULL  -- seat_layouts.seat_number 참조 (배정 좌석)
memo                  text      NULL
created_at            timestamptz
updated_at            timestamptz
```

### periods
```sql
period_number  smallint  PK  -- 1~8
label          text      -- '1교시' ~ '8교시'
start_time     time
end_time       time
is_active      boolean   DEFAULT true
created_at     timestamptz
updated_at     timestamptz
```
기본값: 09:00~20:50 (10분 휴식 포함)

### system_settings
```sql
key          text      PK
value        jsonb
description  text      NULL
updated_at   timestamptz
updated_by   uuid      NULL  -- users.id 참조
```
주요 키: `powernap_max_minutes`, `schedule_unlock`, `penalty_thresholds`

### weekly_schedules
```sql
id              uuid      PK
student_id      uuid      -- student_profiles.id 참조
week_start_date date      -- 해당 주 월요일
status          text      -- 'draft' | 'submitted'
submitted_at    timestamptz  NULL
created_at      timestamptz
updated_at      timestamptz
UNIQUE (student_id, week_start_date)
```

### schedule_items
```sql
id                  uuid      PK
weekly_schedule_id  uuid      -- weekly_schedules.id 참조
day_of_week         text      -- 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
period_number       smallint  -- periods.period_number 참조
created_at          timestamptz
UNIQUE (weekly_schedule_id, day_of_week, period_number)
```

### attendance_records
```sql
id              uuid      PK
student_id      uuid      -- student_profiles.id 참조
class_date      date
period_number   smallint  -- periods.period_number 참조
status          text      -- 'present' | 'absent' | 'late' | 'early_leave'
                          -- | 'excused_absence' | 'excused_early_leave'
checked_in_at   timestamptz  NULL
checked_out_at  timestamptz  NULL
source          text      -- 'self' | 'admin' | 'system'
note            text      NULL
created_at      timestamptz
updated_at      timestamptz
UNIQUE (student_id, class_date, period_number)
```

### absence_requests / leave_requests (구조 동일)
```sql
id              uuid      PK
student_id      uuid      -- student_profiles.id 참조
request_date    date
period_numbers  smallint[]
reason          text
status          text      -- 'pending' | 'approved' | 'rejected'
reviewed_by     uuid      NULL  -- users.id 참조
reviewed_at     timestamptz  NULL
created_at      timestamptz
updated_at      timestamptz
```

### bathroom_logs (외출)
```sql
id          uuid      PK
student_id  uuid      -- student_profiles.id 참조
started_at  timestamptz  DEFAULT now()
ended_at    timestamptz  NULL
status      text      -- 'ongoing' | 'completed' | 'overdue'
created_at  timestamptz
UNIQUE (student_id) WHERE status = 'ongoing'  -- 동시 1건 제한
```

### power_nap_logs
```sql
id               uuid      PK
student_id       uuid      -- student_profiles.id 참조
nap_date         date      DEFAULT current_date
started_at       timestamptz  DEFAULT now()
ended_at         timestamptz  NULL
planned_end_at   timestamptz
status           text      -- 'ongoing' | 'completed' | 'overdue' | 'unauthorized'
is_unauthorized  boolean   DEFAULT false
created_at       timestamptz
UNIQUE (student_id, nap_date)  -- 1일 1회 제한
```

### penalty_records
```sql
id                     uuid      PK
student_id             uuid      -- student_profiles.id 참조
reason_code            text      -- PENALTY_POINTS 키값
adjustment_type        text      -- 'add' | 'subtract'
points                 smallint  CHECK (points > 0)
description            text      NULL
related_attendance_id  uuid      NULL  -- attendance_records.id 참조
created_by             uuid      NULL  -- users.id 참조
created_at             timestamptz
```

### warning_records
```sql
id                      uuid      PK
student_id              uuid      -- student_profiles.id 참조
warning_level           smallint  -- 1 | 2 | 3 (3 = 퇴원)
triggered_penalty_total smallint
is_auto_generated       boolean   DEFAULT true
issued_by               uuid      NULL  -- users.id 참조
note                    text      NULL
issued_at               timestamptz
```

### notifications
```sql
id                 uuid      PK
recipient_role     text      -- 'admin' | 'student'
recipient_id       uuid      NULL  -- users.id (null이면 전체 관리자)
type               text      -- 'outing_start' | 'outing_return' | 'power_nap_start'
                             -- | 'power_nap_end' | 'warning_issued' | 'unauthorized_absence' 등
title              text
message            text
related_student_id uuid      NULL  -- student_profiles.id
is_read            boolean   DEFAULT false
created_at         timestamptz
```

### activity_logs
```sql
id           uuid      PK
actor_id     uuid      NULL  -- users.id
actor_role   text      NULL
action       text      -- 'schedule_updated', 'attendance_updated' 등
target_table text      NULL
target_id    uuid      NULL
detail       jsonb     NULL
created_at   timestamptz
```

### chat_rooms
```sql
id          uuid      PK
student_id  uuid      UNIQUE  -- users.id 참조 (학생당 1개)
created_at  timestamptz
updated_at  timestamptz
```

### chat_messages
```sql
id           uuid      PK
room_id      uuid      -- chat_rooms.id 참조
sender_id    uuid      NULL  -- users.id
sender_role  text      -- 'student' | 'admin' | 'system'
content      text      -- 이미지: '__IMG__:https://...' 접두사
message_type text      -- 'text' | 'system' | 'announcement'
metadata     jsonb     NULL
created_at   timestamptz
REPLICA IDENTITY FULL  -- Realtime 필수
```

### message_reads
```sql
message_id  uuid      -- chat_messages.id
reader_id   uuid      -- users.id
read_at     timestamptz  DEFAULT now()
PRIMARY KEY (message_id, reader_id)
REPLICA IDENTITY FULL
```

### quick_replies
```sql
id          uuid      PK
content     text
sort_order  smallint  DEFAULT 0
created_at  timestamptz
```

### seat_layouts
```sql
id            uuid      PK
seat_number   int       UNIQUE  -- 좌석 번호 (student_profiles.seat_number 참조 대상)
display_name  text      -- 좌석 표시명 (예: '3번')
pos_x         int       DEFAULT 0  -- 그리드 X 좌표
pos_y         int       DEFAULT 0  -- 그리드 Y 좌표 (통로는 +2 간격으로 표현)
width         int       DEFAULT 1  -- 좌석 너비 (그리드 단위)
height        int       DEFAULT 1  -- 좌석 높이
rotation      int       DEFAULT 0  -- 회전 각도 (향후 드래그앤드롭 편집용)
is_active     boolean   DEFAULT true
sort_order    int       DEFAULT 0
created_at    timestamptz
updated_at    timestamptz
-- REPLICA IDENTITY FULL (Realtime), publication 등록됨
```

---

## RLS 정책 원칙

```
is_admin() → 전체 접근
학생      → 본인 데이터만 접근 (student_id = auth.uid())
```

**헬퍼 함수**
```sql
public.is_admin()          -- users 테이블에서 role = 'admin' 확인
public.current_user_role() -- 현재 사용자 role 반환
```

### 테이블별 정책 요약

| 테이블 | 학생 SELECT | 학생 INSERT/UPDATE | 관리자 |
|---|---|---|---|
| `users` | 본인만 | X | 전체 |
| `student_profiles` | 본인만 | X | 전체 |
| `periods` | O (전체) | X | 전체 |
| `system_settings` | O (전체) | X | 전체 |
| `weekly_schedules` | 본인만 | 본인만 | 전체 |
| `schedule_items` | 본인만 | 본인만 | 전체 |
| `attendance_records` | 본인만 | X | 전체 |
| `absence_requests` | 본인만 | 본인만 | 전체 |
| `leave_requests` | 본인만 | 본인만 | 전체 |
| `bathroom_logs` | 본인만 | 본인만 | 전체 |
| `power_nap_logs` | 본인만 | 본인만 | 전체 |
| `penalty_records` | 본인만 | X | 전체 |
| `warning_records` | 본인만 | X | 전체 |
| `notifications` | 본인 또는 role=student | X | 전체 |
| `chat_rooms` | 본인만 | X (함수 사용) | 전체 |
| `chat_messages` | 본인 채팅방만 | 본인 채팅방만 | 전체 |
| `message_reads` | 본인만 | 본인만 | 전체 |
| `quick_replies` | X | X | 전체 |
| `seat_layouts` | O (전체) | X | 전체 |

---

## Supabase Realtime 구독 테이블

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  notifications,
  bathroom_logs,
  power_nap_logs,
  attendance_records,
  chat_messages,
  message_reads,
  chat_rooms,
  seat_layouts,
  student_profiles;
```

`chat_messages`, `message_reads`, `chat_rooms`, `seat_layouts` — `REPLICA IDENTITY FULL` 적용됨
`student_profiles` — 좌석 배정(`seat_number`) 변경을 관제 화면에 실시간 반영하기 위해 추가

---

## SECURITY DEFINER 함수

| 함수 | 설명 |
|---|---|
| `public.is_admin()` | 현재 사용자 관리자 여부 |
| `public.current_user_role()` | 현재 사용자 역할 |
| `public.set_updated_at()` | `updated_at` 자동 갱신 트리거 |
| `public.register_student(p_name, p_phone)` | 학생 자가 등록 (RLS 우회) |
| `public.get_or_create_chat_room(p_student_id)` | 채팅방 생성/조회 (RLS 우회) |
| `public.approve_request_log(...)` | 신청 승인 처리 |
| `public.reject_request_log(...)` | 신청 반려 처리 |
| `public.notify_admins(type, title, message, student_id)` | 관리자 알림 INSERT |

---

## 자동 트리거

| 트리거 | 이벤트 | 동작 |
|---|---|---|
| `bathroom_logs_notify_start` | `bathroom_logs` INSERT | 외출 시작 알림 생성 |
| `bathroom_logs_notify_return` | `bathroom_logs` UPDATE | 복귀 알림 생성 |
| `power_nap_logs_notify_*` | `power_nap_logs` INSERT/UPDATE | 파워냅 시작/종료 알림 |
| `penalty_warning_trigger` | `penalty_records` INSERT | 임계값 도달 시 경고 자동 생성 |
| `unauthorized_absence_*` | 스케줄/시간 기반 | 무단결석 감지 및 벌점 부여 |
| `users_set_updated_at` 등 | `BEFORE UPDATE` | `updated_at` 자동 갱신 |

---

## 마이그레이션 파일 순서

```
20260625081625_functions_and_triggers.sql  -- 공용 함수 (set_updated_at, pgcrypto)
20260625081626_init_schema.sql             -- 전체 테이블 생성
20260625081627_auth_helpers.sql            -- is_admin(), current_user_role()
20260625081628_rls_policies.sql            -- RLS 정책
20260625083714_grants.sql                  -- 권한 부여
20260625090119_penalty_warning_trigger.sql -- 벌점→경고 트리거
20260625092812_notification_triggers.sql   -- 알림 트리거
20260625092927_unauthorized_absence_detection.sql -- 무단결석 감지
20260625092953_realtime_publication.sql    -- Realtime publication 설정
20260626_mypage.sql                        -- 마이페이지 관련
20260627_register_student_fn.sql           -- register_student 함수
20260627_schedule_unlock.sql               -- 시간표 잠금 설정
20260628_periods_v2.sql                    -- 교시 테이블 업데이트
20260629_chat.sql                          -- 채팅 시스템
20260630_chat_storage.sql                  -- Storage 버킷 설정
20260701_chat_replica_identity.sql         -- Realtime REPLICA IDENTITY
20260702_seat_layouts.sql                  -- 좌석 배치 + student_profiles.seat_number
```
