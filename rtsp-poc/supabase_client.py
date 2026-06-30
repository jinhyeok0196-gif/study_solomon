"""
Supabase Client (서버 저장용)
=============================

RuleDecision 저장은 **서버에서 service role 키**로 한다(브라우저용 anon key 아님).
키 값은 코드에 하드코딩하지 않고 환경변수에서만 읽는다.

환경변수(.env):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

주의:
  - 실제 supabase 파이썬 패키지는 **lazy import** 한다(미설치/미설정 환경에서 모듈 로드가 깨지지 않게).
  - 테스트는 이 클라이언트를 쓰지 않고 FakeAIDecisionRepository 로 통과한다.
"""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("supabase_client")


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def get_supabase_client() -> Any:
    """service role 키로 Supabase 클라이언트를 만든다. 미설정/미설치면 명확히 실패."""
    # .env 가 있으면 로드(없어도 무방)
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:  # pragma: no cover - dotenv 미설치여도 진행
        pass

    url = _env("SUPABASE_URL")
    key = _env("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다(.env 확인). "
            "이 키는 서버 저장용 service role 키이며 코드에 하드코딩하지 않습니다.")

    try:
        from supabase import create_client  # lazy import
    except ImportError as exc:  # pragma: no cover - 패키지 미설치 환경 안내
        raise RuntimeError(
            "supabase 파이썬 패키지가 필요합니다: pip install supabase") from exc

    log.info("Supabase service-role 클라이언트 생성: %s", url)
    return create_client(url, key)
