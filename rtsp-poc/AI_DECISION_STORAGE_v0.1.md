# Solomon AI Decision Storage v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: `RuleDecision` 을 Supabase `ai_rule_decisions` 테이블에 **저장**하는 파이프라인.
> **저장까지만** 한다 — 대시보드 표시 / 학생 상태 변경 / 알림 / 벌점 / 출결 / 영상·이미지 저장은 **절대 안 함.**
> 저장은 **서버 service role** 로만(학생 앱 직접 쓰기 금지), 키는 코드 하드코딩 없이 `.env` 에서만 읽음.
> 실제 Supabase 연결 없이 **FakeAIDecisionRepository 로 9개 테스트 전부 통과**.

---

## 1. 전체 프로젝트 트리

```
codespaces-react/
├── supabase/migrations/
│   └── 20260708000000_ai_rule_decisions.sql   # ★신규 ai_rule_decisions 테이블 + 인덱스 + RLS
│
└── rtsp-poc/
    ├── config/ (roi/mediapipe/yolo/rules.yaml)                          # (기존)
    ├── plugins/ (dummy/opencv/mediapipe/yolo engine)                    # (기존)
    ├── seat_facts.py / fusion_result.py / facts_fusion_engine.py        # (기존) Fusion
    ├── activity_labels.py / rule_decision.py / rule_engine.py           # (기존) Rule Engine
    │
    ├── decision_serializer.py        # ★신규 RuleDecision → 저장용 dict(검증/ISO/JSON)
    ├── supabase_client.py            # ★신규 service-role 클라이언트(lazy, env 전용)
    ├── ai_decision_repository.py     # ★신규 AIDecisionRepository + FakeAIDecisionRepository
    ├── ai_decision_storage_pipeline.py  # ★신규 SeatFacts→판정→저장 파이프라인
    ├── decision_storage_demo.py      # ★신규 CLI 데모(--fake --save-disabled / --save)
    ├── test_ai_decision_storage.py   # ★신규 테스트(Fake repo, Supabase 불필요)
    │
    ├── .env.example                  # ✎수정 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 추가
    ├── *_demo.py / test_*.py / manage.py / main.py                      # (기존)
    └── README.md                     # ✎수정 AI Decision Storage v0.1 + RLS 보안 절 추가
```

★ = 신규, ✎ = 수정. (engine_registry/.gitignore 무수정. migration 은 **파일 생성만** — 원격 적용은 별도.)

---

## 2. 신규 파일 전체 코드

### 2-1. `decision_serializer.py`

```python
"""
Decision Serializer
===================

RuleDecision → Supabase(JSONB) 저장 가능한 dict 로 변환한다.

  - datetime 은 ISO 문자열로 변환.
  - reasons/evidence/rule_hits/quality/metadata 는 JSONB 저장 가능한 형태로 정리.
  - 필수값(decision_uuid/seat_id/activity/status/severity/decided_at)을 검증한다.
    검증 실패 시 저장하지 않고 명확한 에러(DecisionValidationError)를 던진다.

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 변환).
"""

from __future__ import annotations

from typing import Any, Dict

# 저장 전 반드시 존재해야 하는 필드
REQUIRED_FIELDS = ("decision_uuid", "seat_id", "activity", "status", "severity", "decided_at")


class DecisionValidationError(ValueError):
    """RuleDecision 필수값 누락 등 직렬화 검증 실패."""


def _iso(dt: Any) -> Any:
    """datetime → ISO 문자열. 이미 문자열이면 그대로."""
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


def _num(v: Any):
    """confidence 등 숫자 → float(없으면 None)."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def serialize_decision(decision: Any) -> Dict[str, Any]:
    """RuleDecision → 저장용 dict. 필수값 누락 시 DecisionValidationError."""
    missing = []
    for f in REQUIRED_FIELDS:
        v = getattr(decision, f, None)
        if v is None or (isinstance(v, str) and not v.strip()):
            missing.append(f)
    if missing:
        raise DecisionValidationError(f"RuleDecision 필수값 누락: {missing}")

    return {
        "decision_uuid": decision.decision_uuid,
        "facts_uuid": getattr(decision, "facts_uuid", None),
        "burst_uuid": getattr(decision, "burst_uuid", None),
        "seat_id": decision.seat_id,
        "period_id": getattr(decision, "period_id", None),
        "period_name": getattr(decision, "period_name", None),
        "decided_at": _iso(decision.decided_at),
        "activity": decision.activity,
        "confidence": _num(getattr(decision, "confidence", None)),
        "status": decision.status,
        "severity": decision.severity,
        "reasons": list(getattr(decision, "reasons", []) or []),
        "evidence": dict(getattr(decision, "evidence", {}) or {}),
        "rule_hits": list(getattr(decision, "rule_hits", []) or []),
        "quality": dict(getattr(decision, "quality", {}) or {}),
        "metadata": dict(getattr(decision, "metadata", {}) or {}),
    }
```

