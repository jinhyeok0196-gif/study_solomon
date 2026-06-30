"""
MediaPipe Backend
=================

MediaPipe 호출부를 엔진(MediaPipeEngine)에서 분리한다.
이렇게 하면:
  - 실제 모델 파일 / mediapipe 라이브러리 없이도 엔진 로직을 테스트할 수 있고,
  - 나중에 다른 backend(예: 원격 추론 서버)로 교체하기 쉽다.

공통 계약
---------
    class <Backend>:
        initialize()                  # 모델 로드(1회)
        analyze_frame(rgb_frame)->dict# 1프레임의 원자적 특징(Facts)
        shutdown()
        health()->dict

analyze_frame() 이 돌려주는 per-frame Facts 스키마(해석 없음):

    {
      "face":  {"detected": bool, "landmark_count": int,
                "presence_score": float, "head_center": [x, y] | None},
      "pose":  {"detected": bool, "landmark_count": int,
                "shoulder_visible": bool, "upper_body_visible": bool},
      "hands": {"detected": bool, "count": int, "landmark_count": int,
                "left": bool, "right": bool},
    }

비활성/미검출 detector 는 detected=False, count/landmark_count=0 으로 채운다.

주의: 이 모듈은 mediapipe 를 **lazy import** 한다(초기화 시점에만).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

log = logging.getLogger("mediapipe_backend")

# detector 별 표준 랜드마크 수(참고용 상수)
FACE_LANDMARKS = 468
POSE_LANDMARKS = 33
HAND_LANDMARKS = 21


def _empty_facts() -> Dict[str, Any]:
    return {
        "face": {"detected": False, "landmark_count": 0,
                 "presence_score": 0.0, "head_center": None},
        "pose": {"detected": False, "landmark_count": 0,
                 "shoulder_visible": False, "upper_body_visible": False},
        "hands": {"detected": False, "count": 0, "landmark_count": 0,
                  "left": False, "right": False},
    }


class MediaPipeBackend:
    """Google MediaPipe Tasks API 기반 실제 backend.

    config 예시는 config/mediapipe.yaml 참고. 모델 파일이 없으면 해당 detector 는
    자동으로 비활성화되고 health() 에 그 사실이 드러난다(전체 크래시 X).
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        self.config: Dict[str, Any] = dict(config or {})
        self.enabled: Dict[str, bool] = dict(self.config.get("enabled_detectors", {}))
        self.model_paths: Dict[str, str] = dict(self.config.get("model_paths", {}))
        self.runtime: Dict[str, Any] = dict(self.config.get("runtime", {}))
        self._ready = False
        self._mp = None                       # lazy import 캐시
        self._face = self._pose = self._hands = None
        self.loaded: Dict[str, bool] = {"face": False, "pose": False, "hands": False}

    # ------------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        # mediapipe 는 무거우므로 여기서만 import 한다.
        import mediapipe as mp  # noqa: F401  (lazy)
        self._mp = mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        base = mp_python.BaseOptions
        delegate = str(self.runtime.get("delegate", "CPU")).upper()
        deleg_enum = getattr(base.Delegate, "GPU", None) if delegate == "GPU" \
            else getattr(base.Delegate, "CPU", None)

        def _base_opts(path: str):
            kw = {"model_asset_path": path}
            if deleg_enum is not None:
                kw["delegate"] = deleg_enum
            return base(**kw)

        # --- Face ---
        if self.enabled.get("face", True) and self._model_ok("face_landmarker"):
            opts = mp_vision.FaceLandmarkerOptions(
                base_options=_base_opts(self.model_paths["face_landmarker"]),
                num_faces=int(self.runtime.get("max_faces", 1)),
                min_face_detection_confidence=float(
                    self.runtime.get("min_detection_confidence", 0.5)),
                min_tracking_confidence=float(
                    self.runtime.get("min_tracking_confidence", 0.5)),
            )
            self._face = mp_vision.FaceLandmarker.create_from_options(opts)
            self.loaded["face"] = True

        # --- Pose ---
        if self.enabled.get("pose", True) and self._model_ok("pose_landmarker"):
            opts = mp_vision.PoseLandmarkerOptions(
                base_options=_base_opts(self.model_paths["pose_landmarker"]),
                min_pose_detection_confidence=float(
                    self.runtime.get("min_detection_confidence", 0.5)),
                min_tracking_confidence=float(
                    self.runtime.get("min_tracking_confidence", 0.5)),
            )
            self._pose = mp_vision.PoseLandmarker.create_from_options(opts)
            self.loaded["pose"] = True

        # --- Hands ---
        if self.enabled.get("hands", True) and self._model_ok("hand_landmarker"):
            opts = mp_vision.HandLandmarkerOptions(
                base_options=_base_opts(self.model_paths["hand_landmarker"]),
                num_hands=int(self.runtime.get("max_hands", 2)),
                min_hand_detection_confidence=float(
                    self.runtime.get("min_detection_confidence", 0.5)),
                min_tracking_confidence=float(
                    self.runtime.get("min_tracking_confidence", 0.5)),
            )
            self._hands = mp_vision.HandLandmarker.create_from_options(opts)
            self.loaded["hands"] = True

        self._ready = True
        log.info("MediaPipeBackend 초기화 - loaded=%s", self.loaded)

    def _model_ok(self, key: str) -> bool:
        path = self.model_paths.get(key)
        if not path or not os.path.exists(path):
            log.warning("모델 파일 없음(%s=%s) - 해당 detector 비활성화", key, path)
            return False
        return True

    # ----------------------------------------------------------- per-frame
    def analyze_frame(self, rgb_frame) -> Dict[str, Any]:
        if not self._ready:
            raise RuntimeError("MediaPipeBackend.initialize() 가 호출되지 않았습니다")
        mp = self._mp
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        facts = _empty_facts()

        if self._face is not None:
            r = self._face.detect(image)
            lms = getattr(r, "face_landmarks", None) or []
            if lms:
                pts = lms[0]
                facts["face"] = {
                    "detected": True,
                    "landmark_count": len(pts),
                    "presence_score": 1.0,
                    "head_center": _mean_xy(pts),
                }

        if self._pose is not None:
            r = self._pose.detect(image)
            lms = getattr(r, "pose_landmarks", None) or []
            if lms:
                pts = lms[0]
                # 원시 가시성(visibility) 만 본다 — 자세 "해석" 은 하지 않는다.
                facts["pose"] = {
                    "detected": True,
                    "landmark_count": len(pts),
                    "shoulder_visible": _visible(pts, (11, 12)),
                    "upper_body_visible": _visible(pts, (0, 11, 12, 23, 24)),
                }

        if self._hands is not None:
            r = self._hands.detect(image)
            lms = getattr(r, "hand_landmarks", None) or []
            handed = getattr(r, "handedness", None) or []
            if lms:
                left = right = False
                for cat in handed:
                    label = (cat[0].category_name if cat else "").lower()
                    left = left or label == "left"
                    right = right or label == "right"
                facts["hands"] = {
                    "detected": True,
                    "count": len(lms),
                    "landmark_count": sum(len(h) for h in lms),
                    "left": left,
                    "right": right,
                }
        return facts

    def shutdown(self) -> None:
        for obj in (self._face, self._pose, self._hands):
            try:
                if obj is not None and hasattr(obj, "close"):
                    obj.close()
            except Exception:  # pragma: no cover - 종료 best-effort
                pass
        self._face = self._pose = self._hands = None
        self._ready = False

    def health(self) -> dict:
        return {"backend": "mediapipe", "ready": self._ready,
                "loaded": dict(self.loaded), "enabled": dict(self.enabled)}


