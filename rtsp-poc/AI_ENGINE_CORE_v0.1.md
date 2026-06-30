# AI Engine Core v0.1 — 구현 완료 리뷰 (복붙용)

> 클립보드 복붙용. 전체 선택(Ctrl/Cmd+A) → 복사.
> 범위: **교체 가능한 AI 인터페이스 + Dummy** 까지. BurstPackage 입력 → AnalysisResult 생성.
> **미구현(절대 추가 안 함): 실제 AI 판별(OpenCV/MediaPipe/YOLO)/Rule Engine/Supabase/Dashboard.**

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── ring_buffer.py / camera_core.py / main.py            # [Core] 변경 없음
├── camera_config.py / camera_manager.py / manage.py / cameras.yaml   # [Manager] 변경 없음
├── schedule_config.py / scheduler_engine.py / scheduler_demo.py / schedule.yaml  # [Scheduler] 변경 없음
├── burst_package.py / trigger_queue.py / orchestrator_engine.py / orchestrator_demo.py  # [Orchestrator] 변경 없음
├── analysis_result.py        # [NEW] AnalysisResult
├── ai_engine.py              # [NEW] AIEngine 추상 인터페이스
├── engine_registry.py        # [NEW] 이름→엔진 생성 레지스트리
├── ai_manager.py             # [NEW] AIManager (로드/언로드/리로드/분석/상태)
├── ai_demo.py                # [NEW] CLI 데모(--dummy --burst-count)
├── test_ai_engine.py         # [NEW] 테스트
├── plugins/                  # [NEW] AI 엔진 플러그인 패키지
│   ├── __init__.py
│   └── dummy_engine.py       # [NEW] DummyAIEngine
├── test_camera_core.py / test_camera_manager.py / test_scheduler_engine.py / test_orchestrator_engine.py  # 변경 없음
├── requirements.txt / .env.example                       # 변경 없음
├── README.md                 # [수정] AI Engine Core 섹션 추가
├── CODE_REVIEW_v0.1.md / CAMERA_MANAGER_v0.1.md / SCHEDULER_ENGINE_v0.1.md / ORCHESTRATOR_ENGINE_v0.1.md
├── AI_ENGINE_CORE_v0.1.md    # (이 문서)
└── rtsp_poc.py               # [레거시]
```

기존 Core/Manager/Scheduler/Orchestrator 코드 파일은 **한 줄도 수정하지 않았다.**
(Orchestrator 는 `burst_consumer=AIManager.analyze` 로 연결 → 코드 변경 0.)

---

## 2. 신규 파일 전체 코드

### analysis_result.py
```python
"""
AnalysisResult
==============

AI Engine 이 BurstPackage 를 분석한 결과(이번 단계는 Dummy 만 생성).
향후 Rule Engine 이 이 결과를 입력으로 받는다(이번 단계는 호출하지 않음).

OpenCV / AI 라이브러리에 의존하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional

# 분석 상태
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED = "FAILED"
STATUS_SKIPPED = "SKIPPED"

# 활동(activity) — 이번 단계는 문자열만, 실제 판별은 미구현
ACTIVITY_UNKNOWN = "UNKNOWN"


@dataclass
class AnalysisResult:
    analysis_uuid: str
    burst_uuid: str
    seat_id: str
    started_at: datetime
    finished_at: datetime
    processing_time: float           # 처리 시간(ms)
    confidence: float                # 0.0 ~ 1.0 (Dummy 는 0)
    status: str                      # SUCCESS | FAILED | SKIPPED
    activity: str                    # 현재는 "UNKNOWN" 만
    scores: Dict[str, float] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
```

### ai_engine.py
```python
"""
AIEngine 인터페이스
==================

모든 AI 엔진(Dummy / 향후 MediaPipe / YOLO / OpenCV / VisionTransformer)이
구현해야 하는 공통 추상 인터페이스.

이 인터페이스 덕분에 AIManager 는 어떤 엔진이든 동일하게 다루고 교체할 수 있다.
이 모듈은 OpenCV / AI 라이브러리에 의존하지 않는다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from analysis_result import AnalysisResult

if TYPE_CHECKING:
    from burst_package import BurstPackage