### 2-2. `supabase_client.py`

```python
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
```

### 2-3. `ai_decision_repository.py`

```python
"""
AI Decision Repository
======================

RuleDecision 을 Supabase 의 ai_rule_decisions 테이블에 **저장/조회만** 한다.

  save_decision / get_latest_by_seat / get_recent_by_seat / health

⚠️ 이 모듈은 **저장/조회만** 한다. 학생 상태 변경/출결/벌점/알림 로직은 절대 넣지 않는다.

테스트는 실제 Supabase 연결 없이 FakeAIDecisionRepository 로 통과한다.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from decision_serializer import serialize_decision

log = logging.getLogger("ai_decision_repository")

TABLE = "ai_rule_decisions"


class RepositoryError(Exception):
    """저장/조회 실패."""


class AIDecisionRepository:
    """Supabase(service role) 기반 실제 repository."""

    def __init__(self, client: Optional[Any] = None) -> None:
        self._client = client
        self._ready = False

    def initialize(self) -> None:
        if self._client is None:
            from supabase_client import get_supabase_client   # lazy
            self._client = get_supabase_client()
        self._ready = True
        log.info("AIDecisionRepository 초기화 - table=%s", TABLE)

    def save_decision(self, decision: Any) -> Dict[str, Any]:
        """RuleDecision 직렬화 후 insert. (검증 실패/insert 실패 시 예외)"""
        row = serialize_decision(decision)          # 필수값 검증 포함
        try:
            res = self._client.table(TABLE).insert(row).execute()
        except Exception as exc:
            raise RepositoryError(f"insert 실패: {exc}") from exc
        data = getattr(res, "data", None) or []
        return {"saved": True, "decision_uuid": row["decision_uuid"],
                "row": data[0] if data else row}

    def get_latest_by_seat(self, seat_id: str) -> Optional[Dict[str, Any]]:
        try:
            res = (self._client.table(TABLE).select("*")
                   .eq("seat_id", seat_id).order("decided_at", desc=True)
                   .limit(1).execute())
        except Exception as exc:
            raise RepositoryError(f"조회 실패: {exc}") from exc
        data = getattr(res, "data", None) or []
        return data[0] if data else None

    def get_recent_by_seat(self, seat_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            res = (self._client.table(TABLE).select("*")
                   .eq("seat_id", seat_id).order("decided_at", desc=True)
                   .limit(limit).execute())
        except Exception as exc:
            raise RepositoryError(f"조회 실패: {exc}") from exc
        return list(getattr(res, "data", None) or [])

    def health(self) -> dict:
        return {"repository": "supabase", "ready": self._ready, "table": TABLE}


class FakeAIDecisionRepository:
    """테스트/데모용 in-memory repository. Supabase 연결이 전혀 필요 없다.

    실제 repository 와 동일한 인터페이스. serialize_decision 을 그대로 써서
    직렬화/검증 경로도 함께 검증한다. fail=True 면 save_decision 에서 예외.
    """

    def __init__(self, fail: bool = False) -> None:
        self._rows: List[Dict[str, Any]] = []
        self._fail = fail
        self._ready = False

    def initialize(self) -> None:
        self._ready = True

    def save_decision(self, decision: Any) -> Dict[str, Any]:
        row = serialize_decision(decision)          # 검증 포함(누락 시 예외)
        if self._fail:
            raise RepositoryError("FakeAIDecisionRepository: 강제 저장 실패(fail=True)")
        self._rows.append(row)
        return {"saved": True, "decision_uuid": row["decision_uuid"], "row": row}

    def get_latest_by_seat(self, seat_id: str) -> Optional[Dict[str, Any]]:
        rows = self._by_seat(seat_id)
        return rows[0] if rows else None

    def get_recent_by_seat(self, seat_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        return self._by_seat(seat_id)[:limit]

    def _by_seat(self, seat_id: str) -> List[Dict[str, Any]]:
        rows = [r for r in self._rows if r.get("seat_id") == seat_id]
        rows.sort(key=lambda r: r.get("decided_at") or "", reverse=True)
        return rows

    def health(self) -> dict:
        return {"repository": "fake", "ready": self._ready, "count": len(self._rows)}
```

