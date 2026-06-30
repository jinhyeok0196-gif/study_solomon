# Solomon YOLO Object Engine v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: YOLO Object Detection 으로 BurstPackage 프레임에서 휴대폰/책/노트북/태블릿/사람 같은
> **객체 원자적 특징(Facts)** 만 추출한다. **행동 판별은 절대 하지 않는다** — `activity` 는 항상 `UNKNOWN`,
> `confidence` 는 행동 신뢰도가 아니라 **객체 검출 품질 점수(평균 신뢰도)**.
> `ultralytics`/모델 파일 없이 **Fake Backend** 로 전체 테스트 통과.

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── config/
│   ├── roi.yaml                     # (기존) 좌석별 ROI
│   ├── mediapipe.yaml               # (기존) MediaPipe 설정
│   └── yolo.yaml                    # ★신규 YOLO 모델/런타임/target_objects 라벨 매핑
├── models/                          # (gitignore) 실제 모델(.task/.pt) 배치 위치 — 레포 미포함
├── plugins/
│   ├── __init__.py
│   ├── dummy_engine.py              # (기존) DummyAIEngine
│   ├── opencv_engine.py             # (기존) OpenCVEngine
│   ├── mediapipe_engine.py          # (기존) MediaPipeEngine
│   └── yolo_engine.py               # ★신규 YOLOEngine (AIEngine 구현, cv2/ultralytics 비의존)
│
├── ai_engine.py / ai_manager.py / analysis_result.py / burst_package.py     # (기존) AI 코어
├── engine_registry.py               # ✎수정 "yolo" lazy 등록 추가
│
├── vision_result.py / vision_utils.py                                       # (기존) OpenCV
├── mediapipe_result.py / mediapipe_backend.py / mediapipe_demo.py           # (기존) MediaPipe
│
├── object_detection_result.py       # ★신규 ObjectDetectionResult (객체 Facts 묶음, 순수 데이터)
├── object_label_mapper.py           # ★신규 ObjectLabelMapper (원본→표준 라벨 정규화)
├── yolo_backend.py                  # ★신규 YOLOBackend(실제 Ultralytics) + FakeYOLOBackend(테스트)
├── yolo_demo.py                     # ★신규 CLI 데모 (--fake / --dummy-frames / --real)
│
├── camera_*.py / ring_buffer.py / scheduler_*.py / orchestrator_*.py / trigger_queue.py  # (기존)
├── manage.py / main.py / *_demo.py                                          # (기존) 실행/데모
│
├── test_camera_*.py / test_scheduler_engine.py / test_orchestrator_engine.py
├── test_ai_engine.py / test_vision_engine.py / test_mediapipe_engine.py
├── test_yolo_engine.py              # ★신규 YOLO 엔진 테스트 (모델 파일 없이)
│
├── cameras.yaml / schedule.yaml
├── .gitignore                       # ✎수정 *.pt 추가
└── README.md                        # ✎수정 YOLO Object Engine v0.1 절 추가
```

★ = 신규, ✎ = 수정.

---

## 2. 신규 파일 전체 코드

### 2-1. `object_detection_result.py`

```python
"""
ObjectDetectionResult
=====================

YOLO Object Engine 이 BurstPackage 에서 추출한 **객체 관련 원자적 특징(Facts)** 묶음.

여기에는 "어떤 객체가 어디에 보였는가" 까지만 담는다.
"휴대폰을 사용 중이다 / 공부 중이다" 같은 **최종 행동 판별은 절대 하지 않는다**(Rule Engine 의 일).

이 모듈은 OpenCV / YOLO 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class ObjectDetectionResult:
    object_uuid: str

    # ----- 프레임 카운트 -----
    frame_count: int                 # BurstPackage 입력 프레임 수
    analyzed_frames: int             # 샘플링/상한 적용 후 분석 대상 프레임 수
    valid_frames: int                # 검증 통과(=YOLO 에 들어간) 프레임 수

    # ----- 검출된 객체 원본 목록(프레임별) -----
    detected_objects: List[Dict[str, Any]] = field(default_factory=list)
    # 표준 라벨 → 총 검출 인스턴스 수
    object_counts: Dict[str, int] = field(default_factory=dict)
    max_person_count: int = 0        # 한 프레임에서 동시에 잡힌 사람 최대 수

    # ----- 표준 객체별 검출 여부 / 검출 프레임 수 -----
    phone_detected: bool = False
    phone_detection_count: int = 0
    book_detected: bool = False
    book_detection_count: int = 0
    laptop_detected: bool = False
    laptop_detection_count: int = 0
    tablet_detected: bool = False
    tablet_detection_count: int = 0
    person_detected: bool = False
    person_detection_count: int = 0

    # ----- 신뢰도 통계 -----
    avg_detection_confidence: float = 0.0
    max_detection_confidence: float = 0.0

    # 객체 검출 "품질" 점수(0~1). 최종 행동 신뢰도가 아님.
    quality_score: float = 0.0

    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        """로그/메타데이터 임베드용 축약 dict (detected_objects 원본 목록은 제외)."""
        return {
            "object_uuid": self.object_uuid,
            "frame_count": self.frame_count,
            "analyzed_frames": self.analyzed_frames,
            "valid_frames": self.valid_frames,
            "object_counts": dict(self.object_counts),
            "max_person_count": self.max_person_count,
            "phone_detected": self.phone_detected,
            "phone_detection_count": self.phone_detection_count,
            "book_detected": self.book_detected,
            "book_detection_count": self.book_detection_count,
            "laptop_detected": self.laptop_detected,
            "laptop_detection_count": self.laptop_detection_count,
            "tablet_detected": self.tablet_detected,
            "tablet_detection_count": self.tablet_detection_count,
            "person_detected": self.person_detected,
            "person_detection_count": self.person_detection_count,
            "avg_detection_confidence": self.avg_detection_confidence,
            "max_detection_confidence": self.max_detection_confidence,
            "quality_score": self.quality_score,
        }
```

### 2-2. `object_label_mapper.py`

```python
"""
ObjectLabelMapper
=================