class AIEngine(ABC):
    """모든 AI 엔진의 공통 인터페이스."""

    name: str = "base"

    @abstractmethod
    def initialize(self) -> None:
        """모델 로드 등 1회 초기화."""
        raise NotImplementedError

    @abstractmethod
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        """BurstPackage 를 분석해 AnalysisResult 를 반환한다."""
        raise NotImplementedError

    @abstractmethod
    def shutdown(self) -> None:
        """리소스 해제."""
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict:
        """엔진 상태(준비 여부 등)."""
        raise NotImplementedError
```

### plugins/__init__.py
```python
"""AI 엔진 플러그인 패키지. 현재는 dummy_engine 만 제공."""
```

### plugins/dummy_engine.py
```python
"""
DummyAIEngine
=============

AIEngine 인터페이스의 최소 구현체. **실제 분석은 하지 않는다.**
analyze() 호출 시 activity="UNKNOWN", confidence=0 인 AnalysisResult 를 반환한다.

목적: AI 를 교체 가능한 구조로 만들기 위한 자리표시자(placeholder).
향후 MediaPipeEngine / YOLOEngine 등이 동일 인터페이스로 이 자리를 대체한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from ai_engine import AIEngine
from analysis_result import (
    AnalysisResult,
    ACTIVITY_UNKNOWN,
    STATUS_SUCCESS,
)

if TYPE_CHECKING:
    from burst_package import BurstPackage


class DummyAIEngine(AIEngine):
    name = "dummy"

    def __init__(self, **kwargs) -> None:
        self._ready = False
        self._analyzed = 0
        self._kwargs = kwargs  # 향후 엔진별 옵션 호환용(미사용)

    def initialize(self) -> None:
        self._ready = True

    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        started = datetime.now()
        # 실제 분석 없음 — 즉시 UNKNOWN 결과
        finished = datetime.now()
        self._analyzed += 1
        return AnalysisResult(
            analysis_uuid=uuid.uuid4().hex,
            burst_uuid=getattr(burst, "burst_uuid", ""),
            seat_id=getattr(burst, "seat_id", ""),
            started_at=started,
            finished_at=finished,
            processing_time=(finished - started).total_seconds() * 1000.0,
            confidence=0.0,
            status=STATUS_SUCCESS,
            activity=ACTIVITY_UNKNOWN,
            scores={},
            metadata={
                "engine": self.name,
                "frame_count": getattr(burst, "frame_count", 0),
                "note": "dummy - no real analysis",
            },
        )

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"name": self.name, "ready": self._ready, "analyzed": self._analyzed}
```

### engine_registry.py
```python
"""
Engine Registry
===============

엔진 이름(문자열) → AIEngine 인스턴스 생성. AIManager 가 이름으로 엔진을 만든다.

  "dummy"  → DummyAIEngine
  (향후)
  "mediapipe" → MediaPipeEngine   # lazy register 예시(아래 주석 참고)
  "yolo"      → YOLOEngine

future 엔진은 무거운 의존성(cv2/mediapipe/torch)을 가지므로,
필요할 때만 import 되도록 lazy factory 로 등록하는 것을 권장한다.
"""

from __future__ import annotations

import logging
from typing import Callable, Dict, List

from ai_engine import AIEngine
from plugins.dummy_engine import DummyAIEngine

log = logging.getLogger("engine_registry")

# 이름 → factory(**kwargs) -> AIEngine
_REGISTRY: Dict[str, Callable[..., AIEngine]] = {}


def register(name: str, factory: Callable[..., AIEngine]) -> None:
    """엔진 factory 를 등록한다(테스트에서 fake 엔진 주입에도 사용)."""
    _REGISTRY[name] = factory


def unregister(name: str) -> None:
    _REGISTRY.pop(name, None)


def available_engines() -> List[str]:
    return sorted(_REGISTRY.keys())


def create_engine(name: str, **kwargs) -> AIEngine:
    """등록된 이름으로 엔진 인스턴스를 생성한다."""
    factory = _REGISTRY.get(name)
    if factory is None:
        raise KeyError(f"알 수 없는 엔진: {name} (등록됨: {available_engines()})")
    return factory(**kwargs)


# 기본 등록: dummy
register("dummy", DummyAIEngine)

# --- 향후(이번 단계 미구현) lazy 등록 예시 ---------------------------------
# def _make_mediapipe(**kw):
#     from plugins.mediapipe_engine import MediaPipeEngine  # 무거운 import 지연
#     return MediaPipeEngine(**kw)
# register("mediapipe", _make_mediapipe)
```

### ai_manager.py
```python
"""
AIManager
=========

