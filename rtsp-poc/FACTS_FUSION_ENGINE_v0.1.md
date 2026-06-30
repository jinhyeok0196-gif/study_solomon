# Solomon Facts Fusion Engine v0.1 — 리뷰 / 복붙용 문서 (테스트 보완판)

> **한 줄 요약**: OpenCV/MediaPipe/YOLO 의 `AnalysisResult` 세 개를 받아 **하나의 `SeatFacts`** 로 합친다.
> **AI 분석기가 아니라 결과 통합기**(AIEngine 비상속). **행동 판별은 절대 하지 않는다** —
> SeatFacts 는 "좌석에서 관측된 사실 모음" 이고, `quality` 는 행동 신뢰도가 아니라 **"판정 재료의 품질"** 이다.
> cv2/mediapipe/ultralytics 없이 합성 AnalysisResult 로 **17개 테스트 전부 통과**.
>
> **이번 보완**: SeatFacts 기본 필드 / source_results / `source_statuses` 메타데이터 / seat_id·burst_uuid
> 불일치(→FAILED) / 중복 source(→최신 1개+기록) / unknown-only(→SKIPPED) 검증 추가(+엔진 일관성·중복 처리 보강).

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── config/  roi.yaml / mediapipe.yaml / yolo.yaml        # (기존) 엔진별 설정
├── plugins/ dummy_engine.py / opencv_engine.py / mediapipe_engine.py / yolo_engine.py  # (기존)
│
├── ai_engine.py / ai_manager.py / analysis_result.py / burst_package.py / engine_registry.py  # (기존)
├── vision_result.py / vision_utils.py                                  # (기존) OpenCV
├── mediapipe_result.py / mediapipe_backend.py                          # (기존) MediaPipe
├── object_detection_result.py / object_label_mapper.py / yolo_backend.py   # (기존) YOLO
│
├── seat_facts.py                # SeatFacts (좌석 단위 관측 사실 모음, 순수 데이터)
├── fusion_result.py             # FusionResult (통합 결과/상태, 순수 데이터)
├── facts_fusion_engine.py       # FactsFusionEngine (3 AnalysisResult → SeatFacts)   ✎보완
├── fusion_demo.py               # CLI 데모 (--all / --missing-yolo / --failed-mediapipe)
├── test_facts_fusion_engine.py  # Fusion 엔진 테스트 (17개)                          ✎보완
│
├── *_demo.py / manage.py / main.py                                     # (기존) 실행/데모
├── test_camera_*.py / test_scheduler_engine.py / test_orchestrator_engine.py
├── test_ai_engine.py / test_vision_engine.py / test_mediapipe_engine.py / test_yolo_engine.py
│
├── cameras.yaml / schedule.yaml / .gitignore
└── README.md                    # ✎수정 FusionResult 상태/메타 보강
```

✎ = 이번 보완에서 변경. (engine_registry/.gitignore 무수정 — Fusion 은 AIEngine 도 모델도 아님.)

---

## 2. `seat_facts.py` 전체 코드

```python
"""
SeatFacts
=========

여러 분석 엔진(OpenCV / MediaPipe / YOLO)의 결과를 **하나의 좌석 단위 사실 모음**으로
합친 표준 데이터. Rule Engine 이 사용할 **표준 입력**이다.

매우 중요:
  - SeatFacts 는 **판단 결과가 아니다.**
  - SeatFacts 는 "현재 좌석에서 관측된 사실(Facts) 모음" 일 뿐이다.
  - 공부/휴대폰 사용/수면/자리비움 같은 **최종 행동 판별을 절대 담지 않는다**(Rule Engine 의 일).

이 모듈은 OpenCV / MediaPipe / YOLO 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class SeatFacts:
    facts_uuid: str
    burst_uuid: str
    seat_id: str
    period_id: Optional[str]
    period_name: Optional[str]
    captured_at: Optional[datetime]
    generated_at: datetime

    # 엔진별 사실 묶음(해석 없음)
    vision: Dict[str, Any] = field(default_factory=dict)    # OpenCV 요약
    human: Dict[str, Any] = field(default_factory=dict)     # MediaPipe 요약
    objects: Dict[str, Any] = field(default_factory=dict)   # YOLO 요약

    # 전체 "판정 재료 품질" 점수(행동 신뢰도가 아님)
    quality: Dict[str, Any] = field(default_factory=dict)

    # 입력으로 사용된 AnalysisResult UUID 목록
    source_results: List[str] = field(default_factory=list)

    # trace 정보, engine 상태, 오류, 누락된 결과 등
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        """로그/출력용 축약 dict."""
        return {
            "facts_uuid": self.facts_uuid,
            "burst_uuid": self.burst_uuid,
            "seat_id": self.seat_id,
            "period_id": self.period_id,
            "vision": self.vision,
            "human": self.human,
            "objects": self.objects,
            "quality": self.quality,
            "source_results": list(self.source_results),
        }
```

---

## 3. `fusion_result.py` 전체 코드

```python
"""
FusionResult
============

FactsFusionEngine.fuse() 의 반환값. SeatFacts 생성 결과와 그 과정의 상태를 담는다.

status:
  - SUCCESS : OpenCV/MediaPipe/YOLO 결과가 모두 정상(SUCCESS)으로 들어옴
  - PARTIAL : 일부 결과가 누락/실패했지만 SeatFacts 생성은 가능
  - FAILED  : 치명적 오류로 SeatFacts 생성 실패(쓸 수 있는 source 가 없음)
  - SKIPPED : 입력 결과가 아예 없거나 분석 불가

이 모듈은 OpenCV / MediaPipe / YOLO 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from seat_facts import SeatFacts

# fusion 상태
FUSION_SUCCESS = "SUCCESS"
FUSION_PARTIAL = "PARTIAL"
FUSION_FAILED = "FAILED"
FUSION_SKIPPED = "SKIPPED"


