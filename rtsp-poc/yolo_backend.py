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