현재 사용할 AI Engine 을 관리한다(로드/언로드/리로드/분석/상태).
엔진은 Engine Registry 를 통해 이름으로 생성되며, 동일 인터페이스(AIEngine)라
어떤 엔진이든 교체 가능하다(현재는 DummyAIEngine 만 등록).

AI Pipeline:
  BurstPackage → AIManager.analyze() → AIEngine.analyze() → AnalysisResult
                                                              → (향후 Rule Engine)
  * 이번 단계는 Rule Engine 을 호출하지 않는다.

AIManager.analyze 는 시그니처가 `(burst) -> AnalysisResult` 이므로,
OrchestratorEngine 의 burst_consumer 콜백으로 그대로 꽂을 수 있다(Orchestrator 무수정).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING

import engine_registry
from ai_engine import AIEngine
from analysis_result import (
    AnalysisResult,
    ACTIVITY_UNKNOWN,
    STATUS_FAILED,
    STATUS_SKIPPED,
)

if TYPE_CHECKING:
    from burst_package import BurstPackage

log = logging.getLogger("ai_manager")


class AIManager:
    def __init__(self, engine_name: Optional[str] = None, **engine_kwargs) -> None:
        self._engine: Optional[AIEngine] = None
        self._engine_name: Optional[str] = None
        self._engine_kwargs: dict = {}
        self._analyzed = 0
        if engine_name:
            self.load_engine(engine_name, **engine_kwargs)

    # ----------------------------------------------------------- lifecycle
    def load_engine(self, name: str, **kwargs) -> AIEngine:
        """이름으로 엔진을 생성·초기화하고 현재 엔진으로 설정한다(기존 엔진은 언로드)."""
        if self._engine is not None:
            self.unload_engine()
        engine = engine_registry.create_engine(name, **kwargs)
        engine.initialize()
        self._engine = engine
        self._engine_name = name
        self._engine_kwargs = dict(kwargs)
        log.info("엔진 로드: %s", name)
        return engine

    def unload_engine(self) -> None:
        if self._engine is None:
            return
        try:
            self._engine.shutdown()
        except Exception as exc:
            log.exception("엔진 shutdown 예외: %s", exc)
        log.info("엔진 언로드: %s", self._engine_name)
        self._engine = None
        self._engine_name = None

    def reload(self) -> Optional[AIEngine]:
        """현재 엔진을 같은 이름/옵션으로 다시 로드한다."""
        if self._engine_name is None:
            log.warning("reload: 로드된 엔진이 없습니다.")
            return None
        name, kwargs = self._engine_name, dict(self._engine_kwargs)
        return self.load_engine(name, **kwargs)

    # ------------------------------------------------------------- analyze
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        """BurstPackage 를 현재 엔진으로 분석한다. 엔진 없음/예외는 결과 status 로 표현."""
        if self._engine is None:
            return self._fallback_result(burst, STATUS_SKIPPED, "no_engine")
        try:
            result = self._engine.analyze(burst)
            self._analyzed += 1
            return result
        except Exception as exc:
            log.exception("분석 예외(seat=%s): %s", getattr(burst, "seat_id", "?"), exc)
            return self._fallback_result(burst, STATUS_FAILED, str(exc))

    def _fallback_result(self, burst: "BurstPackage", status: str, reason: str) -> AnalysisResult:
        now = datetime.now()
        return AnalysisResult(
            analysis_uuid=uuid.uuid4().hex,
            burst_uuid=getattr(burst, "burst_uuid", ""),
            seat_id=getattr(burst, "seat_id", ""),
            started_at=now,
            finished_at=now,
            processing_time=0.0,
            confidence=0.0,
            status=status,
            activity=ACTIVITY_UNKNOWN,
            scores={},
            metadata={"engine": self._engine_name, "reason": reason},
        )

    # -------------------------------------------------------------- status
    def health(self) -> dict:
        return {
            "loaded": self._engine is not None,
            "engine": self._engine_name,
            "analyzed": self._analyzed,
            "available": engine_registry.available_engines(),
            "engine_health": self._engine.health() if self._engine else None,
        }