@dataclass
class FusionResult:
    fusion_uuid: str
    seat_id: str
    burst_uuid: str
    status: str                                  # SUCCESS | PARTIAL | FAILED | SKIPPED
    seat_facts: Optional[SeatFacts]              # FAILED/SKIPPED 면 None 일 수 있음
    missing_sources: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    generated_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
```

---

## 4. `facts_fusion_engine.py` 전체 코드 (보완됨)

```python
"""
FactsFusionEngine (Solomon Facts Fusion Engine v0.1)
====================================================

OpenCV / MediaPipe / YOLO 의 AnalysisResult 들을 입력받아 **SeatFacts** 하나로 합친다.

  [opencv AnalysisResult, mediapipe AnalysisResult, yolo AnalysisResult]
        → fuse() → FusionResult(seat_facts=SeatFacts, status=...)

매우 중요(이번 단계 범위):
  - 이 엔진은 **AI 분석기가 아니라 결과 통합기**다(AIEngine 을 상속하지 않는다).
  - 공부/휴대폰 사용/수면/자리비움 같은 **최종 행동 판별을 절대 하지 않는다.**
  - SeatFacts 는 "관측된 사실 모음" 일 뿐, 판단 결과가 아니다.
  - quality 는 행동 신뢰도가 아니라 **"판정 재료의 품질"** 이다.

입력 source 는 AnalysisResult.metadata["engine"] 값으로 구분한다:
  "opencv" → vision, "mediapipe" → human, "yolo" → objects, 그 외 → unknown_sources

이 모듈은 OpenCV / MediaPipe / YOLO / cv2 에 의존하지 않는다(dict 만 읽는다).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from analysis_result import STATUS_SUCCESS, STATUS_FAILED, STATUS_SKIPPED
from seat_facts import SeatFacts
from fusion_result import (
    FusionResult,
    FUSION_SUCCESS, FUSION_PARTIAL, FUSION_FAILED, FUSION_SKIPPED,
)

log = logging.getLogger("facts_fusion_engine")

# 엔진 이름 → SeatFacts 섹션
SOURCE_OPENCV = "opencv"
SOURCE_MEDIAPIPE = "mediapipe"
SOURCE_YOLO = "yolo"
KNOWN_SOURCES = (SOURCE_OPENCV, SOURCE_MEDIAPIPE, SOURCE_YOLO)

# usable_for_rule_engine 임계값(판정 재료로 쓸 만한 최소 품질)
USABLE_THRESHOLD = 0.3


class FactsFusionEngine:
    name = "facts_fusion"

    def __init__(self, usable_threshold: float = USABLE_THRESHOLD, **kwargs) -> None:
        self.usable_threshold = usable_threshold
        self._ready = False
        self._fused = 0

    # ----------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        self._ready = True
        log.info("FactsFusionEngine 초기화 - usable_threshold=%s", self.usable_threshold)

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"name": self.name, "ready": self._ready, "fused": self._fused,
                "usable_threshold": self.usable_threshold,
                "known_sources": list(KNOWN_SOURCES)}

    # ----------------------------------------------------------- fuse
    def fuse(self, results: List[Any], context: Optional[Dict[str, Any]] = None
             ) -> FusionResult:
        """AnalysisResult 목록 → FusionResult(SeatFacts). context 로 교시/시각 보강(선택)."""
        generated_at = datetime.now()
        ctx = dict(context or {})
        try:
            return self._fuse(results or [], ctx, generated_at)
        except Exception as exc:                 # 통합 자체가 깨지면 FAILED
            log.exception("FactsFusionEngine.fuse 예외")
            return FusionResult(
                fusion_uuid=uuid.uuid4().hex,
                seat_id=ctx.get("seat_id", ""),
                burst_uuid=ctx.get("burst_uuid", ""),
                status=FUSION_FAILED,
                seat_facts=None,
                missing_sources=list(KNOWN_SOURCES),
                errors=[f"{type(exc).__name__}: {exc}"],
                generated_at=generated_at,
                metadata={"engine": self.name, "fatal": True},
            )

    def _fuse(self, results: List[Any], ctx: Dict[str, Any],
              generated_at: datetime) -> FusionResult:
        # 1) engine 별 결과 분류(같은 engine 이 여러 개면 최신=마지막 것 사용 + 중복 기록)
        by_engine: Dict[str, Any] = {}
        unknown_sources: List[str] = []
        duplicate_sources: List[str] = []
        for r in results:
            eng = (getattr(r, "metadata", {}) or {}).get("engine")
            if eng in KNOWN_SOURCES:
                if eng in by_engine and eng not in duplicate_sources:
                    duplicate_sources.append(eng)   # 중복 → 최신만 쓰고 사실 기록
                by_engine[eng] = r                  # 최신(마지막) 우선
            else:
                unknown_sources.append(str(eng))

        present = [e for e in KNOWN_SOURCES if e in by_engine]
        missing = [e for e in KNOWN_SOURCES if e not in by_engine]

        # source_statuses: present 는 실제 상태, 누락은 "MISSING"
        source_statuses: Dict[str, str] = {}
        for e in KNOWN_SOURCES:
            source_statuses[e] = getattr(by_engine[e], "status", STATUS_SKIPPED) \
                if e in by_engine else "MISSING"

        seat_id = ctx.get("seat_id") or _first_attr(by_engine.values(), "seat_id", "")
        burst_uuid = ctx.get("burst_uuid") or _first_attr(by_engine.values(), "burst_uuid", "")

        base_meta = {
            "engine": self.name,
            "present_sources": present,
            "missing_sources": missing,
            "unknown_sources": unknown_sources,
            "duplicate_sources": duplicate_sources,
            "source_statuses": source_statuses,
        }

        # 입력에 알려진 source 가 하나도 없음(unknown 만 있거나 빈 입력) → SKIPPED
        if not present:
            self._fused += 1
            return FusionResult(
                fusion_uuid=uuid.uuid4().hex,
                seat_id=seat_id, burst_uuid=burst_uuid,
                status=FUSION_SKIPPED, seat_facts=None,
                missing_sources=missing, errors=[],
                generated_at=generated_at,
                metadata=base_meta,
            )

        # 2) 일관성 검사: 서로 다른 좌석/Burst 결과가 섞이면 합치지 않는다(안전 우선) → FAILED
        errors: List[str] = []
        seat_ids = sorted({getattr(by_engine[e], "seat_id", "") for e in present
                           if getattr(by_engine[e], "seat_id", "")})
        burst_uuids = sorted({getattr(by_engine[e], "burst_uuid", "") for e in present
                              if getattr(by_engine[e], "burst_uuid", "")})
        if len(seat_ids) > 1:
            errors.append(f"seat_id mismatch: {seat_ids}")
        if len(burst_uuids) > 1:
            errors.append(f"burst_uuid mismatch: {burst_uuids}")
        if errors:
            self._fused += 1
            return FusionResult(
                fusion_uuid=uuid.uuid4().hex,
                seat_id=seat_id, burst_uuid=burst_uuid,
                status=FUSION_FAILED, seat_facts=None,
                missing_sources=missing, errors=errors,
                generated_at=generated_at,
                metadata={**base_meta, "consistency_error": True},
            )

        # 3) source 별 FAILED 오류 수집
        for e in present:
            if source_statuses[e] == STATUS_FAILED:
                errs = (getattr(by_engine[e], "metadata", {}) or {}).get("errors", []) or []
                errors.append(f"{e}: FAILED ({'; '.join(map(str, errs)) or 'no detail'})")

        failed = [e for e in present if source_statuses[e] == STATUS_FAILED]

        # 4) 모든 present 가 FAILED → SeatFacts 생성 불가 → FAILED
        if len(failed) == len(present):
            self._fused += 1
            return FusionResult(
                fusion_uuid=uuid.uuid4().hex,
                seat_id=seat_id, burst_uuid=burst_uuid,
                status=FUSION_FAILED, seat_facts=None,
                missing_sources=missing, errors=errors,
                generated_at=generated_at,
                metadata=base_meta,
            )

        # 5) SeatFacts 생성(실패/누락 source 는 빈 섹션으로)
        vision = _extract_vision(by_engine.get(SOURCE_OPENCV))
        human = _extract_human(by_engine.get(SOURCE_MEDIAPIPE))
        objects = _extract_objects(by_engine.get(SOURCE_YOLO))
        quality = self._compute_quality(by_engine, present, source_statuses)

        source_results = [getattr(by_engine[e], "analysis_uuid", "") for e in present]

        seat_facts = SeatFacts(
            facts_uuid=uuid.uuid4().hex,
            burst_uuid=burst_uuid,
            seat_id=seat_id,
            period_id=ctx.get("period_id"),
            period_name=ctx.get("period_name"),
            captured_at=ctx.get("captured_at"),
            generated_at=generated_at,
            vision=vision,
            human=human,
            objects=objects,
            quality=quality,
            source_results=source_results,
            metadata={
                "present_sources": present,
                "missing_sources": missing,
                "unknown_sources": unknown_sources,
                "duplicate_sources": duplicate_sources,
                "source_statuses": source_statuses,
                "errors": errors,
            },
        )

        # 6) 최종 status 판정
        all_present = len(present) == len(KNOWN_SOURCES)
        all_success = all(source_statuses[e] == STATUS_SUCCESS for e in present)
        status = FUSION_SUCCESS if (all_present and all_success) else FUSION_PARTIAL

        self._fused += 1
        return FusionResult(
            fusion_uuid=uuid.uuid4().hex,
            seat_id=seat_id, burst_uuid=burst_uuid,
            status=status, seat_facts=seat_facts,
            missing_sources=missing, errors=errors,
            generated_at=generated_at,
            metadata={**base_meta,
                      "overall_quality": quality.get("overall_quality"),
                      "usable_for_rule_engine": quality.get("usable_for_rule_engine")},
        )

    # ----------------------------------------------------------- quality
    def _compute_quality(self, by_engine: Dict[str, Any], present: List[str],
                         source_statuses: Dict[str, str]) -> Dict[str, Any]:
        """판정 재료 품질(행동 신뢰도가 아님). 누락 source 는 None(평균서 제외)."""
        # vision: SUCCESS=1.0, 그 외(FAILED/SKIPPED)=0.0
        vision_q = None
        if SOURCE_OPENCV in present:
            vision_q = 1.0 if source_statuses[SOURCE_OPENCV] == STATUS_SUCCESS else 0.0

        # human: MediaPipe scores.quality_score(FAILED 면 0.0)
        human_q = None
        if SOURCE_MEDIAPIPE in present:
            human_q = 0.0 if source_statuses[SOURCE_MEDIAPIPE] == STATUS_FAILED \
                else _score(by_engine[SOURCE_MEDIAPIPE], "quality_score")

        # object: YOLO scores.quality_score(FAILED 면 0.0)
        object_q = None
        if SOURCE_YOLO in present:
            object_q = 0.0 if source_statuses[SOURCE_YOLO] == STATUS_FAILED \
                else _score(by_engine[SOURCE_YOLO], "quality_score")

        avail = [q for q in (vision_q, human_q, object_q) if q is not None]
        overall = round(sum(avail) / len(avail), 4) if avail else 0.0
        return {
            "vision_quality": vision_q,
            "human_quality": human_q,
            "object_quality": object_q,
            "overall_quality": overall,
            "usable_for_rule_engine": overall >= self.usable_threshold,
        }


# ---------------------------------------------------------------- extractors
def _extract_vision(r: Optional[Any]) -> Dict[str, Any]:
    """OpenCV AnalysisResult → vision facts."""
    if r is None:
        return {}
    scores = getattr(r, "scores", {}) or {}
    md = getattr(r, "metadata", {}) or {}
    vis = md.get("vision", {}) or {}
    return {
        "blur_score": scores.get("blur_score"),
        "brightness": scores.get("brightness"),
        "contrast": scores.get("contrast"),
        "sharpness": scores.get("sharpness"),
        "valid_frames": vis.get("valid_frames"),
        "discarded_frames": md.get("discarded_frames"),
        "discard_reasons": md.get("discard_reasons", {}) or {},
        "roi_applied": vis.get("roi_applied"),
        "resolution": vis.get("resolution"),
        "status": getattr(r, "status", None),
    }


def _extract_human(r: Optional[Any]) -> Dict[str, Any]:
    """MediaPipe AnalysisResult → human facts(해석 없이 원자적 특징만)."""
    if r is None:
        return {}
    scores = getattr(r, "scores", {}) or {}
    md = getattr(r, "metadata", {}) or {}
    mr = md.get("mediapipe_result", {}) or {}
    hf = md.get("head_features", {}) or {}
    handf = md.get("hand_features", {}) or {}
    pf = md.get("pose_features", {}) or {}
    return {
        "face_detected": mr.get("face_detected"),
        "face_visible_ratio": scores.get("face_visible_ratio"),
        "approximate_head_center": hf.get("approximate_head_center"),
        "hands_detected": mr.get("hands_detected"),
        "hands_visible_ratio": scores.get("hands_visible_ratio"),
        "left_hand_detected": handf.get("left_hand_detected"),
        "right_hand_detected": handf.get("right_hand_detected"),
        "pose_detected": mr.get("pose_detected"),
        "pose_visible_ratio": scores.get("pose_visible_ratio"),
        "shoulder_visible": pf.get("shoulder_visible"),
        "upper_body_visible": pf.get("upper_body_visible"),
        "quality_score": scores.get("quality_score"),
        "status": getattr(r, "status", None),
    }


def _extract_objects(r: Optional[Any]) -> Dict[str, Any]:
    """YOLO AnalysisResult → object facts(객체가 보였다는 사실만)."""
    if r is None:
        return {}
    md = getattr(r, "metadata", {}) or {}
    odr = md.get("object_detection_result", {}) or {}
    return {
        "phone_detected": odr.get("phone_detected"),
        "phone_detection_count": odr.get("phone_detection_count"),
        "book_detected": odr.get("book_detected"),
        "book_detection_count": odr.get("book_detection_count"),
        "laptop_detected": odr.get("laptop_detected"),
        "laptop_detection_count": odr.get("laptop_detection_count"),
        "tablet_detected": odr.get("tablet_detected"),
        "tablet_detection_count": odr.get("tablet_detection_count"),
        "person_detected": odr.get("person_detected"),
        "person_detection_count": odr.get("person_detection_count"),
        "max_person_count": md.get("max_person_count", odr.get("max_person_count")),
        "object_counts": md.get("object_counts", odr.get("object_counts", {})) or {},
        "detected_objects_count": md.get("detected_objects_count"),
        "avg_detection_confidence": odr.get("avg_detection_confidence"),
        "max_detection_confidence": odr.get("max_detection_confidence"),
        "status": getattr(r, "status", None),
    }


def _score(r: Any, key: str, default: float = 0.0) -> float:
    try:
        return float((getattr(r, "scores", {}) or {}).get(key, default))
    except (TypeError, ValueError):
        return default


def _first_attr(objs, attr: str, default):
    for o in objs:
        v = getattr(o, attr, None)
        if v:
            return v
    return default
```

**이번 보완에서 엔진에 추가된 동작**
- `duplicate_sources`: 같은 engine 이 2번 이상 오면 **최신(마지막) 1개만** 쓰고 목록에 기록(치명적 아님).
- `source_statuses`: present 는 실제 status, 누락은 `"MISSING"` — FusionResult/SeatFacts 양쪽 metadata 에 기록.
- **일관성 검사**: present 결과들의 `seat_id`/`burst_uuid` 가 둘 이상으로 갈리면 **합치지 않고 FAILED**(+`errors`, `consistency_error: true`).

---

## 5. `fusion_demo.py` 전체 코드

```python
"""
Solomon Facts Fusion Engine v0.1 - CLI 데모
===========================================

