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