### 2-4. `ai_decision_storage_pipeline.py`

```python
"""
AI Decision Storage Pipeline
============================

  SeatFacts → RuleEngine.decide() → RuleDecision → AI Decision Repository 저장

⚠️ 이 파이프라인은 **저장까지만** 한다.
    Dashboard 표시 / 학생 상태 변경 / 알림 / 벌점 / 출결 처리는 절대 하지 않는다.

process(seat_facts) 반환:
  {"success": bool, "decision_uuid": str, "activity": str, "saved": bool, "error": None|str}

  - save_enabled=False 이거나 repository 가 없으면: 판정만 하고 saved=False(success=True).
  - 저장 시도 중 실패하면: success=False, saved=False, error 메시지.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from rule_engine import RuleEngine

log = logging.getLogger("ai_decision_storage_pipeline")


class AIDecisionStoragePipeline:
    def __init__(self, rule_engine: Optional[Any] = None,
                 repository: Optional[Any] = None,
                 save_enabled: bool = True) -> None:
        self.rule_engine = rule_engine or RuleEngine()
        self.repository = repository
        self.save_enabled = save_enabled
        self._ready = False

    def initialize(self) -> None:
        self.rule_engine.initialize()
        if self.save_enabled and self.repository is not None:
            self.repository.initialize()
        self._ready = True

    def process(self, seat_facts: Any) -> Dict[str, Any]:
        decision = self.rule_engine.decide(seat_facts)
        result = {
            "success": True,
            "decision_uuid": decision.decision_uuid,
            "activity": decision.activity,
            "saved": False,
            "error": None,
        }

        # 저장 비활성 또는 repository 없음 → 판정만(저장 생략)
        if not self.save_enabled or self.repository is None:
            return result

        try:
            self.repository.save_decision(decision)
            result["saved"] = True
        except Exception as exc:                    # 저장 실패 → success False
            result["success"] = False
            result["error"] = f"{type(exc).__name__}: {exc}"
            log.exception("RuleDecision 저장 실패")
        return result

    def health(self) -> dict:
        return {"pipeline": "ai_decision_storage", "ready": self._ready,
                "save_enabled": self.save_enabled,
                "repository": self.repository.health()
                if self.repository is not None and hasattr(self.repository, "health") else None}
```

### 2-5. `decision_storage_demo.py`