YOLO 원본 라벨(예: COCO 의 "cell phone")을 **Solomon 표준 라벨**로 정규화한다.

표준 라벨:
  phone / book / laptop / tablet / person / unknown_object

매핑 규칙은 config/yolo.yaml 의 `target_objects` 를 우선 사용하고, 없으면 기본값을 쓴다.
이 모듈은 라벨 문자열 변환만 한다(행동 판별 없음). OpenCV/YOLO 비의존.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

UNKNOWN_OBJECT = "unknown_object"

# 표준 라벨(순서 고정 — scores/카운트 순회용)
STANDARD_LABELS: List[str] = ["phone", "book", "laptop", "tablet", "person"]

# config 가 없을 때 쓰는 기본 매핑(표준 → 원본 라벨 후보들)
DEFAULT_TARGET_OBJECTS: Dict[str, Dict[str, Any]] = {
    "phone":  {"labels": ["cell phone", "phone", "mobile phone", "cellphone"]},
    "book":   {"labels": ["book"]},
    "laptop": {"labels": ["laptop"]},
    "tablet": {"labels": ["tablet", "ipad"]},
    "person": {"labels": ["person"]},
}


def _norm(s: str) -> str:
    return str(s).strip().lower()


class ObjectLabelMapper:
    def __init__(self, target_objects: Optional[Dict[str, Dict[str, Any]]] = None) -> None:
        spec = target_objects or DEFAULT_TARGET_OBJECTS
        # 원본 라벨(소문자) → 표준 라벨
        self._map: Dict[str, str] = {}
        self._standards: List[str] = []
        for std, body in spec.items():
            std_l = _norm(std)
            self._standards.append(std_l)
            for raw in (body or {}).get("labels", []) or []:
                self._map[_norm(raw)] = std_l
            # 표준 라벨 자체도 자기 자신으로 매핑
            self._map.setdefault(std_l, std_l)

    def normalize(self, source_label: str) -> str:
        """YOLO 원본 라벨 → 표준 라벨. 매칭 안 되면 'unknown_object'."""
        return self._map.get(_norm(source_label), UNKNOWN_OBJECT)

    def standard_labels(self) -> List[str]:
        """설정에 등장한 표준 라벨 목록(순서 유지)."""
        return list(self._standards)

    def known_source_labels(self) -> List[str]:
        return sorted(self._map.keys())
```

### 2-3. `yolo_backend.py`

```python
"""
YOLO Backend
============

YOLO 호출부를 엔진(YOLOEngine)에서 분리한다.
이렇게 하면:
  - 실제 모델 파일 / ultralytics 라이브러리 없이도 엔진 로직을 테스트할 수 있고,
  - 나중에 다른 backend(원격 추론 서버 등)로 교체하기 쉽다.

공통 계약
---------
    class <Backend>:
        initialize()                  # 모델 로드(1회)
        analyze_frame(frame)->list    # 1프레임의 raw 검출 목록
        shutdown()
        health()->dict

analyze_frame() 이 돌려주는 per-frame raw 검출 스키마(라벨 정규화 전):

    [
      {"source_label": "cell phone", "confidence": 0.87,
       "bbox_xyxy": [x1, y1, x2, y2], "class_id": 67},
      ...
    ]

표준 라벨 정규화/정규화 좌표 계산은 **엔진**이 한다(backend 는 원본만 돌려줌).

주의: 이 모듈은 ultralytics 를 **lazy import** 한다(초기화 시점에만).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

log = logging.getLogger("yolo_backend")


class YOLOBackend:
    """Ultralytics YOLO 기반 실제 backend.

    config["model"] 예시:
      {path, device, image_size, confidence_threshold, iou_threshold}
    모델 파일이 없으면 initialize() 에서 명확히 실패한다(FileNotFoundError).
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        self.config: Dict[str, Any] = dict(config or {})
        self.model_cfg: Dict[str, Any] = dict(self.config.get("model", {}))
        self._model = None
        self._names: Dict[int, str] = {}
        self._ready = False
        self.model_loaded = False

    # ------------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        path = self.model_cfg.get("path")
        if not path or not os.path.exists(path):
            # 실제 backend 인데 모델이 없으면 명확히 알린다(엔진이 FAILED 처리 가능).
            raise FileNotFoundError(f"YOLO 모델 파일 없음: {path}")
        # ultralytics 는 무거우므로 여기서만 import 한다.
        from ultralytics import YOLO  # noqa
        self._model = YOLO(path)
        names = getattr(self._model, "names", {}) or {}
        self._names = {int(k): v for k, v in names.items()} if isinstance(names, dict) \
            else {i: n for i, n in enumerate(names)}
        self._ready = True
        self.model_loaded = True
        log.info("YOLOBackend 초기화 - model=%s classes=%d", path, len(self._names))

    # ----------------------------------------------------------- per-frame
    def analyze_frame(self, frame) -> List[Dict[str, Any]]:
        if not self._ready:
            raise RuntimeError("YOLOBackend.initialize() 가 호출되지 않았습니다")
        res = self._model.predict(
            frame,
            imgsz=int(self.model_cfg.get("image_size", 640)),
            conf=float(self.model_cfg.get("confidence_threshold", 0.35)),
            iou=float(self.model_cfg.get("iou_threshold", 0.45)),
            device=self.model_cfg.get("device", "cpu"),
            verbose=False,
        )
        dets: List[Dict[str, Any]] = []
        if not res:
            return dets
        r0 = res[0]
        names = getattr(r0, "names", None) or self._names
        boxes = getattr(r0, "boxes", None)
        if boxes is None:
            return dets
        for box in boxes:
            cls = int(box.cls[0])
            conf = float(box.conf[0])
            xyxy = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            label = names.get(cls, str(cls)) if isinstance(names, dict) else str(cls)
            dets.append({"source_label": label, "confidence": round(conf, 4),
                         "bbox_xyxy": xyxy, "class_id": cls})
        return dets

    def shutdown(self) -> None:
        self._model = None
        self._ready = False

    def health(self) -> dict:
        return {"backend": "yolo", "ready": self._ready,
                "model_loaded": self.model_loaded, "classes": len(self._names)}


