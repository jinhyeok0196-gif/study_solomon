-- =========================================================================
-- 솔로몬스터디카페 - 공용 함수 (테이블에 의존하지 않는 것만)
-- =========================================================================

create extension if not exists pgcrypto;

-- updated_at 자동 갱신 트리거 함수
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
