-- =========================================================================
-- AI Rule Decisions (ai_rule_decisions)
-- =========================================================================
-- RuleEngine v0.1 이 SeatFacts 로 내린 1차 판정(RuleDecision)을 저장하는 테이블.
--
-- ⚠️ 이 단계는 "AI 판정 결과 저장" 까지만 한다.
--    - 학생 상태 테이블(users/student_profiles)·출결·벌점·알림 테이블은 **건드리지 않는다.**
--    - 저장하는 것은 RuleDecision 의 텍스트/JSON 결과뿐(영상/이미지는 저장하지 않음).
--    - 쓰기는 서버에서 **service role** 로만 한다(학생 앱 직접 쓰기 금지).
--    - 관리자 화면 읽기 정책은 다음 단계에서 별도 migration 으로 추가한다.
-- =========================================================================

create table if not exists public.ai_rule_decisions (
  id            uuid primary key default gen_random_uuid(),
  decision_uuid text unique not null,
  facts_uuid    text,
  burst_uuid    text,
  seat_id       text not null,
  period_id     text,
  period_name   text,
  decided_at    timestamptz not null,

  activity      text not null
    check (activity in ('STUDYING', 'PHONE', 'SLEEPING', 'ABSENT', 'UNKNOWN')),
  confidence    numeric,
  status        text not null
    check (status in ('SUCCESS', 'SKIPPED', 'FAILED', 'LOW_CONFIDENCE')),
  severity      text not null
    check (severity in ('INFO', 'WATCH', 'WARNING', 'CRITICAL')),

  reasons       jsonb not null default '[]',
  evidence      jsonb not null default '{}',
  rule_hits     jsonb not null default '[]',
  quality       jsonb not null default '{}',
  metadata      jsonb not null default '{}',

  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 인덱스 (조회 패턴: 좌석/버스트/시간/활동/상태/심각도)
-- -------------------------------------------------------------------------
create index if not exists ai_rule_decisions_seat_idx     on public.ai_rule_decisions (seat_id);
create index if not exists ai_rule_decisions_burst_idx    on public.ai_rule_decisions (burst_uuid);
create index if not exists ai_rule_decisions_decided_idx  on public.ai_rule_decisions (decided_at desc);
create index if not exists ai_rule_decisions_activity_idx on public.ai_rule_decisions (activity);
create index if not exists ai_rule_decisions_status_idx   on public.ai_rule_decisions (status);
create index if not exists ai_rule_decisions_severity_idx on public.ai_rule_decisions (severity);

-- -------------------------------------------------------------------------
-- RLS
--   기본 잠금(정책 없음) → 일반 anon/authenticated 사용자는 접근 불가.
--   서버의 service role 은 RLS 를 우회하므로 저장/조회가 가능하다.
--   관리자 화면용 read-only(is_admin()) SELECT 정책은 다음 단계에서 별도 추가.
-- -------------------------------------------------------------------------
alter table public.ai_rule_decisions enable row level security;