class FakeYOLOBackend:
    """테스트/데모용 가짜 backend. ultralytics 와 모델 파일이 전혀 필요 없다.

    프레임 내용과 무관하게 **설정대로** 결정적(deterministic) 검출 목록을 돌려준다.
    detections 를 주면 그걸 쓰고, 없으면 기본(phone/book/laptop/tablet/person×2).
    fail=True 면 analyze_frame 에서 예외를 던진다(엔진 FAILED 검증용).
    """

    DEFAULT_DETECTIONS: List[Dict[str, Any]] = [
        {"source_label": "cell phone", "confidence": 0.87, "bbox_xyxy": [10, 10, 80, 160], "class_id": 67},
        {"source_label": "book",       "confidence": 0.74, "bbox_xyxy": [100, 120, 200, 230], "class_id": 73},
        {"source_label": "laptop",     "confidence": 0.66, "bbox_xyxy": [40, 30, 300, 220], "class_id": 63},
        {"source_label": "tablet",     "confidence": 0.55, "bbox_xyxy": [120, 20, 260, 180], "class_id": 200},
        {"source_label": "person",     "confidence": 0.90, "bbox_xyxy": [0, 0, 160, 240], "class_id": 0},
        {"source_label": "person",     "confidence": 0.80, "bbox_xyxy": [160, 0, 320, 240], "class_id": 0},
    ]

    def __init__(self, config: Optional[Dict[str, Any]] = None,
                 detections: Optional[List[Dict[str, Any]]] = None,
                 fail: bool = False) -> None:
        self.config = dict(config or {})
        self._dets = list(detections) if detections is not None \
            else list(self.DEFAULT_DETECTIONS)
        self._fail = fail
        self._ready = False

    def initialize(self) -> None:
        self._ready = True

    def analyze_frame(self, frame) -> List[Dict[str, Any]]:
        if self._fail:
            raise RuntimeError("FakeYOLOBackend: 강제 예외(fail=True)")
        # 새 dict 로 복사해 호출자가 수정해도 원본이 안 망가지게 한다.
        return [dict(d) for d in self._dets]

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"backend": "fake", "ready": self._ready, "model_loaded": True,
                "classes": len({d["source_label"] for d in self._dets})}
```

### 2-4. `plugins/yolo_engine.py`

```python
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
```

### 2-5. `config/yolo.yaml`

```yaml
# =========================================================================
# YOLO Object Engine v0.1 설정
# =========================================================================
# YOLO Object Detection 으로 "객체 관련 원자적 특징(Facts)" 만 추출한다.
# 공부/휴대폰 사용/수면/자리비움 같은 최종 행동 판별은 절대 하지 않는다(Rule Engine 의 일).
#
# 주의:
#   - 모델 파일(.pt)은 레포에 포함하지 않는다. models/ 는 .gitignore 처리.
#   - 모델 파일이 없으면 실제 backend 는 initialize() 에서 명확히 실패한다.
#   - 모델 파일 배치 방법은 README 의 "YOLO 모델 파일" 절 참고.
# =========================================================================

model:
  path: "models/yolo_object.pt"   # 레포 미포함 — 직접 내려받아 배치(예: yolov8n.pt)
  device: "cpu"                   # cpu | cuda:0 ...
  image_size: 640
  confidence_threshold: 0.35
  iou_threshold: 0.45

runtime:
  sample_every_n_frames: 2        # N프레임마다 1장만 분석
  max_analyzed_frames: 10         # Burst 당 분석 프레임 상한
  apply_roi: false                # 이번 단계 기본 비활성(선택 적용)

# YOLO 원본 라벨 → Solomon 표준 라벨 매핑(ObjectLabelMapper 가 사용)
target_objects:
  phone:
    labels: ["cell phone", "phone", "mobile phone"]
  book:
    labels: ["book"]
  laptop:
    labels: ["laptop"]
  tablet:
    labels: ["tablet", "ipad"]
  person:
    labels: ["person"]