```

### ai_demo.py
```python
"""
AI Engine Core v0.1 - CLI 데모
==============================

Dummy BurstPackage 를 여러 개 만들어 AIManager(DummyAIEngine)로 분석하고
AnalysisResult 를 출력한다. **실제 AI 분석은 없다.**

실행 예시:
  python ai_demo.py --dummy --burst-count 5
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime

from ai_manager import AIManager
from burst_package import BurstPackage

log = logging.getLogger("ai_demo")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon AI Engine Core v0.1 데모")
    p.add_argument("--dummy", action="store_true", help="DummyAIEngine 사용(현재 유일)")
    p.add_argument("--burst-count", type=int, default=3, help="생성할 Dummy BurstPackage 수")
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def make_dummy_burst(i: int) -> BurstPackage:
    seat = f"Seat{i % 8 + 1}"
    now = datetime.now()
    return BurstPackage(
        burst_uuid=uuid.uuid4().hex,
        trigger_uuid=uuid.uuid4().hex,
        trigger_id=f"{now.date().isoformat()}_P0_start_attendance_check",
        trigger_type="start_attendance_check",
        period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=now, frame_count=5,
        frames=[f"{seat}-frame{j}" for j in range(5)],
        metadata={"demo": True},
    )


def main() -> int:
    args = parse_args()
    setup_logging()

    # 현재 등록 엔진은 dummy 뿐. --dummy 가 없어도 dummy 로 동작.
    mgr = AIManager(engine_name="dummy")
    log.info("AIManager health: %s", mgr.health())

    print(f"===== AnalysisResult x {args.burst_count} =====")
    for i in range(args.burst_count):
        burst = make_dummy_burst(i)
        res = mgr.analyze(burst)
        print(f"  seat={res.seat_id} status={res.status} activity={res.activity} "
              f"conf={res.confidence} proc={res.processing_time:.3f}ms "
              f"analysis_uuid={res.analysis_uuid[:8]} burst_uuid={res.burst_uuid[:8]} "
              f"meta={res.metadata}")

    print("----- 최종 health -----")
    print(f"  {mgr.health()}")
    mgr.unload_engine()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### test_ai_engine.py
```python
"""
AI Engine Core 테스트 (OpenCV/AI 없이).

검증:
  - Fake BurstPackage 생성
  - DummyAIEngine 분석 → AnalysisResult(activity=UNKNOWN, confidence=0, status=SUCCESS)
  - AIManager 분석 / 엔진 교체(reload, 다른 엔진 load)
  - Engine Registry (available/create/unknown)
  - 엔진 없을 때 analyze → SKIPPED, 엔진 예외 → FAILED