OpenCV / MediaPipe / YOLO 의 AnalysisResult 를 만들어 FactsFusionEngine 으로 합치고
**SeatFacts** 를 출력한다. **행동 판별은 절대 하지 않는다** — 관측된 사실만 합친다.

MediaPipe/YOLO 결과는 실제 엔진(Fake backend)으로 생성하고, OpenCV 결과는 (cv2 미설치 환경
대비) 실제 OpenCVEngine 의 출력 스키마와 동일한 합성 AnalysisResult 로 만든다.

실행 예시:
  python fusion_demo.py --all                # 세 엔진 결과 모두 → SUCCESS
  python fusion_demo.py --missing-yolo       # YOLO 누락 → PARTIAL
  python fusion_demo.py --failed-mediapipe   # MediaPipe FAILED → PARTIAL
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime

import numpy as np

from analysis_result import (
    AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS,
)
from burst_package import BurstPackage
from plugins.mediapipe_engine import MediaPipeEngine
from mediapipe_backend import FakeMediaPipeBackend
from plugins.yolo_engine import YOLOEngine
from yolo_backend import FakeYOLOBackend
from facts_fusion_engine import FactsFusionEngine


def parse_args():
    p = argparse.ArgumentParser(description="Solomon Facts Fusion Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="세 엔진 결과 모두(기본)")
    mode.add_argument("--missing-yolo", action="store_true", help="YOLO 결과 누락")
    mode.add_argument("--failed-mediapipe", action="store_true", help="MediaPipe FAILED")
    return p.parse_args()


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


class _Item:
    def __init__(self, img, ts):
        self.frame = img; self.timestamp = ts; self.frame_index = 0


def _burst(seat="Seat1"):
    rng = np.random.RandomState(0)
    frames = [_Item(rng.randint(40, 220, (240, 320, 3), dtype=np.uint8), float(i))
              for i in range(6)]
    return BurstPackage(
        burst_uuid="demo-burst", trigger_uuid="demo", trigger_id="demo_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )


def opencv_result(seat="Seat1") -> AnalysisResult:
    """실제 OpenCVEngine.analyze() 출력 스키마와 동일한 합성 결과."""
    now = datetime.now()
    return AnalysisResult(
        analysis_uuid=uuid.uuid4().hex, burst_uuid="demo-burst", seat_id=seat,
        started_at=now, finished_at=now, processing_time=1.2,
        confidence=0.0, status=STATUS_SUCCESS, activity=ACTIVITY_UNKNOWN,
        scores={"blur_score": 120.5, "brightness": 118.3,
                "contrast": 45.2, "sharpness": 30.1},
        metadata={
            "engine": "opencv",
            "vision": {"vision_uuid": uuid.uuid4().hex, "frame_count": 6,
                       "valid_frames": 5, "roi_applied": False, "resolution": "320x240"},
            "discarded_frames": 1, "discard_reasons": {"too_dark": 1},
        },
    )


def mediapipe_result(burst, fail=False) -> AnalysisResult:
    backend = FakeMediaPipeBackend(fail=fail)
    eng = MediaPipeEngine(backend=backend)
    eng.initialize()
    return eng.analyze(burst)


def yolo_result(burst) -> AnalysisResult:
    eng = YOLOEngine(backend=FakeYOLOBackend())
    eng.initialize()
    return eng.analyze(burst)


def main() -> int:
    args = parse_args()
    setup_logging()
    burst = _burst()

    results = [opencv_result()]
    if args.failed_mediapipe:
        results.append(mediapipe_result(burst, fail=True))
        results.append(yolo_result(burst))
    elif args.missing_yolo:
        results.append(mediapipe_result(burst))
    else:  # --all (기본)
        results.append(mediapipe_result(burst))
        results.append(yolo_result(burst))

    fusion = FactsFusionEngine()
    fusion.initialize()
    fr = fusion.fuse(results, context={
        "seat_id": "Seat1", "burst_uuid": "demo-burst",
        "period_id": "P0", "period_name": "0교시", "captured_at": burst.captured_at,
    })

    print("===== FusionResult =====")
    print(f"  status={fr.status} seat={fr.seat_id} burst={fr.burst_uuid}")
    print(f"  missing_sources={fr.missing_sources} errors={fr.errors}")
    sf = fr.seat_facts
    if sf is None:
        print("  seat_facts=None (생성 불가)")
        return 0
    q = sf.quality
    print("===== SeatFacts =====")
    print(f"  source_results={sf.source_results}")
    print(f"  quality: vision={q['vision_quality']} human={q['human_quality']} "
          f"object={q['object_quality']} overall={q['overall_quality']} "
          f"usable_for_rule_engine={q['usable_for_rule_engine']}")
    print(f"  vision={sf.vision}")
    print(f"  human={sf.human}")
    print(f"  objects={sf.objects}")
    fusion.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 6. `test_facts_fusion_engine.py` 전체 코드 (보완됨, 17개)

```python
"""
Facts Fusion Engine v0.1 테스트.

**cv2 / mediapipe / ultralytics 없이** 합성 AnalysisResult 로 통과한다.

**원칙: Facts Fusion 은 행동 판별을 하지 않는다.** SeatFacts 는 "관측된 사실 모음" 일 뿐이고,
이 테스트들은 통합/상태/품질/일관성만 검증한다(공부/휴대폰/수면/자리비움 판별 검증은 없다).

검증:
  - OpenCV + MediaPipe + YOLO 모두 SUCCESS → FusionResult SUCCESS
  - YOLO 누락 → PARTIAL (+ missing_sources)
  - MediaPipe FAILED → PARTIAL (+ errors), 정책 확인
  - 모든 source FAILED → FAILED
  - 입력 없음 → SKIPPED
  - unknown engine → metadata.unknown_sources 기록
  - SeatFacts 필드/섹션 생성
  - quality score 계산(vision/human/object/overall)
  - usable_for_rule_engine 임계(0.3) 계산
  - 행동 판별(activity) 없음(SeatFacts 에 activity 키 자체가 없음)
  - SeatFacts 기본 필드(facts_uuid/burst_uuid/seat_id/generated_at/captured_at/period_*)
  - source_results 에 3 엔진 analysis_uuid 모두 포함
  - metadata.source_statuses 에 opencv/mediapipe/yolo 상태 기록
  - seat_id 불일치 → FAILED + errors
  - burst_uuid 불일치 → FAILED + errors
  - 중복 source(YOLO 2개) → 최신 1개 사용 + duplicate_sources 기록
  - unknown source 만 → SKIPPED
  - 기존 dummy/opencv/mediapipe/yolo 엔진 등록이 깨지지 않음
"""
import uuid
from datetime import datetime

from analysis_result import (
    AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_FAILED, STATUS_SKIPPED,
)
from seat_facts import SeatFacts
from fusion_result import (
    FUSION_SUCCESS, FUSION_PARTIAL, FUSION_FAILED, FUSION_SKIPPED,
)
from facts_fusion_engine import FactsFusionEngine


# ---- 합성 AnalysisResult 빌더 ---------------------------------------------
def _ar(engine, status=STATUS_SUCCESS, scores=None, metadata=None,
        seat="Seat1", burst="b1"):
    now = datetime.now()
    md = {"engine": engine}
    md.update(metadata or {})
    return AnalysisResult(
        analysis_uuid=uuid.uuid4().hex, burst_uuid=burst, seat_id=seat,
        started_at=now, finished_at=now, processing_time=1.0,
        confidence=0.0, status=status, activity=ACTIVITY_UNKNOWN,
        scores=scores or {}, metadata=md,
    )


def opencv_ar(status=STATUS_SUCCESS, seat="Seat1", burst="b1"):
    return _ar("opencv", status, seat=seat, burst=burst,
               scores={"blur_score": 120.5, "brightness": 118.3,
                       "contrast": 45.2, "sharpness": 30.1},
               metadata={"vision": {"vision_uuid": "v1", "frame_count": 6,
                                    "valid_frames": 5, "roi_applied": False,
                                    "resolution": "320x240"},
                         "discarded_frames": 1, "discard_reasons": {"too_dark": 1}})


def mediapipe_ar(status=STATUS_SUCCESS, quality=0.8, seat="Seat1", burst="b1"):
    return _ar("mediapipe", status, seat=seat, burst=burst,
               scores={"quality_score": quality, "face_visible_ratio": 1.0,
                       "hands_visible_ratio": 1.0, "pose_visible_ratio": 1.0},
               metadata={"mediapipe_result": {"face_detected": True,
                                              "pose_detected": True,
                                              "hands_detected": True},
                         "head_features": {"approximate_head_center": [0.5, 0.45]},
                         "hand_features": {"left_hand_detected": True,
                                           "right_hand_detected": True},
                         "pose_features": {"shoulder_visible": True,
                                           "upper_body_visible": True},
                         "errors": []})


def yolo_ar(status=STATUS_SUCCESS, quality=0.75, seat="Seat1", burst="b1"):
    return _ar("yolo", status, seat=seat, burst=burst,
               scores={"quality_score": quality, "phone_score": 0.87,
                       "book_score": 0.74, "laptop_score": 0.66,
                       "tablet_score": 0.55, "person_score": 0.9},
               metadata={"object_detection_result": {
                             "phone_detected": True, "phone_detection_count": 3,
                             "book_detected": True, "book_detection_count": 3,
                             "laptop_detected": True, "laptop_detection_count": 3,
                             "tablet_detected": True, "tablet_detection_count": 3,
                             "person_detected": True, "person_detection_count": 3,
                             "avg_detection_confidence": 0.7533,
                             "max_detection_confidence": 0.9},
                         "object_counts": {"phone": 3, "person": 6},
                         "max_person_count": 2, "detected_objects_count": 18,
                         "errors": []})


def make_engine():
    eng = FactsFusionEngine()
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_all_success():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar()])
    assert fr.status == FUSION_SUCCESS
    assert fr.missing_sources == [] and fr.errors == []
    sf = fr.seat_facts
    assert isinstance(sf, SeatFacts)
    # 세 섹션 모두 채워짐
    assert sf.vision["blur_score"] == 120.5
    assert sf.human["face_detected"] is True
    assert sf.human["approximate_head_center"] == [0.5, 0.45]
    assert sf.objects["phone_detected"] is True
    assert sf.objects["max_person_count"] == 2
    assert len(sf.source_results) == 3
    print("PASS all_success: 세 엔진 모두 SUCCESS → SUCCESS, SeatFacts 3섹션")


def test_quality_and_usable():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(quality=0.8), yolo_ar(quality=0.75)])
    q = fr.seat_facts.quality
    assert q["vision_quality"] == 1.0      # opencv SUCCESS
    assert q["human_quality"] == 0.8
    assert q["object_quality"] == 0.75
    assert q["overall_quality"] == round((1.0 + 0.8 + 0.75) / 3, 4)
    assert q["usable_for_rule_engine"] is True
    print("PASS quality: vision/human/object/overall + usable_for_rule_engine")


def test_usable_threshold_false():
    eng = make_engine()
    # opencv SKIPPED(0.0) + 낮은 품질 → overall < 0.3
    fr = eng.fuse([opencv_ar(STATUS_SKIPPED),
                   mediapipe_ar(quality=0.1), yolo_ar(quality=0.1)])
    q = fr.seat_facts.quality
    assert q["vision_quality"] == 0.0
    assert q["overall_quality"] < 0.3
    assert q["usable_for_rule_engine"] is False
    assert fr.status == FUSION_PARTIAL     # opencv SKIPPED → all_success 아님
    print("PASS threshold: overall<0.3 → usable_for_rule_engine False")


def test_missing_yolo_partial():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar()])
    assert fr.status == FUSION_PARTIAL
    assert fr.missing_sources == ["yolo"]
    assert fr.seat_facts.objects == {}     # YOLO 누락 → 빈 섹션
    assert fr.seat_facts.quality["object_quality"] is None
    print("PASS missing_yolo: YOLO 누락 → PARTIAL + missing_sources")


def test_failed_mediapipe_partial():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(STATUS_FAILED), yolo_ar()])
    assert fr.status == FUSION_PARTIAL
    assert any("mediapipe" in e for e in fr.errors)
    assert fr.seat_facts.quality["human_quality"] == 0.0   # FAILED → 0.0
    # 나머지 섹션은 정상
    assert fr.seat_facts.vision["blur_score"] == 120.5
    assert fr.seat_facts.objects["phone_detected"] is True
    print("PASS failed_mediapipe: 일부 FAILED → PARTIAL + errors")


def test_all_failed():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(STATUS_FAILED), mediapipe_ar(STATUS_FAILED),
                   yolo_ar(STATUS_FAILED)])
    assert fr.status == FUSION_FAILED
    assert fr.seat_facts is None
    assert len(fr.errors) >= 1
    print("PASS all_failed: 모든 source FAILED → FAILED")


def test_empty_skipped():
    eng = make_engine()
    fr = eng.fuse([])
    assert fr.status == FUSION_SKIPPED
    assert fr.seat_facts is None
    assert set(fr.missing_sources) == {"opencv", "mediapipe", "yolo"}
    print("PASS empty: 입력 없음 → SKIPPED")


def test_unknown_engine_recorded():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar(),
                   _ar("some_future_engine")])
    assert "some_future_engine" in fr.metadata["unknown_sources"]
    assert fr.status == FUSION_SUCCESS     # 알려진 3개가 모두 SUCCESS
    print("PASS unknown: 알 수 없는 engine → metadata.unknown_sources")


def test_no_activity_in_facts():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar()])
    sf = fr.seat_facts
    # SeatFacts 어디에도 행동 판별(activity) 키가 없어야 한다
    for section in (sf.vision, sf.human, sf.objects, sf.quality):
        assert "activity" not in section
    assert not hasattr(sf, "activity")
    print("PASS no_activity: SeatFacts 에 행동 판별 없음")


def test_seat_facts_basic_fields():
    eng = make_engine()
    captured = datetime(2026, 6, 30, 9, 5)
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), yolo_ar()], context={
        "period_id": "P0", "period_name": "0교시", "captured_at": captured})
    sf = fr.seat_facts
    assert sf.facts_uuid                       # 존재(빈 문자열 아님)
    assert sf.burst_uuid == "b1"
    assert sf.seat_id == "Seat1"
    assert sf.generated_at is not None
    assert sf.captured_at == captured
    assert sf.period_id == "P0" and sf.period_name == "0교시"
    print("PASS basic_fields: facts_uuid/burst_uuid/seat_id/generated_at/captured_at/period_*")


def test_source_results_contains_all_uuids():
    eng = make_engine()
    o, m, y = opencv_ar(), mediapipe_ar(), yolo_ar()
    fr = eng.fuse([o, m, y])
    src = fr.seat_facts.source_results
    assert o.analysis_uuid in src
    assert m.analysis_uuid in src
    assert y.analysis_uuid in src
    assert len(src) == 3
    print("PASS source_results: opencv/mediapipe/yolo analysis_uuid 모두 포함")


def test_source_statuses_metadata():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(STATUS_SUCCESS),
                   mediapipe_ar(STATUS_FAILED),
                   yolo_ar(STATUS_SKIPPED)])
    # FusionResult.metadata 와 SeatFacts.metadata 양쪽에 기록
    for md in (fr.metadata, fr.seat_facts.metadata):
        ss = md["source_statuses"]
        assert ss["opencv"] == STATUS_SUCCESS
        assert ss["mediapipe"] == STATUS_FAILED
        assert ss["yolo"] == STATUS_SKIPPED
    assert fr.status == FUSION_PARTIAL         # 1개만 FAILED → PARTIAL
    print("PASS source_statuses: opencv/mediapipe/yolo SUCCESS/FAILED/SKIPPED 기록")


def test_seat_id_mismatch_failed():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(seat="Seat1"),
                   mediapipe_ar(seat="Seat2"),   # 다른 좌석 혼입
                   yolo_ar(seat="Seat1")])
    assert fr.status == FUSION_FAILED
    assert fr.seat_facts is None
    assert any("seat_id mismatch" in e for e in fr.errors)
    assert fr.metadata.get("consistency_error") is True
    print("PASS seat_mismatch: 다른 seat_id 혼입 → FAILED + errors")


def test_burst_uuid_mismatch_failed():
    eng = make_engine()
    fr = eng.fuse([opencv_ar(burst="b1"),
                   mediapipe_ar(burst="b1"),
                   yolo_ar(burst="b2")])         # 다른 Burst 혼입
    assert fr.status == FUSION_FAILED
    assert fr.seat_facts is None
    assert any("burst_uuid mismatch" in e for e in fr.errors)
    print("PASS burst_mismatch: 다른 burst_uuid 혼입 → FAILED + errors")


def test_duplicate_source_latest_used():
    eng = make_engine()
    y_old = yolo_ar(quality=0.30)
    y_new = yolo_ar(quality=0.90)               # 같은 engine='yolo' 2번째
    fr = eng.fuse([opencv_ar(), mediapipe_ar(), y_old, y_new])
    # 정책: 최신(마지막) 1개만 사용 + 중복 사실 기록
    assert "yolo" in fr.metadata["duplicate_sources"]
    assert y_new.analysis_uuid in fr.seat_facts.source_results
    assert y_old.analysis_uuid not in fr.seat_facts.source_results
    assert fr.seat_facts.quality["object_quality"] == 0.90   # 최신 값 반영
    assert fr.status == FUSION_SUCCESS          # 중복은 치명적 아님
    print("PASS duplicate: YOLO 2개 → 최신 1개 사용 + duplicate_sources 기록")


def test_unknown_only_skipped():
    eng = make_engine()
    fr = eng.fuse([_ar("future_engine_a"), _ar("future_engine_b")])
    assert fr.status == FUSION_SKIPPED          # 알려진 source 0개
    assert fr.seat_facts is None
    assert "future_engine_a" in fr.metadata["unknown_sources"]
    assert "future_engine_b" in fr.metadata["unknown_sources"]
    assert set(fr.missing_sources) == {"opencv", "mediapipe", "yolo"}
    print("PASS unknown_only: unknown source 만 → SKIPPED")


def test_existing_engines_intact():
    import engine_registry as reg
    for name in ("dummy", "opencv", "mediapipe", "yolo"):
        assert name in reg.available_engines(), name
    d = reg.create_engine("dummy")
    d.initialize()
    from burst_package import BurstPackage
    b = BurstPackage(burst_uuid="b", trigger_uuid="t", trigger_id="x",
                     trigger_type="mid_study_check", period_id="P0", period_name="0",
                     seat_id="Seat1", captured_at=datetime.now(),
                     frame_count=0, frames=[], metadata={})
    res = d.analyze(b)
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    print("PASS intact: dummy/opencv/mediapipe/yolo 등록 유지(dummy 동작)")


def main():
    test_all_success()
    test_quality_and_usable()
    test_usable_threshold_false()
    test_missing_yolo_partial()
    test_failed_mediapipe_partial()
    test_all_failed()
    test_empty_skipped()
    test_unknown_engine_recorded()
    test_no_activity_in_facts()
    test_seat_facts_basic_fields()
    test_source_results_contains_all_uuids()
    test_source_statuses_metadata()
    test_seat_id_mismatch_failed()
    test_burst_uuid_mismatch_failed()
    test_duplicate_source_latest_used()
    test_unknown_only_skipped()
    test_existing_engines_intact()
    print("\nALL PASS: all_success / quality / threshold / missing_yolo / "
          "failed_mediapipe / all_failed / empty / unknown / no_activity / "
          "basic_fields / source_results / source_statuses / seat_mismatch / "
          "burst_mismatch / duplicate / unknown_only / intact")


if __name__ == "__main__":
    main()
```

---

## 7. 테스트 결과

`python test_facts_fusion_engine.py` (cv2/mediapipe/ultralytics **없이** 실행):

```
PASS all_success: 세 엔진 모두 SUCCESS → SUCCESS, SeatFacts 3섹션
PASS quality: vision/human/object/overall + usable_for_rule_engine
PASS threshold: overall<0.3 → usable_for_rule_engine False
PASS missing_yolo: YOLO 누락 → PARTIAL + missing_sources
PASS failed_mediapipe: 일부 FAILED → PARTIAL + errors
PASS all_failed: 모든 source FAILED → FAILED
PASS empty: 입력 없음 → SKIPPED
PASS unknown: 알 수 없는 engine → metadata.unknown_sources
PASS no_activity: SeatFacts 에 행동 판별 없음
PASS basic_fields: facts_uuid/burst_uuid/seat_id/generated_at/captured_at/period_*
PASS source_results: opencv/mediapipe/yolo analysis_uuid 모두 포함
PASS source_statuses: opencv/mediapipe/yolo SUCCESS/FAILED/SKIPPED 기록
PASS seat_mismatch: 다른 seat_id 혼입 → FAILED + errors
PASS burst_mismatch: 다른 burst_uuid 혼입 → FAILED + errors
PASS duplicate: YOLO 2개 → 최신 1개 사용 + duplicate_sources 기록
PASS unknown_only: unknown source 만 → SKIPPED
PASS intact: dummy/opencv/mediapipe/yolo 등록 유지(dummy 동작)

ALL PASS: all_success / quality / threshold / missing_yolo / failed_mediapipe /
          all_failed / empty / unknown / no_activity / basic_fields / source_results /
          source_statuses / seat_mismatch / burst_mismatch / duplicate / unknown_only / intact
```

**보완 전후 비교**: 10개 → **17개**(신규 7: basic_fields / source_results / source_statuses /
seat_mismatch / burst_mismatch / duplicate / unknown_only).

**데모** (참고): `--all`=SUCCESS(overall 0.9178), `--missing-yolo`=PARTIAL(objects={}),
`--failed-mediapipe`=PARTIAL(human_quality 0.0, errors 기록).

**회귀 확인**
- 새 모듈 import 시 `cv2`/`mediapipe`/`ultralytics` 미로드(`sys.modules` 확인 통과).
- `test_mediapipe_engine.py` / `test_yolo_engine.py` / `test_scheduler_engine.py` 기존 테스트 PASS 유지.
- `engine_registry.available_engines()` → `['dummy', 'mediapipe', 'opencv', 'yolo']`(변동 없음).

---

## 8. 남은 기술부채

1. **context 주입 의존**: `period_id/period_name/captured_at` 는 AnalysisResult 에 없어 `fuse(..., context=)` 로 넣어야 한다. Orchestrator 가 BurstPackage 메타를 자동 전달하는 연결 미구현.
2. **불일치 정책의 경직성**: seat/burst 불일치를 **무조건 FAILED** 로 본다(안전 우선). 실제로는 "대다수 일치 + 1개 오염" 을 구제하는 정책이 더 유연할 수 있음.
3. **중복 처리 단순**: 같은 engine 중복 시 "마지막 것" 만 사용. timestamp/품질 기준으로 더 나은 1개를 고르는 로직 없음.
4. **단일 좌석/단일 Burst 스냅샷**: 여러 좌석·여러 Burst 배치 fuse, 시계열 누적 없음.
5. **quality 단순화**: vision 0/1 이분, human/object 단일 quality_score 그대로. 프레임 수·검출 안정성 결합 점수 아님. usable 임계(0.3) 고정.
6. **부분 사실 표현**: 누락 섹션을 `{}` 로 둔다. "관측 안 됨" 과 "관측했으나 음성" 을 구분할 명시 플래그(observed)가 더 안전.
7. **registry 미등록**: Fusion 은 AIEngine 이 아니라 `engine_registry`/`AIManager` 경로에 없음. 파이프라인에서 직접 인스턴스화해야 함(통합 단계 오케스트레이션 미정).

---

## 9. v0.2 개선계획

1. **Orchestrator 연동**: BurstPackage(seat/period/captured_at)를 fuse context 로 자동 주입, 한 Burst 의 3엔진 결과를 모아 fuse 호출하는 파이프라인 구성.
2. **일관성 정책 옵션화**: `on_mismatch="fail"|"drop"|"warn"` 처럼 불일치 처리 방식을 선택 가능하게(오염 소스만 제외하고 PARTIAL 진행 등).
3. **중복 선택 고도화**: timestamp/quality 기준 best-of 선택, 중복을 metadata 에 상세 기록.
4. **SeatFacts 스키마 버전닝**: `schema_version` + 관측/누락 구분 플래그(`observed: true/false`)로 Rule Engine 입력 계약 안정화.
5. **다좌석 배치 fuse**: `fuse_many(list[list[AnalysisResult]])` 로 8좌석 동시 통합.
6. **quality 고도화**: 프레임 수·검출 안정성·신뢰도 분포 결합, 좌석별 임계 캘리브레이션.
7. **Rule Engine v0.1 설계 착수**: SeatFacts → 행동(공부/휴대폰 사용/수면/자리비움) 규칙 정의.
   **이때 처음으로 `activity` 가 UNKNOWN 이 아니게 된다.** 입력은 이번 단계의 SeatFacts 그대로.

> v0.1 범위 재확인: **사실 통합(SeatFacts)까지만.** 행동 판별/Rule Engine/Supabase/대시보드/학생 상태 변경은 다음 단계.