```

### 2-6. `yolo_demo.py`

```python
"""
Solomon YOLO Object Engine v0.1 - CLI 데모
==========================================

BurstPackage 프레임에서 휴대폰/책/노트북/태블릿/사람 같은 **객체 Facts** 만 추출해 출력한다.
**행동 판별(공부/휴대폰 사용/수면/자리비움)은 절대 하지 않는다** — activity 는 항상 UNKNOWN.

실행 예시:
  python yolo_demo.py --fake               # Fake backend(모델 파일 불필요)
  python yolo_demo.py --dummy-frames 5     # 합성 프레임 5장, Fake backend
  python yolo_demo.py --real --seat 1      # 실제 CameraManager + 실제 모델 파일 필요
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

import numpy as np

from burst_package import BurstPackage
from plugins.yolo_engine import YOLOEngine
from yolo_backend import FakeYOLOBackend


def parse_args():
    p = argparse.ArgumentParser(description="Solomon YOLO Object Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--fake", action="store_true",
                      help="Fake backend 사용(기본, 모델 파일 불필요)")
    mode.add_argument("--real", action="store_true",
                      help="실제 YOLO backend + CameraManager")
    p.add_argument("--dummy-frames", type=int, default=6,
                   help="합성 프레임 수(Fake 모드)")
    p.add_argument("--seat", type=int, default=1, help="--real 대상 좌석 번호")
    return p.parse_args()


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


class _Item:
    def __init__(self, img, ts):
        self.frame = img
        self.timestamp = ts
        self.frame_index = 0


def build_dummy_burst(n: int) -> BurstPackage:
    rng = np.random.RandomState(0)
    items = []
    for i in range(n):
        img = rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)
        items.append(_Item(img, float(i)))
    return BurstPackage(
        burst_uuid="demo", trigger_uuid="demo", trigger_id="demo_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id="Seat1", captured_at=datetime.now(),
        frame_count=len(items), frames=items, metadata={},
    )


def build_real(seat_no: int):
    from camera_manager import CameraManager
    from camera_config import load_camera_configs
    from dotenv import load_dotenv
    import os, time
    load_dotenv()
    here = os.path.dirname(os.path.abspath(__file__))
    cm = CameraManager(load_camera_configs(os.path.join(here, "cameras.yaml")),
                       status_interval=5.0)
    seat = f"Seat{seat_no}"
    cm.start_camera(seat)
    time.sleep(3.0)
    frames = cm.get_recent_frames(seat, seconds=3)
    pkg = BurstPackage(
        burst_uuid="real", trigger_uuid="real", trigger_id="real_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )
    return cm, pkg


def main() -> int:
    args = parse_args()
    setup_logging()

    cm = None
    if args.real:
        eng = YOLOEngine()                   # real backend (모델 파일 필요)
        cm, pkg = build_real(args.seat)
    else:
        # Fake backend 주입 → ultralytics / 모델 파일 없이 동작
        eng = YOLOEngine(backend=FakeYOLOBackend())
        pkg = build_dummy_burst(args.dummy_frames)

    eng.initialize()
    res = eng.analyze(pkg)
    odr = eng.last_result

    print("===== ObjectDetectionResult (객체 Facts만) =====")
    print(f"  seat={pkg.seat_id} frame_count={odr.frame_count} "
          f"analyzed_frames={odr.analyzed_frames} valid_frames={odr.valid_frames}")
    print(f"  phone_detected={odr.phone_detected} ({odr.phone_detection_count}) "
          f"book_detected={odr.book_detected} ({odr.book_detection_count}) "
          f"laptop_detected={odr.laptop_detected} ({odr.laptop_detection_count})")
    print(f"  tablet_detected={odr.tablet_detected} ({odr.tablet_detection_count}) "
          f"person_detected={odr.person_detected} ({odr.person_detection_count}) "
          f"max_person_count={odr.max_person_count}")
    print(f"  detected_objects_count={len(odr.detected_objects)} "
          f"object_counts={odr.object_counts}")
    print(f"  avg_conf={odr.avg_detection_confidence} max_conf={odr.max_detection_confidence} "
          f"quality_score={odr.quality_score}")
    if odr.detected_objects:
        print(f"  sample object={odr.detected_objects[0]}")
    print("===== AnalysisResult =====")
    print(f"  status={res.status} activity={res.activity} "
          f"confidence(=검출품질)={res.confidence} proc={res.processing_time:.2f}ms")
    print(f"  scores={res.scores}")
    print(f"  model_loaded={res.metadata['model_loaded']}")

    eng.shutdown()
    if cm is not None and hasattr(cm, "stop_all"):
        cm.stop_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 2-7. `test_yolo_engine.py`

```python
"""
YOLO Object Engine v0.1 테스트.

**실제 YOLO 모델 파일 / ultralytics 라이브러리 없이** Fake Backend 로 통과한다.

검증:
  - YOLOEngine 초기화(Fake backend 주입)
  - Fake BurstPackage 분석 → ObjectDetectionResult / AnalysisResult 생성
  - activity 가 항상 UNKNOWN
  - phone/book/laptop/tablet/person detected 가 metadata 에 반영
  - empty/dark/corrupt 프레임만 있으면 SKIPPED
  - backend 예외 발생 시 FAILED
  - 샘플링/상한(sample_every_n_frames / max_analyzed_frames)
  - object_label_mapper 라벨 정규화
  - bbox 원본/정규화 좌표 보관
  - engine_registry 에서 yolo 생성 가능(ultralytics import 없이)
  - 기존 dummy / opencv / mediapipe 엔진 등록이 깨지지 않음