"""
from datetime import datetime

import engine_registry
from ai_engine import AIEngine
from ai_manager import AIManager
from analysis_result import (
    AnalysisResult, ACTIVITY_UNKNOWN,
    STATUS_SUCCESS, STATUS_FAILED, STATUS_SKIPPED,
)
from burst_package import BurstPackage
from plugins.dummy_engine import DummyAIEngine


def fake_burst(seat="Seat1"):
    now = datetime(2026, 6, 30, 9, 5)
    return BurstPackage(
        burst_uuid="burst-abc", trigger_uuid="trig-1", trigger_id="2026-06-30_P0_start",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=now, frame_count=5,
        frames=[f"{seat}-f{i}" for i in range(5)], metadata={},
    )


# 교체 검증용 fake 엔진(다른 activity)
class FakeEngine(AIEngine):
    name = "fake"

    def __init__(self, **kw):
        self._ready = False

    def initialize(self):
        self._ready = True

    def analyze(self, burst):
        return AnalysisResult(
            analysis_uuid="fake-uuid", burst_uuid=burst.burst_uuid, seat_id=burst.seat_id,
            started_at=datetime.now(), finished_at=datetime.now(), processing_time=1.0,
            confidence=0.0, status=STATUS_SUCCESS, activity="FAKE_OK", scores={}, metadata={"engine": "fake"},
        )

    def shutdown(self):
        self._ready = False

    def health(self):
        return {"name": self.name, "ready": self._ready}


def test_registry():
    assert "dummy" in engine_registry.available_engines()
    eng = engine_registry.create_engine("dummy")
    assert isinstance(eng, DummyAIEngine)
    try:
        engine_registry.create_engine("nope")
        assert False, "알 수 없는 엔진은 예외"
    except KeyError:
        pass
    print("PASS registry: available/create/unknown")


def test_dummy_engine():
    eng = DummyAIEngine()
    eng.initialize()
    assert eng.health()["ready"] is True
    res = eng.analyze(fake_burst("Seat2"))
    assert isinstance(res, AnalysisResult)
    assert res.activity == ACTIVITY_UNKNOWN and res.confidence == 0.0
    assert res.status == STATUS_SUCCESS
    assert res.seat_id == "Seat2" and res.burst_uuid == "burst-abc"
    for fld in ["analysis_uuid", "burst_uuid", "seat_id", "started_at", "finished_at",
                "processing_time", "confidence", "status", "activity", "scores", "metadata"]:
        assert hasattr(res, fld), f"필드 누락 {fld}"
    eng.shutdown()
    assert eng.health()["ready"] is False
    print("PASS dummy: AnalysisResult(UNKNOWN/0/SUCCESS) + 필드 완비")


def test_manager_and_swap():
    mgr = AIManager(engine_name="dummy")
    h = mgr.health()
    assert h["loaded"] and h["engine"] == "dummy"
    res = mgr.analyze(fake_burst())
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    assert mgr.health()["analyzed"] == 1

    # reload(같은 엔진)
    mgr.reload()
    assert mgr.health()["engine"] == "dummy"

    # 엔진 교체: fake 등록 후 load
    engine_registry.register("fake", FakeEngine)
    mgr.load_engine("fake")
    res2 = mgr.analyze(fake_burst())
    assert res2.activity == "FAKE_OK", "교체된 엔진 결과여야 함"

    # 언로드 후 analyze → SKIPPED
    mgr.unload_engine()
    res3 = mgr.analyze(fake_burst())
    assert res3.status == STATUS_SKIPPED
    engine_registry.unregister("fake")
    print("PASS manager: load/analyze/reload/swap/unload(SKIPPED)")


def test_failed_path():
    class BoomEngine(AIEngine):
        name = "boom"
        def initialize(self): pass
        def analyze(self, burst): raise RuntimeError("boom")
        def shutdown(self): pass
        def health(self): return {"name": "boom"}
    engine_registry.register("boom", BoomEngine)
    mgr = AIManager(engine_name="boom")
    res = mgr.analyze(fake_burst())
    assert res.status == STATUS_FAILED and "boom" in res.metadata.get("reason", "")
    engine_registry.unregister("boom")
    print("PASS failed: 엔진 예외 → FAILED 결과")


def main():
    test_registry()
    test_dummy_engine()
    test_manager_and_swap()
    test_failed_path()
    print("\nALL PASS: registry / dummy / manager+swap / failed")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드

`README.md` 만 수정(제목/파일표 + "AI Engine Core v0.1" 섹션 신규).
**코드 파일은 하나도 수정하지 않았다.** Orchestrator 연결은 아래처럼 외부에서 콜백으로 꽂는다(무수정):
```python
from ai_manager import AIManager
from orchestrator_engine import OrchestratorEngine
ai = AIManager(engine_name="dummy")
orch = OrchestratorEngine(scheduler, camera_manager, burst_consumer=ai.analyze)
```

---

## 4. AI Engine 구조도

```
                         ┌──────────────── AIManager ────────────────┐
 BurstPackage ──analyze──▶ load_engine(name) → engine_registry.create │
                         │ analyze(burst):                            │
                         │   engine 없음 → AnalysisResult(SKIPPED)    │
                         │   engine 예외 → AnalysisResult(FAILED)     │
                         │   정상 → engine.analyze(burst)             │
                         └──────────────┬─────────────────────────────┘
                                        ▼
                              ┌──── AIEngine (ABC) ────┐
                              │ initialize / analyze    │   ← 모든 엔진 동일 인터페이스
                              │ shutdown   / health     │
                              └──────────┬──────────────┘
                                         ▼
                            ┌────────── plugins ──────────┐
                            │ DummyAIEngine (현재)         │ → AnalysisResult(UNKNOWN, conf 0)
                            │ (향후) MediaPipe/YOLO/...     │
                            └─────────────────────────────┘
                                         ▼
                                  AnalysisResult ──▶ (향후 Rule Engine, 이번엔 호출 안 함)

 engine_registry:  "dummy" → DummyAIEngine   (이름 → factory)
 OrchestratorEngine.burst_consumer = AIManager.analyze  (Orchestrator 무수정 연결)
```

---

## 5. Plugin 구조

```
plugins/
├── __init__.py          # 패키지 표식
└── dummy_engine.py      # DummyAIEngine(AIEngine) — 자리표시자(실제 분석 X)

규칙:
  - 모든 엔진은 AIEngine(initialize/analyze/shutdown/health) 을 구현.
  - engine_registry.register("이름", Factory) 로 등록.
  - 무거운 의존성(cv2/mediapipe/torch)은 lazy factory(함수 내부 import)로 등록 → 필요 시에만 로드.
향후 추가 예정(이번 범위 아님): MediaPipeEngine / YOLOEngine / OpenCVEngine / VisionTransformerEngine.
```

---

## 6. AIManager 설명

| 메서드 | 역할 |
|--------|------|
| `__init__(engine_name=None)` | 지정 시 즉시 해당 엔진 로드 |
| `load_engine(name, **kw)` | registry 로 엔진 생성 → initialize → 현재 엔진 설정(기존 엔진 자동 언로드) |
| `unload_engine()` | 현재 엔진 shutdown + 해제 |
| `reload()` | 같은 이름/옵션으로 재로드 |
| `analyze(burst)` | 현재 엔진으로 분석. 엔진 없음→SKIPPED, 예외→FAILED (절대 throw 안 함) |
| `health()` | loaded / engine / analyzed / available / engine_health |

- 엔진을 **이름으로만** 다루므로, AIManager/호출부 코드 변경 없이 엔진 교체 가능.
- `analyze` 시그니처가 `(burst)->AnalysisResult` → Orchestrator `burst_consumer` 에 직접 연결.

---

## 7. AnalysisResult 설명

| 필드 | 의미 |
|------|------|
| `analysis_uuid` | 분석 1건 고유 id |
| `burst_uuid` | 입력 BurstPackage id(역추적) |
| `seat_id` | 좌석 |
| `started_at` / `finished_at` | 분석 시작/종료 시각 |
| `processing_time` | 처리 시간(ms) |
| `confidence` | 0.0~1.0 (Dummy=0) |
| `status` | SUCCESS / FAILED / SKIPPED |
| `activity` | 활동 라벨 — 현재 "UNKNOWN" 만 |
| `scores` | 활동별 점수(현재 빈 dict) |
| `metadata` | engine/frame_count/reason 등 |

---

## 8. 테스트 결과

### test_ai_engine.py (OpenCV/AI 없이)
```
PASS registry: available/create/unknown
PASS dummy: AnalysisResult(UNKNOWN/0/SUCCESS) + 필드 완비
PASS manager: load/analyze/reload/swap/unload(SKIPPED)
PASS failed: 엔진 예외 → FAILED 결과
ALL PASS: registry / dummy / manager+swap / failed
```
(중간에 보이는 `RuntimeError: boom` 트레이스백은 FAILED-path 테스트가 의도적으로 발생시킨 예외를
`log.exception` 이 출력한 것 — 테스트는 이를 잡아 FAILED 결과로 변환하고 PASS.)

### ai_demo.py --dummy --burst-count 5
```
===== AnalysisResult x 5 =====
  seat=Seat1 status=SUCCESS activity=UNKNOWN conf=0.0 proc=0.001ms ... meta={'engine':'dummy','frame_count':5,'note':'dummy - no real analysis'}
  seat=Seat2 ... activity=UNKNOWN conf=0.0 ...
  ... (Seat3~Seat5)
----- 최종 health -----
  {'loaded': True, 'engine': 'dummy', 'analyzed': 5, 'available': ['dummy'], 'engine_health': {...,'analyzed':5}}
```

### Orchestrator(무수정) → AIManager 연결 확인
```
BurstPackage→AnalysisResult 개수: 2
  seat=Seat1 status=SUCCESS activity=UNKNOWN conf=0.0
  seat=Seat2 status=SUCCESS activity=UNKNOWN conf=0.0
PASS: Orchestrator(무수정) → AIManager → AnalysisResult 파이프라인
```

### 회귀 (기존 단계 미파손)
```
test_camera_core.py        → PASS
test_camera_manager.py     → PASS
test_scheduler_engine.py   → PASS
test_orchestrator_engine.py→ ALL PASS
test_ai_engine.py          → ALL PASS
```

### 완료 조건 체크
- [x] DummyAIEngine 정상 동작
- [x] AIManager 정상(load/unload/reload/analyze/health)
- [x] Registry 정상(이름→엔진, unknown 예외)
- [x] AnalysisResult 생성 / BurstPackage 입력
- [x] 기존 Orchestrator **수정 0** (consumer 콜백 연결)
- [x] OpenCV/MediaPipe/YOLO/Rule Engine/Supabase/Dashboard/AI 판별 **미구현**

---

## 9. 남은 기술 부채 (운영 기준)

1. **엔진 1개만 활성** — AIManager 가 단일 엔진 보유. 좌석/활동별 다중 엔진·앙상블 불가.
2. **동기 analyze** — 호출 스레드에서 즉시 처리. 실제 무거운 엔진이면 Orchestrator 워커를 블로킹. 비동기/배치 큐 없음.
3. **frames 계약 미정의** — DummyAIEngine 은 frames 를 안 본다. 실제 엔진이 기대할 frame 포맷(ndarray/디코딩 상태/샘플링)·검증·전처리 규약 부재.
4. **모델 수명주기 단순** — initialize/shutdown 만. 워밍업/모델 버전/디바이스(GPU)·메모리 관리·헬스 상세 없음.
5. **Registry 가 전역 가변 상태** — `_REGISTRY` 전역. 동시 등록/테스트 격리/네임스페이스 충돌 위험(테스트가 register/unregister 로 정리).
6. **AnalysisResult 스키마 v1 고정** — activity 문자열만. 다중 활동/박스/키포인트/타임라인 등 확장 스키마 미정의. 버전 필드 없음.
7. **결과 소비처 없음** — AnalysisResult 가 생성만 됨. Rule Engine/저장/집계 등 다운스트림 미연결(의도된 범위).
8. **관측성 부족** — analyzed 카운트뿐. 처리시간 분포/실패율/엔진별 메트릭 없음.
9. **설정 외부화 부재** — 사용할 엔진 이름/옵션이 코드/CLI 인자. config 파일/환경변수로 선택 불가.
10. **타입 계약이 덕타이핑** — burst 를 getattr 로 접근(느슨). 프로토콜/런타임 검증 없음.
11. **테스트가 pytest 아님** — assert+`__main__`. CI/동시성/대용량 입력 커버리지 부족.

---

## 10. v0.2 개선 계획

**P0 — 실제 엔진 수용 준비**
1. **frame 계약 정의** — BurstPackage.frames 의 표준(예: BGR ndarray 리스트 + 메타), 전처리/샘플링 규약, 검증 유틸.
2. **비동기/배치 analyze** — 엔진 워커 풀 또는 async, Orchestrator 워커 비블로킹. 백프레셔/타임아웃.
3. **AnalysisResult v2 스키마** — version 필드 + 다중 활동/score map/keypoint/bbox 확장, activity enum.

**P1 — 운영성**
4. **엔진 설정 외부화** — `ai.yaml`/env 로 엔진 이름·디바이스·임계값 선택. AIManager 가 로드.
5. **모델 수명주기 강화** — 워밍업, 디바이스 배치, 메모리/헬스 상세, 안전한 reload.
6. **관측성** — 처리시간 분포·실패율·엔진별 메트릭, 구조화 로그, 결과 샘플 export.

**P2 — 연결(다음 단계)**
7. **실제 엔진 플러그인**(별도 단계) — `OpenCVEngine`/`MediaPipeEngine`/`YOLOEngine` 를 동일 인터페이스로. **AIManager/Orchestrator 무수정.**
8. **AnalysisResult → Rule Engine** 어댑터(그다음 단계). 본 단계 경계 밖.
9. **pytest 전환 + CI**, Registry 격리(인스턴스화 가능한 Registry 객체).

> 경계: v0.2 까지도 **실제 AI 판별 로직/Rule Engine/Supabase/대시보드는 미구현**. "교체 가능한 AI 골격" 견고화까지만.
