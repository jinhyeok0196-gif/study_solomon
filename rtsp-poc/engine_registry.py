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


# opencv 는 cv2 의존이 있으므로 lazy 등록(create 시점에만 import)
def _make_opencv(**kw):
    from plugins.opencv_engine import OpenCVEngine
    return OpenCVEngine(**kw)


register("opencv", _make_opencv)


# mediapipe 는 mediapipe/numpy 의존이 있으므로 lazy 등록(create 시점에만 import).
# 실제 mediapipe import 는 engine.initialize() 의 real backend 생성 이후에만 일어난다.
def _make_mediapipe(**kw):
    from plugins.mediapipe_engine import MediaPipeEngine
    return MediaPipeEngine(**kw)


register("mediapipe", _make_mediapipe)


# yolo 는 ultralytics 의존이 있으므로 lazy 등록(create 시점에만 plugin import).
# 실제 ultralytics import 는 engine.initialize() 의 real backend.initialize() 이후에만 일어난다.
def _make_yolo(**kw):
    from plugins.yolo_engine import YOLOEngine
    return YOLOEngine(**kw)


register("yolo", _make_yolo)