"""
from datetime import datetime

import numpy as np

from analysis_result import (
    ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_SKIPPED, STATUS_FAILED,
)
from object_detection_result import ObjectDetectionResult
from object_label_mapper import ObjectLabelMapper, UNKNOWN_OBJECT
from burst_package import BurstPackage
from yolo_backend import FakeYOLOBackend
from plugins.yolo_engine import YOLOEngine


# ---- 합성 프레임 / 도우미 -------------------------------------------------
def normal_frame(seed=0):
    rng = np.random.RandomState(seed)
    return rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)

def dark_frame():
    return np.full((240, 320, 3), 2, dtype=np.uint8)

def corrupt_frame():
    return np.zeros((240,), dtype=np.uint8)        # 1D → corrupt


def fake_item(img, ts=0.0):
    class _It:
        pass
    it = _It(); it.frame = img; it.timestamp = ts; it.frame_index = 0
    return it


def burst(frames, seat="Seat1"):
    return BurstPackage(
        burst_uuid="b1", trigger_uuid="t1", trigger_id="2026-06-30_P0_x",
        trigger_type="mid_study_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime(2026, 6, 30, 9, 5),
        frame_count=len(frames), frames=frames, metadata={},
    )


def make_engine(backend=None, **kw):
    eng = YOLOEngine(backend=backend or FakeYOLOBackend(),
                     config={"runtime": {"sample_every_n_frames": 1,
                                         "max_analyzed_frames": 100}}, **kw)
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_init_and_analyze():
    eng = make_engine()
    assert eng.health()["ready"] is True
    res = eng.analyze(burst([fake_item(normal_frame(1)), fake_item(normal_frame(2))]))

    assert isinstance(eng.last_result, ObjectDetectionResult)
    assert res.status == STATUS_SUCCESS
    assert res.activity == ACTIVITY_UNKNOWN, "YOLO 는 행동 판별 안 함"
    odr = eng.last_result
    assert odr.valid_frames == 2 and odr.analyzed_frames == 2
    assert odr.phone_detected and odr.book_detected and odr.laptop_detected
    assert odr.tablet_detected and odr.person_detected
    # 2프레임 × 6객체 = 12 검출 인스턴스, 프레임당 사람 2명
    assert len(odr.detected_objects) == 12
    assert odr.max_person_count == 2
    assert odr.phone_detection_count == 2          # 2프레임 모두 등장
    assert odr.object_counts["person"] == 4        # 2프레임 × 2명
    print("PASS init/analyze: ObjectDetectionResult/AnalysisResult, activity=UNKNOWN")


def test_metadata_has_detections():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(normal_frame(3))]))
    summ = res.metadata["object_detection_result"]
    assert summ["phone_detected"] and summ["book_detected"] and summ["laptop_detected"]
    assert summ["tablet_detected"] and summ["person_detected"]
    assert res.metadata["engine"] == "yolo"
    assert res.metadata["max_person_count"] == 2
    assert res.metadata["detected_objects_count"] == 6
    assert set(res.scores) == {"quality_score", "phone_score", "book_score",
                               "laptop_score", "tablet_score", "person_score"}
    # confidence 는 검출 품질 점수(= quality_score = 평균 신뢰도)
    assert res.confidence == res.scores["quality_score"]
    assert res.scores["phone_score"] == 0.87       # Fake phone conf
    print("PASS metadata: phone/book/laptop/tablet/person detected 가 metadata 에 반영")


def test_bbox_coords():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(normal_frame(4))]))
    o = eng.last_result.detected_objects[0]
    assert o["label"] == "phone" and o["source_label"] == "cell phone"
    assert o["bbox_xyxy"] == [10, 10, 80, 160]
    # 320x240 정규화
    assert o["bbox_normalized"][0] == round(10 / 320, 4)
    assert o["bbox_normalized"][3] == round(160 / 240, 4)
    assert o["class_id"] == 67
    print("PASS bbox: 원본/정규화 좌표 + 정규화 라벨 보관")


def test_empty_frames_skipped():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(None), fake_item(dark_frame()),
                             fake_item(corrupt_frame())]))
    assert res.status == STATUS_SKIPPED
    assert eng.last_result.valid_frames == 0
    assert res.metadata["skipped_frames"] == 3
    reasons = res.metadata["discard_reasons"]
    assert reasons.get("empty") and reasons.get("too_dark") and reasons.get("corrupt")
    print("PASS skipped: 분석 가능한 프레임 없음 → SKIPPED")


def test_backend_failure_failed():
    eng = make_engine(backend=FakeYOLOBackend(fail=True))
    res = eng.analyze(burst([fake_item(normal_frame(5))]))
    assert res.status == STATUS_FAILED
    assert res.activity == ACTIVITY_UNKNOWN
    assert res.metadata["errors"], "예외 메시지가 errors 에 기록돼야 함"
    print("PASS failed: backend 예외 → FAILED")


def test_sampling_and_cap():
    eng = YOLOEngine(backend=FakeYOLOBackend(),
                     config={"runtime": {"sample_every_n_frames": 2,
                                         "max_analyzed_frames": 3}})
    eng.initialize()
    frames = [fake_item(normal_frame(i)) for i in range(10)]
    res = eng.analyze(burst(frames))
    odr = eng.last_result
    assert odr.frame_count == 10
    # 10프레임 → step2 = 5장 → cap3 = 3장 분석
    assert odr.analyzed_frames == 3 and odr.valid_frames == 3
    print("PASS sampling: sample_every_n_frames + max_analyzed_frames 적용")


def test_label_mapper():
    m = ObjectLabelMapper()
    assert m.normalize("cell phone") == "phone"
    assert m.normalize("Mobile Phone") == "phone"
    assert m.normalize("laptop") == "laptop"
    assert m.normalize("book") == "book"
    assert m.normalize("person") == "person"
    assert m.normalize("ipad") == "tablet"
    assert m.normalize("traffic light") == UNKNOWN_OBJECT
    # config target_objects 우선
    m2 = ObjectLabelMapper({"phone": {"labels": ["smartphone"]}})
    assert m2.normalize("smartphone") == "phone"
    assert m2.normalize("cell phone") == UNKNOWN_OBJECT  # 커스텀 맵엔 없음
    print("PASS label_mapper: 원본→표준 정규화 + config 우선")


def test_unknown_object_normalized():
    # phone 매핑이 없는 backend 검출 → unknown_object 로 정규화(표준 카운트엔 미반영)
    eng = YOLOEngine(
        backend=FakeYOLOBackend(detections=[
            {"source_label": "traffic light", "confidence": 0.5,
             "bbox_xyxy": [0, 0, 10, 10], "class_id": 9}]),
        config={"runtime": {"sample_every_n_frames": 1, "max_analyzed_frames": 100}})
    eng.initialize()
    eng.analyze(burst([fake_item(normal_frame(6))]))
    odr = eng.last_result
    assert odr.phone_detected is False and odr.person_detected is False
    assert odr.object_counts.get("unknown_object") == 1
    assert odr.detected_objects[0]["label"] == "unknown_object"
    print("PASS unknown: 미매핑 라벨 → unknown_object")


def test_registry_creates_yolo():
    import engine_registry as reg
    assert "yolo" in reg.available_engines()
    eng = reg.create_engine("yolo", backend=FakeYOLOBackend())
    eng.initialize()
    assert eng.name == "yolo"
    res = eng.analyze(burst([fake_item(normal_frame(8))]))
    assert res.activity == ACTIVITY_UNKNOWN
    print("PASS registry: create_engine('yolo') 동작")


def test_existing_engines_intact():
    import engine_registry as reg
    for name in ("dummy", "opencv", "mediapipe", "yolo"):
        assert name in reg.available_engines(), name
    d = reg.create_engine("dummy")
    d.initialize()
    res = d.analyze(burst([fake_item(normal_frame(9))]))
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    print("PASS intact: dummy/opencv/mediapipe/yolo 등록 유지(dummy 동작)")


def main():
    test_init_and_analyze()
    test_metadata_has_detections()
    test_bbox_coords()
    test_empty_frames_skipped()
    test_backend_failure_failed()
    test_sampling_and_cap()
    test_label_mapper()
    test_unknown_object_normalized()
    test_registry_creates_yolo()
    test_existing_engines_intact()
    print("\nALL PASS: init / metadata / bbox / skipped / failed / sampling / "
          "label_mapper / unknown / registry / intact")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드 (변경 부분)

### 3-1. `engine_registry.py` — `yolo` lazy 등록 추가

```python
register("mediapipe", _make_mediapipe)


# yolo 는 ultralytics 의존이 있으므로 lazy 등록(create 시점에만 plugin import).
# 실제 ultralytics import 는 engine.initialize() 의 real backend.initialize() 이후에만 일어난다.
def _make_yolo(**kw):
    from plugins.yolo_engine import YOLOEngine
    return YOLOEngine(**kw)


register("yolo", _make_yolo)
```
> `dummy`/`opencv`/`mediapipe` 등록은 그대로. 등록 목록: `['dummy','mediapipe','opencv','yolo']`.

### 3-2. `.gitignore` — YOLO 가중치(.pt) 추가

```gitignore
# AI 모델 파일은 레포에 포함하지 않는다(용량/라이선스). 직접 내려받아 배치.
# MediaPipe(.task), YOLO/Ultralytics(.pt) 등.
models/
*.task
*.pt
```

### 3-3. `README.md` — 추가/변경 요약

- 헤더 모듈 목록에 **YOLO Object Engine v0.1** 줄 추가, 범위 경고에 "MediaPipe·YOLO 는 추출기" 명시.
- 파일 구조 표에 `object_detection_result.py / object_label_mapper.py / yolo_backend.py /
  plugins/yolo_engine.py / config/yolo.yaml / yolo_demo.py / test_yolo_engine.py` 7행 추가.
- **"## YOLO Object Engine v0.1"** 절 신규: 파이프라인 / 객체 Facts / 라벨 매퍼 / bbox 좌표 /
  ObjectDetectionResult / Backend 구조 / 설정 / **모델 파일 배치** / 실행 / 테스트 / MediaPipe+YOLO+Rule Engine 연결.

---

## 4. YOLO Object Engine 구조도

```
                     ┌──────────────────────────────────────────────┐
                     │              BurstPackage(frames)             │
                     └───────────────────────┬──────────────────────┘
                                             │
                             YOLOEngine.analyze()
                                             │
        ┌───────────────────────────────────┼─────────────────────────────────┐
        │  1) _select_frames()  sample_every_n_frames → max_analyzed_frames    │
        │  2) _prepare_frame()  검증(empty/corrupt/too_dark) + (선택)ROI crop   │
        │                       BGR 그대로 유지(YOLO 가 BGR ndarray 수용)       │
        └───────────────────────────────────┬─────────────────────────────────┘
                                             │ frame (검증 통과분만, BGR)
                                             ▼
                         ┌─────────────────────────────────────┐
                         │   Backend.analyze_frame(frame)      │   ← 교체 가능
                         │   ┌──────────────┐  ┌──────────────┐ │
                         │   │  YOLOBackend │  │FakeYOLOBackend│ │
                         │   │(Ultralytics, │  │(테스트/데모)  │ │
                         │   │ lazy import) │  │ 결정적 검출)  │ │
                         │   └──────────────┘  └──────────────┘ │
                         └──────────────────┬──────────────────┘
                                             │ raw 검출(dict) 목록 × N
                                             ▼
            ObjectLabelMapper.normalize()  +  bbox 원본/정규화 계산
                         (cell phone→phone, ipad→tablet, ...)
                                             │
                                             ▼
                              YOLOEngine._aggregate()
                       (라벨별 카운트·등장프레임·최대신뢰도·사람수 집계)
                                             │
                                             ▼
                                ┌─────────────────────────┐
                                │  ObjectDetectionResult  │  객체 Facts 묶음
                                └───────────┬─────────────┘
                                             ▼
                                ┌─────────────────────────┐
                                │      AnalysisResult     │  activity=UNKNOWN
                                │   confidence=검출품질   │  scores/metadata
                                └─────────────────────────┘
                                             │
                                             ▼
                  (향후) MediaPipe Facts + YOLO Facts → Rule Engine → 최종 행동
```

**핵심 설계 원칙**
- **추출기 ↔ 판단자 분리**: YOLO 는 "객체가 보였다" 까지만, 판단은 Rule Engine.
- **Backend 분리**: 실제/Fake 교체로 모델 파일·라이브러리 없이 로직 검증.
- **lazy import**: `ultralytics` 는 real backend `initialize()` 에서만 import.
- **cv2/ultralytics 비의존 엔진**: numpy 만 사용(검증·ROI crop), YOLO 는 BGR 그대로 수용.
- **MediaPipe 와 동일 패턴**: Result/Backend/Engine/Demo/Test 5종 + config 1종(일관성).

---

## 5. ObjectDetectionResult 설명

| 필드 | 의미 |
|------|------|
| `object_uuid` | 결과 고유 id |
| `frame_count` | BurstPackage 입력 프레임 수 |
| `analyzed_frames` | 샘플링/상한 적용 후 분석 대상 프레임 수 |
| `valid_frames` | 검증 통과(=backend 에 들어간) 프레임 수 |
| `detected_objects` | 프레임별 검출 객체 목록(아래 항목 구조) |
| `object_counts` | 표준 라벨 → 총 검출 **인스턴스** 수(예: `{"phone":3,"person":6}`) |
| `max_person_count` | 한 프레임에서 동시에 잡힌 **사람 최대 수**(좌석 인원 추정 재료) |
| `{phone,book,laptop,tablet,person}_detected` | 객체별 1회 이상 검출 여부 |
| `{...}_detection_count` | 그 객체가 등장한 **프레임 수**(인스턴스 수 아님) |
| `avg_detection_confidence` / `max_detection_confidence` | 전체 검출 신뢰도 평균 / 최대 |
| `quality_score` | **검출 품질 = 평균 신뢰도(0~1)** — 행동 신뢰도가 아님 |
| `metadata` | `seat_id` / `roi_applied` / `label_scores`(라벨별 최대 신뢰도) |

**`detected_objects` 항목 구조**
```python
{
  "frame_index": 0,                    # 분석 프레임 인덱스
  "label": "phone",                    # 정규화된 표준 라벨
  "source_label": "cell phone",        # YOLO 원본 라벨
  "confidence": 0.87,
  "bbox_xyxy": [10, 10, 80, 160],      # 원본(분석 프레임) 픽셀 좌표
  "bbox_normalized": [0.0312, 0.0417, 0.25, 0.6667],  # 0~1 정규화
  "class_id": 67
}
```

> **해석 금지 원칙**: "휴대폰 사용 중" 이 아니라 "휴대폰 객체가 보였다" 까지만.
> `max_person_count` 도 "자리비움/대리출석" 같은 판단을 하지 않는다(수치만 제공).

---

## 6. Backend 구조 설명

```
Backend 공통 계약:  initialize() / analyze_frame(frame)->list / shutdown() / health()
```

| 항목 | `YOLOBackend` (실제) | `FakeYOLOBackend` (테스트/데모) |
|------|----------------------|---------------------------------|
| 의존성 | `ultralytics`(lazy) + `.pt` 모델 파일 | **없음** (numpy 입력만) |
| 모델 로드 | `initialize()` 에서 `YOLO(path)` 생성 | 플래그만 세팅 |
| 모델 없음 | `initialize()` 에서 `FileNotFoundError`(명확 실패) | 해당 없음 |
| analyze_frame | 실제 추론 → raw 검출 목록 | **설정대로 결정적** 검출 목록 |
| 예외 시뮬 | — | `fail=True` 면 예외 → 엔진 FAILED 검증 |

**per-frame raw 검출 스키마(공통, 정규화 전)**
```python
[{"source_label": "cell phone", "confidence": 0.87, "bbox_xyxy": [x1,y1,x2,y2], "class_id": 67}, ...]
```
backend 는 **원본 라벨/픽셀 bbox** 만 돌려준다. 표준 라벨 정규화·정규화 좌표 계산은 **엔진**이 한다.
→ backend 를 자유롭게 교체할 수 있고(원격 추론 서버 등), 라벨 정책을 한 곳(엔진/매퍼)에서 관리.

---

## 7. 객체 라벨 매핑 구조 (`ObjectLabelMapper`)

```
YOLO 원본 라벨(COCO 등)            Solomon 표준 라벨
─────────────────────             ─────────────────
"cell phone" / "mobile phone" ──▶  phone
"book"                        ──▶  book
"laptop"                      ──▶  laptop
"tablet" / "ipad"             ──▶  tablet
"person"                      ──▶  person
(그 외 매핑 없음)              ──▶  unknown_object
```

- **우선순위**: `config/yolo.yaml` 의 `target_objects` → 없으면 `DEFAULT_TARGET_OBJECTS`.
- **대소문자/공백 무시**: 내부에서 `strip().lower()` 정규화 후 매칭.
- **자기 매핑**: 표준 라벨 자체(`"phone"`)도 자기 자신으로 매핑.
- **표준 라벨 자체**는 `STANDARD_LABELS = [phone, book, laptop, tablet, person]`,
  미매핑은 `unknown_object`(표준 detected/score 집계엔 미반영, `object_counts` 엔 기록).

> 라벨 매핑을 엔진/Result 에서 분리한 이유: 모델(COCO/커스텀)이 바뀌어도 **config 만 고치면**
> Solomon 표준 라벨 체계와 다운스트림(Rule Engine)이 영향을 받지 않는다.

---

## 8. 테스트 결과

`python test_yolo_engine.py` (실제 ultralytics·모델 파일 **없이** 실행):

```
PASS init/analyze: ObjectDetectionResult/AnalysisResult, activity=UNKNOWN
PASS metadata: phone/book/laptop/tablet/person detected 가 metadata 에 반영
PASS bbox: 원본/정규화 좌표 + 정규화 라벨 보관
PASS skipped: 분석 가능한 프레임 없음 → SKIPPED
PASS failed: backend 예외 → FAILED
PASS sampling: sample_every_n_frames + max_analyzed_frames 적용
PASS label_mapper: 원본→표준 정규화 + config 우선
PASS unknown: 미매핑 라벨 → unknown_object
PASS registry: create_engine('yolo') 동작
PASS intact: dummy/opencv/mediapipe/yolo 등록 유지(dummy 동작)

ALL PASS: init / metadata / bbox / skipped / failed / sampling / label_mapper / unknown / registry / intact
```

**데모** `python yolo_demo.py --fake`:
```
===== ObjectDetectionResult (객체 Facts만) =====
  seat=Seat1 frame_count=6 analyzed_frames=3 valid_frames=3
  phone_detected=True (3) book_detected=True (3) laptop_detected=True (3)
  tablet_detected=True (3) person_detected=True (3) max_person_count=2
  detected_objects_count=18 object_counts={'phone': 3, 'book': 3, 'laptop': 3, 'tablet': 3, 'person': 6}
  avg_conf=0.7533 max_conf=0.9 quality_score=0.7533
  sample object={'frame_index': 0, 'label': 'phone', 'source_label': 'cell phone', 'confidence': 0.87,
                 'bbox_xyxy': [10, 10, 80, 160], 'bbox_normalized': [0.0312, 0.0417, 0.25, 0.6667], 'class_id': 67}
===== AnalysisResult =====
  status=SUCCESS activity=UNKNOWN confidence(=검출품질)=0.7533 proc=0.59ms
  scores={'quality_score': 0.7533, 'phone_score': 0.87, 'book_score': 0.74, 'laptop_score': 0.66,
          'tablet_score': 0.55, 'person_score': 0.9}
  model_loaded=True
```

**회귀 확인**
- 새 모듈 import 시 `cv2`/`ultralytics`/`mediapipe` 미로드(`sys.modules` 확인 통과).
- `engine_registry.available_engines()` → `['dummy', 'mediapipe', 'opencv', 'yolo']`.
- `test_mediapipe_engine.py` / `test_scheduler_engine.py` 기존 테스트 PASS 유지.

---

## 9. 남은 기술부채

1. **실제 backend 미검증**: `ultralytics`/모델 파일이 환경에 없어 `YOLOBackend` 실제 추론 경로는 코드 리뷰 수준까지만 확인. 실제 가중치로 통합 테스트 필요.
2. **모델/라벨 종속**: COCO 기본 모델엔 `tablet` 클래스가 없다(현재 매핑은 커스텀 모델 가정). 실제 태블릿 검출은 커스텀 학습 또는 `laptop`/`book` 오검출 대응 필요.
3. **ROI 좌표계**: `apply_roi=True` 시 bbox 가 ROI 로컬 좌표 기준이라 원본 프레임 좌표 환산 규약 미정(MediaPipe 와 동일 부채).
4. **person 카운트 신뢰성**: `max_person_count` 가 프레임 단순 최대치라 깜빡임/중복 박스(NMS 후에도)에 취약. 트래킹 미적용.
5. **quality_score 단순화**: 평균 신뢰도라 "객체가 적지만 확실" vs "많지만 흐릿" 을 구분 못함.
6. **클래스 필터링 없음**: backend 가 모든 클래스를 돌려주고 엔진이 매핑만 함 → 불필요 클래스도 `unknown_object` 로 누적(메모리). target 클래스만 추론 단계에서 거르는 옵션 필요.
7. **OpenCV 파이프라인 미연동**: OpenCVEngine 의 검증/ROI 결과(VisionResult)를 재사용하지 않고 자체 재검증(이중 작업).
8. **단일 프레임 IMAGE 추론**: 프레임마다 predict 호출 — 다좌석 동시엔 배치/스트림 추론 필요.

---

## 10. v0.2 개선계획

1. **실제 모델 통합 테스트**: `models/*.pt` + `pip install ultralytics` 환경에서 `--real` E2E 검증, CI 옵셔널 잡 추가.
2. **클래스 화이트리스트 추론**: `target_objects` 의 표준 라벨에 해당하는 COCO class id 만 추론(`classes=` 인자) → 속도·노이즈 개선.
3. **MediaPipe ⊕ YOLO Facts 통합 스키마**: 한 BurstPackage 에 대해 두 엔진 결과를 합치는 공통 `FrameFacts`/`SeatFacts` 설계(Rule Engine 입력 표준화).
4. **bbox 좌표계 규약**: 원본↔ROI↔정규화 변환 유틸 공통화(MediaPipe head_center 와 함께).
5. **객체 트래킹**: `track()` 도입으로 person 수 안정화, 휴대폰 지속 등장 시간 같은 시계열 특징(여전히 해석 X, 수치만) 저장.
6. **품질 점수 고도화**: 검출 수·신뢰도 분포·박스 안정성 결합 점수.
7. **OpenCV ↔ YOLO 파이프라인 연계**: 검증 통과 프레임/ROI 를 OpenCVEngine 으로부터 받아 이중 검증 제거.
8. **Rule Engine v0.1 설계 착수**: MediaPipe(얼굴·손·자세) + YOLO(휴대폰·책·노트북·사람) Facts → 행동(공부/휴대폰 사용/수면/자리비움) 판별 규칙. **이때 처음으로 activity 가 UNKNOWN 이 아니게 됨.**

> v0.1 범위 재확인: **객체 추출까지만.** 행동 판별/Rule Engine/Supabase/대시보드/학생 상태 변경은 다음 단계.