```python
"""
Solomon AI Decision Storage v0.1 - CLI 데모
===========================================

Fake SeatFacts → RuleEngine → RuleDecision → (선택)Supabase 저장.

**기본은 --save-disabled** 로 안전하게 동작한다(직렬화 결과만 출력).
실제 저장은 사용자가 **--save** 를 명시했을 때만 시도한다(SUPABASE_URL/SERVICE_ROLE_KEY 필요).

⚠️ 저장까지만 한다. Dashboard/알림/학생 상태 변경은 하지 않는다.

실행 예시:
  python decision_storage_demo.py --fake --save-disabled   # 저장 없이 직렬화만(기본)
  python decision_storage_demo.py --fake --save            # 실제 Supabase 저장 시도
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from rule_engine import RuleEngine
from decision_serializer import serialize_decision
from ai_decision_repository import AIDecisionRepository
from ai_decision_storage_pipeline import AIDecisionStoragePipeline
from rule_demo import studying_facts, phone_facts, absent_facts


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def parse_args():
    p = argparse.ArgumentParser(description="Solomon AI Decision Storage v0.1 데모")
    p.add_argument("--fake", action="store_true", default=True,
                   help="Fake SeatFacts 사용(기본)")
    save = p.add_mutually_exclusive_group()
    save.add_argument("--save", action="store_true", help="실제 Supabase 저장 시도")
    save.add_argument("--save-disabled", action="store_true",
                      help="저장 없이 직렬화 결과만 출력(기본)")
    p.add_argument("--activity", choices=["studying", "phone", "absent"],
                   default="studying", help="데모용 fake SeatFacts 종류")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    setup_logging()
    do_save = bool(args.save)               # 기본 False(=save-disabled)

    sf = {"studying": studying_facts, "phone": phone_facts,
          "absent": absent_facts}[args.activity]()

    # 판정 + 직렬화 미리보기(저장 여부와 무관하게 항상 표시)
    eng = RuleEngine(); eng.initialize()
    decision = eng.decide(sf)
    payload = serialize_decision(decision)
    print("===== RuleDecision (직렬화 미리보기) =====")
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    # 저장 단계
    repo = AIDecisionRepository() if do_save else None
    pipeline = AIDecisionStoragePipeline(rule_engine=eng, repository=repo,
                                         save_enabled=do_save)
    if do_save:
        try:
            pipeline.initialize()
        except Exception as exc:
            print(f"\n[!] Supabase 초기화 실패(환경변수/패키지 확인): {exc}")
            return 1
    result = pipeline.process(sf)

    print("\n===== Pipeline 결과 =====")
    print(f"  success={result['success']} saved={result['saved']} "
          f"activity={result['activity']} error={result['error']}")
    if not do_save:
        print("  (--save-disabled) Supabase 저장 생략 — 위 직렬화 결과만 표시")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 2-6. `test_ai_decision_storage.py`

```python
"""
AI Decision Storage v0.1 테스트.

**실제 Supabase 연결 없이** FakeAIDecisionRepository 로 통과한다.

검증:
  - serialize_decision 정상 변환(datetime→ISO, JSON 필드)
  - 필수값 누락 시 DecisionValidationError
  - FakeAIDecisionRepository.save_decision 저장
  - Storage Pipeline process 성공(saved=True)
  - 저장 실패 시 success=False
  - save 비활성(save_enabled=False) 시 판정만(saved=False, success=True)
  - get_latest_by_seat / get_recent_by_seat
  - 저장 모듈에 학생 상태 변경/알림/벌점/출결 코드가 없음(소스 스캔)
  - 기존 RuleEngine / FactsFusionEngine 테스트가 깨지지 않음
"""
import os
import uuid
from datetime import datetime

import activity_labels as A
from rule_decision import RuleDecision
from decision_serializer import serialize_decision, DecisionValidationError, REQUIRED_FIELDS
from ai_decision_repository import FakeAIDecisionRepository, RepositoryError
from ai_decision_storage_pipeline import AIDecisionStoragePipeline


# ---- 도우미 ---------------------------------------------------------------
def _decision(seat="Seat1", activity=A.STUDYING, status=A.STATUS_SUCCESS,
              severity=A.SEVERITY_INFO, decided_at=None, **over):
    base = dict(
        decision_uuid=uuid.uuid4().hex, facts_uuid="f1", burst_uuid="b1",
        seat_id=seat, period_id="P0", period_name="0교시",
        decided_at=decided_at or datetime(2026, 6, 30, 9, 0),
        activity=activity, confidence=0.9, status=status, severity=severity,
        reasons=["책 또는 학습 도구가 검출됨"],
        evidence={"overall_quality": 0.8667, "phone_detected": False},
        rule_hits=[{"rule": "studying_rule", "fired": True, "confidence": 1.0}],
        quality={"overall_quality": 0.8667, "usable_for_rule_engine": True},
        metadata={"engine": "rule_engine", "version": "rule-engine-v0.1"})
    base.update(over)
    return RuleDecision(**base)


class _StubSeatFacts:
    """RuleEngine.decide() 가 받는 최소 SeatFacts 스텁(공부 후보)."""
    facts_uuid = "f1"; burst_uuid = "b1"; seat_id = "Seat1"
    period_id = "P0"; period_name = "0교시"
    quality = {"vision_quality": 1.0, "human_quality": 0.9, "object_quality": 0.7,
               "overall_quality": 0.8667, "usable_for_rule_engine": True}
    human = {"face_detected": True, "hands_detected": True, "hands_visible_ratio": 0.7,
             "pose_detected": True}
    objects = {"book_detected": True, "phone_detected": False, "person_detected": True,
               "max_person_count": 1}
    vision = {"valid_frames": 5}


