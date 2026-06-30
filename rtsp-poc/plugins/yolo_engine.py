"""
YOLOEngine (Solomon YOLO Object Engine v0.1)
============================================

AIEngine 인터페이스 구현체. YOLO Object Detection 으로 BurstPackage 프레임에서
**객체 관련 원자적 특징(Facts)만** 추출한다.

  BurstPackage → 프레임 샘플링 → 프레임 검증 → (선택)ROI crop →
  YOLO Backend → ObjectDetectionResult → AnalysisResult

매우 중요(이번 단계 범위):
  - 공부 / 휴대폰 사용 / 수면 / 자리비움 같은 **최종 행동 판별을 절대 하지 않는다.**
  - activity 는 항상 "UNKNOWN".
  - confidence 는 최종 행동 신뢰도가 아니라 **객체 검출 품질 점수**다.
  - "휴대폰 객체가 보였다" 까지만 기록한다("사용 중" 이라고 판단하지 않는다).

이 모듈은 cv2 / ultralytics 를 **import 하지 않는다**.
  - 프레임 검증/ROI crop 은 numpy 로 처리(테스트가 라이브러리 없이 통과).
  - YOLO 는 BGR ndarray 를 그대로 받으므로 색공간 변환을 하지 않는다.
  - 실제 ultralytics import 는 주입된 backend(YOLOBackend).initialize() 에서만 일어난다.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional

import numpy as np

from ai_engine import AIEngine
from analysis_result import (
    AnalysisResult,
    ACTIVITY_UNKNOWN,
    STATUS_SUCCESS,
    STATUS_SKIPPED,
    STATUS_FAILED,
)
from object_detection_result import ObjectDetectionResult
from object_label_mapper import ObjectLabelMapper, STANDARD_LABELS

if TYPE_CHECKING:
    from burst_package import BurstPackage

log = logging.getLogger("yolo_engine")

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # rtsp-poc/
_DEFAULT_CONFIG = os.path.join(_HERE, "config", "yolo.yaml")
_DEFAULT_ROI = os.path.join(_HERE, "config", "roi.yaml")

_DEFAULT_RUNTIME = {
    "sample_every_n_frames": 2,
    "max_analyzed_frames": 10,
    "apply_roi": False,
}


class YOLOEngine(AIEngine):
    name = "yolo"

    def __init__(
        self,
        config_path: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        backend: Optional[Any] = None,
        apply_roi: Optional[bool] = None,
        roi_path: Optional[str] = None,
        rois: Optional[Dict[str, dict]] = None,
        min_brightness: float = 10.0,
        **kwargs,
    ) -> None:
        self.config_path = config_path or _DEFAULT_CONFIG
        self._config: Optional[Dict[str, Any]] = dict(config) if config else None
        self._backend = backend                  # None 이면 initialize 때 real backend 생성
        self._apply_roi_override = apply_roi      # None 이면 config 의 runtime.apply_roi 사용
        self.roi_path = roi_path or _DEFAULT_ROI
        self._rois: Dict[str, dict] = dict(rois) if rois else {}
        self.min_brightness = min_brightness
        self._ready = False
        self._analyzed = 0
        self.last_result: Optional[ObjectDetectionResult] = None

    # ----------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        if self._config is None:
            self._config = self._load_config(self.config_path)
        self._runtime = {**_DEFAULT_RUNTIME, **(self._config.get("runtime", {}) or {})}
        self.apply_roi = bool(self._runtime.get("apply_roi", False)) \
            if self._apply_roi_override is None else bool(self._apply_roi_override)
        self._mapper = ObjectLabelMapper(self._config.get("target_objects"))

        if self._backend is None:
            # real backend 는 여기서만 만든다(생성 자체로 ultralytics 를 import 하지 않음).
            from yolo_backend import YOLOBackend
            self._backend = YOLOBackend(self._config)
        self._backend.initialize()

        if self.apply_roi and not self._rois:
            self._rois = self._load_rois(self.roi_path)

        self._ready = True
        log.info("YOLOEngine 초기화 - apply_roi=%s targets=%s",
                 self.apply_roi, self._mapper.standard_labels())

    @staticmethod
    def _load_config(path: str) -> Dict[str, Any]:
        if not os.path.exists(path):
            log.warning("yolo 설정 없음(%s) - 기본값 사용", path)
            return {}
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    @staticmethod
    def _load_rois(path: str) -> Dict[str, dict]:
        if not os.path.exists(path):
            log.warning("ROI 파일 없음(%s) - ROI 미적용", path)
            return {}
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return dict(raw.get("rois", raw) or {})

    def shutdown(self) -> None:
        if self._backend is not None and hasattr(self._backend, "shutdown"):
            self._backend.shutdown()
        self._ready = False

    def health(self) -> dict:
        h = {"name": self.name, "ready": self._ready, "analyzed": self._analyzed,
             "apply_roi": getattr(self, "apply_roi", False),
             "roi_seats": sorted(self._rois.keys())}
        if self._backend is not None and hasattr(self._backend, "health"):
            h["backend"] = self._backend.health()
        return h

    # ----------------------------------------------------------- frame prep
    def _select_frames(self, frames: List[Any]) -> List[Any]:
        step = max(1, int(self._runtime.get("sample_every_n_frames", 1)))
        sampled = frames[::step]
        cap = int(self._runtime.get("max_analyzed_frames", 0) or 0)
        if cap > 0 and len(sampled) > cap:
            sampled = sampled[:cap]
        return sampled

    def _prepare_frame(self, img, roi: Optional[dict]):
        """검증 + (선택)ROI crop. YOLO 는 BGR 그대로 받는다. 부적합하면 (None, reason)."""
        if img is None:
            return None, "empty"
        if not isinstance(img, np.ndarray):
            return None, "corrupt"
        if img.size == 0:
            return None, "empty"
        if img.ndim not in (2, 3):
            return None, "corrupt"
        if img.ndim == 3 and img.shape[2] not in (3, 4):
            return None, "corrupt"
        try:
            if float(img.mean()) < self.min_brightness:
                return None, "too_dark"
        except Exception:
            return None, "corrupt"

        if roi:
            img = _crop_roi(img, roi)
            if img.size == 0:
                return None, "corrupt"
        return img, "ok"

    # ----------------------------------------------------------- analyze
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        started = datetime.now()
        seat = getattr(burst, "seat_id", "")
        roi = self._rois.get(seat) if (self.apply_roi and self._rois) else None
        frames = getattr(burst, "frames", []) or []

        selected = self._select_frames(frames)
        detected_objects: List[Dict[str, Any]] = []
        per_frame_persons: List[int] = []
        discard_reasons: Dict[str, int] = {}
        errors: List[str] = []
        valid_frames = 0
        backend_failed = False

        for idx, f in enumerate(selected):
            img = getattr(f, "frame", f)            # FrameItem 이면 .frame, 아니면 그대로
            prepared, reason = self._prepare_frame(img, roi)
            if prepared is None:
                discard_reasons[reason] = discard_reasons.get(reason, 0) + 1
                continue
            try:
                raw = self._backend.analyze_frame(prepared)
            except Exception as exc:                # backend 내부 예외 → FAILED
                backend_failed = True
                errors.append(f"{type(exc).__name__}: {exc}")
                log.exception("YOLO backend 분석 예외")
                break

            valid_frames += 1
            h, w = prepared.shape[:2]
            persons = 0
            for d in raw:
                label = self._mapper.normalize(d.get("source_label", ""))
                if label == "person":
                    persons += 1
                detected_objects.append(_build_object(idx, label, d, w, h))
            per_frame_persons.append(persons)

        odr = self._aggregate(burst, len(frames), len(selected), valid_frames,
                              detected_objects, per_frame_persons)
        self.last_result = odr
        self._analyzed += 1
        finished = datetime.now()

        if backend_failed:
            status = STATUS_FAILED
        elif valid_frames > 0:
            status = STATUS_SUCCESS
        else:
            status = STATUS_SKIPPED

        return AnalysisResult(
            analysis_uuid=uuid.uuid4().hex,
            burst_uuid=getattr(burst, "burst_uuid", ""),
            seat_id=seat,
            started_at=started,
            finished_at=finished,
            processing_time=(finished - started).total_seconds() * 1000.0,
            confidence=odr.quality_score,            # 행동 신뢰도 아님 = 검출 품질
            status=status,
            activity=ACTIVITY_UNKNOWN,               # YOLO 는 판단자가 아니다
            scores={
                "quality_score": odr.quality_score,
                "phone_score": odr.metadata["label_scores"]["phone"],
                "book_score": odr.metadata["label_scores"]["book"],
                "laptop_score": odr.metadata["label_scores"]["laptop"],
                "tablet_score": odr.metadata["label_scores"]["tablet"],
                "person_score": odr.metadata["label_scores"]["person"],
            },
            metadata={
                "engine": self.name,
                "object_detection_result": odr.summary(),
                "detected_objects_count": len(detected_objects),
                "object_counts": dict(odr.object_counts),
                "max_person_count": odr.max_person_count,
                "analyzed_frames": odr.analyzed_frames,
                "skipped_frames": sum(discard_reasons.values()),
                "discard_reasons": discard_reasons,
                "model_loaded": self._backend.health().get("model_loaded", False)
                if hasattr(self._backend, "health") else False,
                "errors": errors,
            },
        )

    # ----------------------------------------------------------- aggregate
    def _aggregate(self, burst, frame_count: int, analyzed_frames: int,
                   valid_frames: int, detected_objects: List[Dict[str, Any]],
                   per_frame_persons: List[int]) -> ObjectDetectionResult:
        # 표준 라벨별 총 인스턴스 수 / 등장 프레임 집합 / 최대 신뢰도
        counts: Dict[str, int] = {}
        frames_with: Dict[str, set] = {}
        label_scores: Dict[str, float] = {k: 0.0 for k in STANDARD_LABELS}
        confs: List[float] = []

        for o in detected_objects:
            lbl = o["label"]
            conf = float(o["confidence"])
            counts[lbl] = counts.get(lbl, 0) + 1
            frames_with.setdefault(lbl, set()).add(o["frame_index"])
            confs.append(conf)
            if lbl in label_scores:
                label_scores[lbl] = max(label_scores[lbl], round(conf, 4))

        def fcount(lbl: str) -> int:
            return len(frames_with.get(lbl, ()))

        avg_conf = round(sum(confs) / len(confs), 4) if confs else 0.0
        max_conf = round(max(confs), 4) if confs else 0.0
        max_persons = max(per_frame_persons, default=0)

        return ObjectDetectionResult(
            object_uuid=uuid.uuid4().hex,
            frame_count=frame_count,
            analyzed_frames=analyzed_frames,
            valid_frames=valid_frames,
            detected_objects=detected_objects,
            object_counts=counts,
            max_person_count=max_persons,
            phone_detected=fcount("phone") > 0,
            phone_detection_count=fcount("phone"),
            book_detected=fcount("book") > 0,
            book_detection_count=fcount("book"),
            laptop_detected=fcount("laptop") > 0,
            laptop_detection_count=fcount("laptop"),
            tablet_detected=fcount("tablet") > 0,
            tablet_detection_count=fcount("tablet"),
            person_detected=fcount("person") > 0,
            person_detection_count=fcount("person"),
            avg_detection_confidence=avg_conf,
            max_detection_confidence=max_conf,
            quality_score=avg_conf,                   # 검출 품질 = 평균 신뢰도
            metadata={
                "seat_id": getattr(burst, "seat_id", ""),
                "roi_applied": bool(self.apply_roi and self._rois.get(
                    getattr(burst, "seat_id", ""))),
                "label_scores": label_scores,
            },
        )


# ---------------------------------------------------------------- helpers
def _build_object(frame_index: int, label: str, raw: Dict[str, Any],
                  w: int, h: int) -> Dict[str, Any]:
    """raw 검출 → 표준 detected_objects 항목(원본 + 정규화 bbox)."""
    xyxy = list(raw.get("bbox_xyxy", [0, 0, 0, 0]))
    norm = [0.0, 0.0, 0.0, 0.0]
    if w > 0 and h > 0 and len(xyxy) == 4:
        norm = [round(xyxy[0] / w, 4), round(xyxy[1] / h, 4),
                round(xyxy[2] / w, 4), round(xyxy[3] / h, 4)]
    return {
        "frame_index": frame_index,
        "label": label,                              # 정규화된 표준 라벨
        "source_label": raw.get("source_label", ""),
        "confidence": round(float(raw.get("confidence", 0.0)), 4),
        "bbox_xyxy": xyxy,
        "bbox_normalized": norm,
        "class_id": raw.get("class_id"),
    }


def _crop_roi(img: "np.ndarray", roi: dict) -> "np.ndarray":
    """ROI(x,y,w,h) numpy crop. 경계 클램프. 유효하지 않으면 원본 반환."""
    if not roi:
        return img
    h, w = img.shape[:2]
    x = max(0, int(roi.get("x", 0)))
    y = max(0, int(roi.get("y", 0)))
    x2 = min(w, x + int(roi.get("w", w)))
    y2 = min(h, y + int(roi.get("h", h)))
    if x2 <= x or y2 <= y:
        return img
    return img[y:y2, x:x2]