def _mean_xy(pts) -> Optional[List[float]]:
    """랜드마크 리스트의 정규화 좌표 평균(approximate center). 해석 없음."""
    if not pts:
        return None
    n = len(pts)
    sx = sum(getattr(p, "x", 0.0) for p in pts)
    sy = sum(getattr(p, "y", 0.0) for p in pts)
    return [round(sx / n, 4), round(sy / n, 4)]


def _visible(pts, idxs, thresh: float = 0.5) -> bool:
    """지정 인덱스 랜드마크들의 visibility 가 임계 이상인지(원시 가시성)."""
    try:
        return all(getattr(pts[i], "visibility", 1.0) >= thresh for i in idxs)
    except Exception:
        return False


class FakeMediaPipeBackend:
    """테스트/데모용 가짜 backend. mediapipe 와 모델 파일이 전혀 필요 없다.

    프레임 내용과 무관하게 **설정대로** 결정적(deterministic) Facts 를 돌려준다.
    enabled_detectors 설정을 존중하고, fail=True 면 analyze_frame 에서 예외를 던진다.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None,
                 face: bool = True, pose: bool = True, hands: int = 2,
                 fail: bool = False) -> None:
        self.config = dict(config or {})
        enabled = self.config.get("enabled_detectors", {})
        self._face_on = bool(enabled.get("face", True)) and face
        self._pose_on = bool(enabled.get("pose", True)) and pose
        self._hands_on = bool(enabled.get("hands", True)) and (hands > 0)
        self._hands = int(hands)
        self._fail = fail
        self._ready = False

    def initialize(self) -> None:
        self._ready = True

    def analyze_frame(self, rgb_frame) -> Dict[str, Any]:
        if self._fail:
            raise RuntimeError("FakeMediaPipeBackend: 강제 예외(fail=True)")
        # 프레임 중심을 head_center 로 사용(정규화). 내용 해석 없음.
        facts = _empty_facts()
        if self._face_on:
            facts["face"] = {"detected": True, "landmark_count": FACE_LANDMARKS,
                             "presence_score": 1.0, "head_center": [0.5, 0.45]}
        if self._pose_on:
            facts["pose"] = {"detected": True, "landmark_count": POSE_LANDMARKS,
                             "shoulder_visible": True, "upper_body_visible": True}
        if self._hands_on:
            n = max(1, min(self._hands, 2))
            facts["hands"] = {"detected": True, "count": n,
                              "landmark_count": HAND_LANDMARKS * n,
                              "left": n >= 2, "right": True}
        return facts

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"backend": "fake", "ready": self._ready,
                "loaded": {"face": self._face_on, "pose": self._pose_on,
                           "hands": self._hands_on}}