# ---- 테스트 ---------------------------------------------------------------
def test_serialize_ok():
    row = serialize_decision(_decision())
    assert row["decision_uuid"] and row["seat_id"] == "Seat1"
    assert row["activity"] == A.STUDYING and row["status"] == A.STATUS_SUCCESS
    assert row["decided_at"] == "2026-06-30T09:00:00"   # ISO 문자열
    assert isinstance(row["reasons"], list) and isinstance(row["evidence"], dict)
    assert isinstance(row["rule_hits"], list) and isinstance(row["quality"], dict)
    assert row["confidence"] == 0.9
    print("PASS serialize: datetime→ISO + JSON 필드 정상")


def test_serialize_missing_required():
    for field in ("decision_uuid", "seat_id", "activity", "status", "severity"):
        bad = _decision(**{field: ""})
        try:
            serialize_decision(bad)
            assert False, f"{field} 누락인데 예외가 안 났다"
        except DecisionValidationError as e:
            assert field in str(e)
    # decided_at None (직접 None 으로 세팅)
    bad_dt = _decision()
    bad_dt.decided_at = None
    try:
        serialize_decision(bad_dt)
        assert False, "decided_at None 인데 예외가 안 났다"
    except DecisionValidationError:
        pass
    assert set(REQUIRED_FIELDS) == {"decision_uuid", "seat_id", "activity",
                                    "status", "severity", "decided_at"}
    print("PASS serialize_missing: 필수값 누락 → DecisionValidationError")


def test_fake_repo_save():
    repo = FakeAIDecisionRepository(); repo.initialize()
    res = repo.save_decision(_decision())
    assert res["saved"] is True and res["decision_uuid"]
    assert repo.health()["count"] == 1
    print("PASS repo_save: FakeAIDecisionRepository.save_decision 저장")


def test_pipeline_process_success():
    repo = FakeAIDecisionRepository()
    pipe = AIDecisionStoragePipeline(repository=repo, save_enabled=True)
    pipe.initialize()
    res = pipe.process(_StubSeatFacts())
    assert res["success"] is True and res["saved"] is True
    assert res["activity"] == A.STUDYING
    assert repo.health()["count"] == 1
    print("PASS pipeline_success: process → 판정+저장 성공")


def test_pipeline_save_failure():
    repo = FakeAIDecisionRepository(fail=True)
    pipe = AIDecisionStoragePipeline(repository=repo, save_enabled=True)
    pipe.initialize()
    res = pipe.process(_StubSeatFacts())
    assert res["success"] is False and res["saved"] is False
    assert res["error"] and "RepositoryError" in res["error"]
    print("PASS pipeline_fail: 저장 실패 → success=False")


def test_pipeline_save_disabled():
    repo = FakeAIDecisionRepository()
    pipe = AIDecisionStoragePipeline(repository=repo, save_enabled=False)
    pipe.initialize()
    res = pipe.process(_StubSeatFacts())
    assert res["success"] is True and res["saved"] is False
    assert repo.health()["count"] == 0          # 저장 안 함
    print("PASS pipeline_disabled: save_enabled=False → 판정만(저장 생략)")


def test_get_latest_and_recent():
    repo = FakeAIDecisionRepository(); repo.initialize()
    repo.save_decision(_decision(seat="Seat1", decided_at=datetime(2026, 6, 30, 9, 0)))
    repo.save_decision(_decision(seat="Seat1", activity=A.PHONE,
                                 severity=A.SEVERITY_WARNING,
                                 decided_at=datetime(2026, 6, 30, 9, 30)))
    repo.save_decision(_decision(seat="Seat2", decided_at=datetime(2026, 6, 30, 9, 10)))
    latest = repo.get_latest_by_seat("Seat1")
    assert latest["activity"] == A.PHONE        # 더 최근(9:30)
    recent = repo.get_recent_by_seat("Seat1", limit=10)
    assert len(recent) == 2 and recent[0]["decided_at"] >= recent[1]["decided_at"]
    assert repo.get_latest_by_seat("SeatX") is None
    print("PASS get: get_latest_by_seat / get_recent_by_seat")


def test_no_student_state_or_side_effects():
    # 저장 모듈 소스에 학생 상태 변경/알림/벌점/출결 관련 코드가 없어야 한다.
    here = os.path.dirname(os.path.abspath(__file__))
    files = ["ai_decision_repository.py", "ai_decision_storage_pipeline.py",
             "decision_serializer.py", "supabase_client.py"]
    forbidden = ["attendance", "penalty", "notification", "membership",
                 "absence", "power_nap", "student_profiles", "warning_record"]
    for fn in files:
        with open(os.path.join(here, fn), "r", encoding="utf-8") as f:
            src = f.read().lower()
        for tok in forbidden:
            assert tok not in src, f"{fn} 에 금지 토큰 '{tok}' 발견"
    print("PASS no_side_effects: 학생상태/알림/벌점/출결 코드 없음")


