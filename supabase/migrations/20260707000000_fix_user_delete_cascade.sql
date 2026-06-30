-- =========================================================================
-- 학생/계정 삭제 시 외래키 위반으로 삭제가 실패하던 문제 수정
--
-- delete-user-account Edge Function 은 service role 로 auth.admin.deleteUser 를
-- 호출하고, 이게 public.users -> student_profiles 로 cascade 되도록 설계됨.
-- 하지만 아래 13개 FK 는 ON DELETE 동작이 NO ACTION(기본값) 으로 남아 있어,
-- 해당 참조 행이 하나라도 있으면 (= 모든 실제 학생) 삭제가 거부되었다.
--
-- 처리 원칙:
--   - 학생 본인 소유 데이터(알림/채팅방/요청)  -> ON DELETE CASCADE
--   - 처리자/작성자 등 감사용 참조(reviewed_by 등) -> ON DELETE SET NULL
-- =========================================================================

-- 학생 본인 소유 데이터 → CASCADE -----------------------------------------
alter table public.chat_rooms
  drop constraint if exists chat_rooms_student_id_fkey,
  add  constraint chat_rooms_student_id_fkey
    foreign key (student_id) references public.users(id) on delete cascade;

alter table public.request_logs
  drop constraint if exists request_logs_student_id_fkey,
  add  constraint request_logs_student_id_fkey
    foreign key (student_id) references public.users(id) on delete cascade;

alter table public.notifications
  drop constraint if exists notifications_recipient_id_fkey,
  add  constraint notifications_recipient_id_fkey
    foreign key (recipient_id) references public.users(id) on delete cascade;

alter table public.notifications
  drop constraint if exists notifications_related_student_id_fkey,
  add  constraint notifications_related_student_id_fkey
    foreign key (related_student_id) references public.student_profiles(id) on delete cascade;

-- message_reads.reader_id 는 NOT NULL + 복합 PK 라 SET NULL 불가 → CASCADE
alter table public.message_reads
  drop constraint if exists message_reads_reader_id_fkey,
  add  constraint message_reads_reader_id_fkey
    foreign key (reader_id) references public.users(id) on delete cascade;

-- 감사/처리자 참조 → SET NULL (이력 보존, 사람만 비움) ---------------------
alter table public.chat_messages
  drop constraint if exists chat_messages_sender_id_fkey,
  add  constraint chat_messages_sender_id_fkey
    foreign key (sender_id) references public.users(id) on delete set null;

alter table public.absence_requests
  drop constraint if exists absence_requests_reviewed_by_fkey,
  add  constraint absence_requests_reviewed_by_fkey
    foreign key (reviewed_by) references public.users(id) on delete set null;

alter table public.leave_requests
  drop constraint if exists leave_requests_reviewed_by_fkey,
  add  constraint leave_requests_reviewed_by_fkey
    foreign key (reviewed_by) references public.users(id) on delete set null;

alter table public.request_logs
  drop constraint if exists request_logs_reviewed_by_fkey,
  add  constraint request_logs_reviewed_by_fkey
    foreign key (reviewed_by) references public.users(id) on delete set null;

alter table public.penalty_records
  drop constraint if exists penalty_records_created_by_fkey,
  add  constraint penalty_records_created_by_fkey
    foreign key (created_by) references public.users(id) on delete set null;

alter table public.warning_records
  drop constraint if exists warning_records_issued_by_fkey,
  add  constraint warning_records_issued_by_fkey
    foreign key (issued_by) references public.users(id) on delete set null;

alter table public.activity_logs
  drop constraint if exists activity_logs_actor_id_fkey,
  add  constraint activity_logs_actor_id_fkey
    foreign key (actor_id) references public.users(id) on delete set null;

alter table public.system_settings
  drop constraint if exists system_settings_updated_by_fkey,
  add  constraint system_settings_updated_by_fkey
    foreign key (updated_by) references public.users(id) on delete set null;