def test_existing_engines_intact():
    from rule_engine import RuleEngine
    from facts_fusion_engine import FactsFusionEngine
    from fusion_result import FUSION_SKIPPED
    re = RuleEngine(); re.initialize()
    d = re.decide(None)
    assert d.status == A.STATUS_SKIPPED
    fe = FactsFusionEngine(); fe.initialize()
    assert fe.fuse([]).status == FUSION_SKIPPED
    print("PASS intact: RuleEngine / FactsFusionEngine 동작 유지")


def main():
    test_serialize_ok()
    test_serialize_missing_required()
    test_fake_repo_save()
    test_pipeline_process_success()
    test_pipeline_save_failure()
    test_pipeline_save_disabled()
    test_get_latest_and_recent()
    test_no_student_state_or_side_effects()
    test_existing_engines_intact()
    print("\nALL PASS: serialize / serialize_missing / repo_save / pipeline_success / "
          "pipeline_fail / pipeline_disabled / get / no_side_effects / intact")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드 (변경 부분)

### 3-1. `rtsp-poc/.env.example` — Supabase 저장용 변수 추가(값 아님, 변수명만)

```bash
# -------------------------------------------------------------------------
# (3) AI Decision Storage v0.1 — RuleDecision 저장(decision_storage_demo.py --save)
#     ⚠️ 서버 저장용 service role 키(브라우저용 anon key 아님). 절대 깃에 올리지 않는다.
#     키 값은 코드에 하드코딩하지 않고 .env 에서만 읽는다.
# -------------------------------------------------------------------------
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

### 3-2. `rtsp-poc/README.md` — 추가/변경 요약
- 헤더 모듈 목록에 **AI Decision Storage v0.1** 줄 추가, 범위 경고에 "저장해도 학생 상태는 안 바뀜" 명시.
- 파일 구조 표에 `decision_serializer.py / supabase_client.py / ai_decision_repository.py /
  ai_decision_storage_pipeline.py / decision_storage_demo.py / test_ai_decision_storage.py / migration` 7행 추가.
- **"## AI Decision Storage v0.1"** 절 신규: 필요성 / 흐름 / 테이블 구조 / **RLS·보안 정책** /
  환경변수 / 실행 / 테스트 / 다음 단계(관리자 read-only).

> 기존 엔진/Fusion/Rule 코드 파일은 **변경 없음**(저장 계층은 RuleDecision 을 읽기만).

---

## 4. Supabase migration 전체 코드

`supabase/migrations/20260708000000_ai_rule_decisions.sql`

```sql
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
```

> ⚠️ **이 migration 은 파일 생성까지만 수행**했다. 실제 원격/로컬 DB 적용(`supabase db push` 등)은
> 사용자 확인 후 별도로 진행한다(이번 커밋은 스키마 파일만 포함).

---

## 5. AI Decision Storage 구조도

```
   ┌──────────────┐   (기존 파이프라인)
   │  SeatFacts   │
   └──────┬───────┘
          ▼
   AIDecisionStoragePipeline.process()
          │
          ├─ 1) RuleEngine.decide() ───────────► RuleDecision
          │
          ├─ 2) (save_enabled & repository?) ── No ─► {success:true, saved:false}  (판정만)
          │                                  Yes
          ▼
   AIDecisionRepository.save_decision()
          │
          ├─ decision_serializer.serialize_decision()
          │     · 필수값 검증(누락→DecisionValidationError)
          │     · datetime → ISO 문자열
          │     · reasons/evidence/rule_hits/quality/metadata → JSON
          │
          ▼
   supabase_client.get_supabase_client()   ── service role key (env, lazy)
          │  client.table("ai_rule_decisions").insert(row).execute()
          ▼
   ┌─────────────────────────────┐
   │ Supabase: ai_rule_decisions │   RLS 기본 잠금 + service role 우회
   └─────────────────────────────┘
          │
          ▼
   {success:true, saved:true, decision_uuid, activity}
   (저장 실패 시 success:false, error)

   ── 여기서 끝. 대시보드/학생 상태 변경/알림/벌점/출결은 절대 하지 않는다. ──

   [테스트] FakeAIDecisionRepository (in-memory) → Supabase 없이 동일 인터페이스 검증
```

**핵심 설계 원칙**
- **저장 전용**: 파이프라인은 판정+저장까지만. 부수효과(상태 변경/알림) 없음 — 테스트로 강제(소스 스캔).
- **service role 분리**: 쓰기는 서버 키로만, 학생 앱 직접 쓰기 금지(RLS 기본 잠금).
- **lazy / 교체 가능**: supabase 패키지·클라이언트는 lazy, repository 는 Fake 로 교체해 무연결 테스트.
- **검증 우선**: 필수값 없으면 저장 전에 명확히 실패(쓰레기 데이터 차단).

---

## 6. `ai_rule_decisions` 테이블 설명

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | `gen_random_uuid()` 기본값 |
| `decision_uuid` | text unique not null | RuleDecision 고유 id(중복 저장 방지) |
| `facts_uuid` / `burst_uuid` | text | 입력 SeatFacts/Burst 추적 |
| `seat_id` | text not null | 좌석 |
| `period_id` / `period_name` | text | 교시 |
| `decided_at` | timestamptz not null | 판정 시각 |
| `activity` | text not null | STUDYING/PHONE/SLEEPING/ABSENT/UNKNOWN (CHECK) |
| `confidence` | numeric | 0~1 |
| `status` | text not null | SUCCESS/SKIPPED/FAILED/LOW_CONFIDENCE (CHECK) |
| `severity` | text not null | INFO/WATCH/WARNING/CRITICAL (CHECK) |
| `reasons` / `evidence` / `rule_hits` / `quality` / `metadata` | jsonb | 판정 근거(기본 `[]`/`{}`) |
| `created_at` | timestamptz | 저장 시각 `now()` |

- **인덱스**: seat_id / burst_uuid / decided_at(desc) / activity / status / severity.
- **저장 안 함**: 영상·이미지·원본 프레임(텍스트/JSON 결과만).
- **CHECK 제약**으로 activity/status/severity 가 표준 라벨 집합을 벗어나면 거부(데이터 무결성).

---

## 7. RuleDecision Serializer 설명

`serialize_decision(decision) -> dict`
- **필수값 검증**: `decision_uuid / seat_id / activity / status / severity / decided_at` 중 하나라도
  None/빈문자열이면 **`DecisionValidationError`** → 저장 차단.
- **datetime → ISO**: `decided_at.isoformat()`(예: `2026-06-30T09:00:00`).
- **숫자 정규화**: `confidence` → float 또는 None.
- **JSON 정리**: reasons(list) / evidence·quality·metadata(dict) / rule_hits(list) 를 안전한 형태로 복사.
- 순수 함수(외부 의존 없음) → 단독 테스트 용이.

---

## 8. Repository 설명

`AIDecisionRepository`(실제) / `FakeAIDecisionRepository`(테스트) — **동일 인터페이스**.

| 메서드 | 동작 |
|--------|------|
| `initialize()` | (실제) service role 클라이언트 생성 / (Fake) ready 플래그 |
| `save_decision(decision)` | serialize → insert. 검증/삽입 실패 시 예외 |
| `get_latest_by_seat(seat)` | 좌석의 가장 최근 1건(decided_at desc) |
| `get_recent_by_seat(seat, limit=20)` | 좌석의 최근 N건 |
| `health()` | 상태 dict |

- 실제 repo 는 `client.table("ai_rule_decisions").insert/select/eq/order/limit/execute()` 사용.
- Fake repo 는 in-memory 리스트 + 동일 직렬화 경로 → **Supabase 없이** save/조회/정렬 검증.
- **학생 상태 변경/출결/벌점/알림 로직 없음** — 소스 스캔 테스트(`test_no_student_state_or_side_effects`)로 강제.

---

## 9. Storage Pipeline 설명

`AIDecisionStoragePipeline(rule_engine, repository, save_enabled)`
- `process(seat_facts)`:
  1. `rule_engine.decide(seat_facts)` → RuleDecision
  2. `save_enabled=False` 또는 repository 없음 → **판정만**(`saved=False, success=True`)
  3. 저장 시도 → 성공 `saved=True`, 실패 `success=False, error=...`
- 반환: `{success, decision_uuid, activity, saved, error}`.
- **저장까지만** — 대시보드/상태 변경/알림 없음. demo 기본은 `save_enabled=False`(안전).

---

## 10. 테스트 결과

`python test_ai_decision_storage.py` (실제 Supabase **없이** 실행):

```
PASS serialize: datetime→ISO + JSON 필드 정상
PASS serialize_missing: 필수값 누락 → DecisionValidationError
PASS repo_save: FakeAIDecisionRepository.save_decision 저장
PASS pipeline_success: process → 판정+저장 성공
PASS pipeline_fail: 저장 실패 → success=False
PASS pipeline_disabled: save_enabled=False → 판정만(저장 생략)
PASS get: get_latest_by_seat / get_recent_by_seat
PASS no_side_effects: 학생상태/알림/벌점/출결 코드 없음
PASS intact: RuleEngine / FactsFusionEngine 동작 유지

ALL PASS: serialize / serialize_missing / repo_save / pipeline_success /
          pipeline_fail / pipeline_disabled / get / no_side_effects / intact
```

**데모** `python decision_storage_demo.py --fake --save-disabled`(기본):
```
===== RuleDecision (직렬화 미리보기) =====  { ... decision_uuid/activity:STUDYING/... }
===== Pipeline 결과 =====
  success=True saved=False activity=STUDYING error=None
  (--save-disabled) Supabase 저장 생략 — 위 직렬화 결과만 표시
```
`--save`(env 미설정 시): `[!] Supabase 초기화 실패(환경변수/패키지 확인): ...` 로 안전하게 종료.

**회귀 확인**
- 새 모듈 import 시 `supabase` 패키지 미로드(lazy 확인).
- `test_rule_engine.py` / `test_facts_fusion_engine.py` 기존 테스트 PASS 유지.

---

## 11. 남은 기술부채

1. **실제 Supabase insert 미검증**: `supabase` 패키지·키가 환경에 없어 실제 insert/조회 경로는 코드 리뷰 수준까지만. 실 키로 통합 테스트 필요.
2. **migration 미적용**: 스키마 파일만 생성. 원격/로컬 DB 적용(`supabase db push`)은 사용자 확인 후 별도 진행.
3. **재시도/배치 없음**: 저장 실패 시 단순 error 반환(재시도 큐·백오프·배치 insert 없음). Orchestrator 연동 시 필요.
4. **관리자 조회 정책 부재**: RLS 기본 잠금이라 service role 외 조회 불가. 관리자 read-only SELECT 정책은 다음 단계.
5. **중복/멱등성**: `decision_uuid` unique 로 중복 차단되지만, 재시도 시 충돌을 upsert/무시할지 정책 미정.
6. **시간대**: `decided_at` 은 RuleDecision 의 로컬 `datetime.now()` ISO. tz-aware 표준화(UTC) 권장.
7. **타입 동기화**: 프런트 `database.types.ts` 에 `ai_rule_decisions` 타입 미반영(관리자 화면 단계에서 갱신).

---

## 12. v0.2 개선계획

1. **실 키 통합 테스트**: `pip install supabase` + service role 키로 insert/get E2E 검증, 옵셔널 CI 잡.
2. **migration 적용 + 관리자 read-only RLS**: `is_admin()` SELECT 정책 추가 migration, 원격 반영, `database.types.ts` 갱신.
3. **Orchestrator → 저장 연동**: BurstPackage 처리 결과(SeatFacts)를 파이프라인에 흘려 자동 저장(실패 재시도/배치).
4. **멱등 저장**: `on conflict (decision_uuid) do nothing/update` 로 재시도 안전성 확보.
5. **시간대 표준화**: decided_at/created_at UTC 통일, 조회 시 KST 변환.
6. **보존/정리 정책**: 오래된 판정 아카이브/파티셔닝(대량 누적 대비).
7. **관리자 대시보드 읽기 전용 표시(다음 단계)**: 저장된 RuleDecision 을 관리자 화면에 보여주기 —
   **학생 상태 변경/알림/벌점/출결은 여전히 그 이후로 신중히 분리.**

> v0.1 범위 재확인: **RuleDecision 저장까지만.**
> 대시보드 / 학생 상태 변경 / 알림 / 보호자 연락 / 벌점 / 출결 / 이용권 / 영상·이미지 저장은 절대 미구현.
