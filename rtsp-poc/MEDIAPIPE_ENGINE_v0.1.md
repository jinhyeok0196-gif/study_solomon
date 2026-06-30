# Solomon MediaPipe Engine v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: MediaPipe Face/Pose/Hands Landmarker 로 BurstPackage 프레임에서
> **원자적 특징(Facts)** 만 추출한다. **행동 판별은 절대 하지 않는다** — `activity` 는 항상 `UNKNOWN`,
> `confidence` 는 행동 신뢰도가 아니라 **landmark 추출 품질 점수**.
> `mediapipe`/모델 파일 없이 **Fake Backend** 로 전체 테스트 통과.

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── config/
│   ├── roi.yaml                     # (기존) 좌석별 ROI
│   └── mediapipe.yaml               # ★신규 MediaPipe detector/모델경로/런타임 설정
├── models/                          # ★(gitignore) 실제 .task 모델 파일 배치 위치 — 레포 미포함
├── plugins/
│   ├── __init__.py
│   ├── dummy_engine.py              # (기존) DummyAIEngine
│   ├── opencv_engine.py             # (기존) OpenCVEngine
│   └── mediapipe_engine.py          # ★신규 MediaPipeEngine (AIEngine 구현, cv2/mediapipe 비의존)
│
├── ai_engine.py                     # (기존) AIEngine 추상 인터페이스
├── ai_manager.py                    # (기존) 엔진 로드/교체/분석
├── analysis_result.py               # (기존) AnalysisResult (+ STATUS_FAILED 재사용)
├── burst_package.py                 # (기존) BurstPackage
├── engine_registry.py               # ✎수정 "mediapipe" lazy 등록 추가
│
├── vision_result.py                 # (기존) VisionResult (OpenCV 전처리 결과)
├── vision_utils.py                  # (기존) OpenCV 품질/전처리 함수
│
├── mediapipe_result.py              # ★신규 MediaPipeResult (원자적 특징 묶음, 순수 데이터)
├── mediapipe_backend.py             # ★신규 MediaPipeBackend(실제) + FakeMediaPipeBackend(테스트)
├── mediapipe_demo.py                # ★신규 CLI 데모 (--fake / --dummy-frames / --real)
│
├── camera_core.py / camera_manager.py / camera_config.py / ring_buffer.py   # (기존) 카메라
├── scheduler_engine.py / schedule_config.py                                 # (기존) 스케줄러
├── orchestrator_engine.py / trigger_queue.py                                # (기존) 오케스트레이터
│
├── manage.py / main.py / scheduler_demo.py / orchestrator_demo.py / ai_demo.py / vision_demo.py
│
├── test_camera_core.py / test_camera_manager.py / test_scheduler_engine.py
├── test_orchestrator_engine.py / test_ai_engine.py / test_vision_engine.py
├── test_mediapipe_engine.py         # ★신규 MediaPipe 엔진 테스트 (모델 파일 없이)
│
├── cameras.yaml / schedule.yaml
├── .gitignore                       # ✎수정 models/ + *.task 무시
└── README.md                        # ✎수정 MediaPipe Engine v0.1 절 추가
```

★ = 신규, ✎ = 수정.

---

## 2. 신규 파일 전체 코드

### 2-1. `mediapipe_result.py`

```python
"""
MediaPipeResult
===============

MediaPipe Engine 이 BurstPackage 에서 추출한 **원자적 특징(Facts)** 묶음.

여기에는 얼굴/손/자세 랜드마크의 "관측 가능한 수치"만 담는다.
공부/휴대폰/수면/자리비움 같은 **최종 행동 판별은 절대 하지 않는다**(그건 Rule Engine 의 일).
각도 등도 해석 없이 원시 특징 수준으로만 보관한다.

이 모듈은 OpenCV / MediaPipe 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class MediaPipeResult:
    mediapipe_uuid: str

    # ----- 프레임 카운트 -----
    frame_count: int                 # BurstPackage 입력 프레임 수
    analyzed_frames: int             # 실제 MediaPipe 에 넣은 프레임 수(샘플링/상한 적용 후)
    valid_frames: int                # 검증을 통과한(=분석 대상) 프레임 수

    # ----- 얼굴(Face) -----
    face_detected: bool              # 분석 프레임 중 1개 이상에서 얼굴이 잡혔는가
    face_detection_count: int        # 얼굴이 잡힌 프레임 수

    # ----- 자세(Pose) -----
    pose_detected: bool
    pose_detection_count: int

    # ----- 손(Hands) -----
    hands_detected: bool
    hand_detection_count: int        # 손이 1개 이상 잡힌 프레임 수
    max_hands: int                   # 한 프레임에서 동시에 잡힌 손의 최대 개수

    # ----- 평균 랜드마크 수(분석 프레임 기준, 미검출=0) -----
    avg_face_landmarks: float
    avg_pose_landmarks: float
    avg_hand_landmarks: float

    # ----- 원자적 특징 묶음(해석 X) -----
    head_features: Dict[str, Any] = field(default_factory=dict)
    hand_features: Dict[str, Any] = field(default_factory=dict)
    pose_features: Dict[str, Any] = field(default_factory=dict)

    # landmark 추출 "품질" 점수(0~1). 최종 행동 신뢰도가 아님.
    quality_score: float = 0.0

    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        """로그/메타데이터 임베드용 축약 dict (랜드마크 좌표 등 무거운 값 제외)."""
        return {
            "mediapipe_uuid": self.mediapipe_uuid,
            "frame_count": self.frame_count,
            "analyzed_frames": self.analyzed_frames,
            "valid_frames": self.valid_frames,
            "face_detected": self.face_detected,
            "face_detection_count": self.face_detection_count,
            "pose_detected": self.pose_detected,
            "pose_detection_count": self.pose_detection_count,
            "hands_detected": self.hands_detected,
            "hand_detection_count": self.hand_detection_count,
            "max_hands": self.max_hands,
            "avg_face_landmarks": self.avg_face_landmarks,
            "avg_pose_landmarks": self.avg_pose_landmarks,
            "avg_hand_landmarks": self.avg_hand_landmarks,
            "quality_score": self.quality_score,
        }
```

### 2-2. `mediapipe_backend.py`

```python
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
```

### 2-3. `plugins/mediapipe_engine.py`

```python
"""
MediaPipeEngine (Solomon MediaPipe Engine v0.1)
===============================================

AIEngine 인터페이스 구현체. MediaPipe Face / Pose / Hands Landmarker 로
**원자적 특징(Facts)만** 추출한다.

  BurstPackage → 프레임 샘플링 → 프레임 검증 → (BGR→RGB) →
  MediaPipe Face/Pose/Hands → MediaPipeResult → AnalysisResult

매우 중요(이번 단계 범위):
  - 공부 / 휴대폰 / 수면 / 자리비움 같은 **최종 행동 판별을 절대 하지 않는다.**
  - activity 는 항상 "UNKNOWN".
  - confidence 는 최종 행동 신뢰도가 아니라 **landmark 추출 품질 점수**다.
  - 각도/자세 해석 없이 원시 특징(검출 여부·랜드마크 수·가시성)만 저장한다.

이 모듈은 cv2 / mediapipe 를 **import 하지 않는다**.
  - BGR→RGB / ROI crop 은 numpy 슬라이싱으로 처리(테스트가 cv2 없이 통과).
  - 실제 mediapipe 호출은 주입된 backend(MediaPipeBackend) 의 책임이며 lazy 다.
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
from mediapipe_result import MediaPipeResult

if TYPE_CHECKING:
    from burst_package import BurstPackage

log = logging.getLogger("mediapipe_engine")

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # rtsp-poc/
_DEFAULT_CONFIG = os.path.join(_HERE, "config", "mediapipe.yaml")
_DEFAULT_ROI = os.path.join(_HERE, "config", "roi.yaml")

_DEFAULT_RUNTIME = {
    "sample_every_n_frames": 2,
    "max_analyzed_frames": 10,
    "max_faces": 1,
    "max_hands": 2,
}


class MediaPipeEngine(AIEngine):
    name = "mediapipe"

    def __init__(
        self,
        config_path: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        backend: Optional[Any] = None,
        apply_roi: bool = False,
        roi_path: Optional[str] = None,
        rois: Optional[Dict[str, dict]] = None,
        min_brightness: float = 10.0,
        **kwargs,
    ) -> None:
        self.config_path = config_path or _DEFAULT_CONFIG
        self._config: Optional[Dict[str, Any]] = dict(config) if config else None
        self._backend = backend                  # None 이면 initialize 때 real backend 생성
        self.apply_roi = apply_roi
        self.roi_path = roi_path or _DEFAULT_ROI
        self._rois: Dict[str, dict] = dict(rois) if rois else {}
        self.min_brightness = min_brightness
        self._ready = False
        self._analyzed = 0
        self.last_result: Optional[MediaPipeResult] = None

    # ----------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        if self._config is None:
            self._config = self._load_config(self.config_path)
        self._runtime = {**_DEFAULT_RUNTIME, **(self._config.get("runtime", {}) or {})}
        self._enabled = self._config.get("enabled_detectors",
                                         {"face": True, "pose": True, "hands": True})

        if self._backend is None:
            # real backend 는 여기서만 만든다(생성 자체로 mediapipe 를 import 하지 않음).
            from mediapipe_backend import MediaPipeBackend
            self._backend = MediaPipeBackend(self._config)
        self._backend.initialize()

        if self.apply_roi and not self._rois:
            self._rois = self._load_rois(self.roi_path)

        self._ready = True
        log.info("MediaPipeEngine 초기화 - enabled=%s apply_roi=%s",
                 self._enabled, self.apply_roi)

    @staticmethod
    def _load_config(path: str) -> Dict[str, Any]:
        if not os.path.exists(path):
            log.warning("mediapipe 설정 없음(%s) - 기본값 사용", path)
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
             "apply_roi": self.apply_roi, "roi_seats": sorted(self._rois.keys())}
        if self._backend is not None and hasattr(self._backend, "health"):
            h["backend"] = self._backend.health()
        return h

    # ----------------------------------------------------------- frame prep
    def _select_frames(self, frames: List[Any]) -> List[Any]:
        """sample_every_n_frames 적용 후 max_analyzed_frames 로 상한."""
        step = max(1, int(self._runtime.get("sample_every_n_frames", 1)))
        sampled = frames[::step]
        cap = int(self._runtime.get("max_analyzed_frames", 0) or 0)
        if cap > 0 and len(sampled) > cap:
            sampled = sampled[:cap]
        return sampled

    def _prepare_rgb(self, img, roi: Optional[dict]):
        """검증 + (선택)ROI crop + BGR→RGB. 부적합하면 (None, reason)."""
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
        return _bgr_to_rgb(img), "ok"

    # ----------------------------------------------------------- analyze
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        started = datetime.now()
        seat = getattr(burst, "seat_id", "")
        roi = self._rois.get(seat) if (self.apply_roi and self._rois) else None
        frames = getattr(burst, "frames", []) or []

        selected = self._select_frames(frames)
        per_frame: List[Dict[str, Any]] = []
        discard_reasons: Dict[str, int] = {}
        errors: List[str] = []
        backend_failed = False

        for f in selected:
            img = getattr(f, "frame", f)            # FrameItem 이면 .frame, 아니면 그대로
            rgb, reason = self._prepare_rgb(img, roi)
            if rgb is None:
                discard_reasons[reason] = discard_reasons.get(reason, 0) + 1
                continue
            try:
                per_frame.append(self._backend.analyze_frame(rgb))
            except Exception as exc:                # backend 내부 예외 → FAILED
                backend_failed = True
                errors.append(f"{type(exc).__name__}: {exc}")
                log.exception("MediaPipe backend 분석 예외")
                break

        mp_res = self._aggregate(burst, len(frames), len(selected), per_frame)
        self.last_result = mp_res
        self._analyzed += 1
        finished = datetime.now()

        if backend_failed:
            status = STATUS_FAILED
        elif mp_res.valid_frames > 0:
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
            confidence=mp_res.quality_score,         # 행동 신뢰도 아님 = 추출 품질
            status=status,
            activity=ACTIVITY_UNKNOWN,               # MediaPipe 는 판단자가 아니다
            scores={
                "quality_score": mp_res.quality_score,
                "face_visible_ratio": mp_res.head_features.get("face_visible_ratio", 0.0),
                "hands_visible_ratio": mp_res.hand_features.get("hands_visible_ratio", 0.0),
                "pose_visible_ratio": mp_res.pose_features.get("pose_visible_ratio", 0.0),
            },
            metadata={
                "engine": self.name,
                "mediapipe_result": mp_res.summary(),
                "analyzed_frames": mp_res.analyzed_frames,
                "skipped_frames": sum(discard_reasons.values()),
                "discard_reasons": discard_reasons,
                "detector_status": dict(self._enabled),
                "model_paths_loaded": self._backend.health().get("loaded", {})
                if hasattr(self._backend, "health") else {},
                "head_features": mp_res.head_features,
                "hand_features": mp_res.hand_features,
                "pose_features": mp_res.pose_features,
                "errors": errors,
            },
        )

    # ----------------------------------------------------------- aggregate
    def _aggregate(self, burst, frame_count: int, analyzed_frames: int,
                   per_frame: List[Dict[str, Any]]) -> MediaPipeResult:
        valid = len(per_frame)

        face_cnt = sum(1 for p in per_frame if p["face"]["detected"])
        pose_cnt = sum(1 for p in per_frame if p["pose"]["detected"])
        hand_frames = sum(1 for p in per_frame if p["hands"]["detected"])
        max_hands = max((p["hands"]["count"] for p in per_frame), default=0)

        def _avg(vals: List[float]) -> float:
            return round(float(sum(vals) / valid), 2) if valid else 0.0

        avg_face_lm = _avg([p["face"]["landmark_count"] for p in per_frame])
        avg_pose_lm = _avg([p["pose"]["landmark_count"] for p in per_frame])
        avg_hand_lm = _avg([p["hands"]["landmark_count"] for p in per_frame])

        face_ratio = round(face_cnt / valid, 3) if valid else 0.0
        pose_ratio = round(pose_cnt / valid, 3) if valid else 0.0
        hands_ratio = round(hand_frames / valid, 3) if valid else 0.0
        face_presence = _avg([p["face"]["presence_score"] for p in per_frame])

        # 검출된 프레임들의 head_center 평균(없으면 None) — 해석 없는 원시 위치
        centers = [p["face"]["head_center"] for p in per_frame
                   if p["face"]["detected"] and p["face"]["head_center"]]
        head_center = None
        if centers:
            head_center = [round(sum(c[0] for c in centers) / len(centers), 4),
                           round(sum(c[1] for c in centers) / len(centers), 4)]

        left = any(p["hands"]["left"] for p in per_frame)
        right = any(p["hands"]["right"] for p in per_frame)
        avg_hand_count = _avg([p["hands"]["count"] for p in per_frame])

        shoulder_visible = any(p["pose"]["shoulder_visible"] for p in per_frame)
        upper_body_visible = any(p["pose"]["upper_body_visible"] for p in per_frame)

        # 추출 품질 = 활성 detector 들의 가시 비율 평균(행동 신뢰도가 아님)
        ratios = []
        if self._enabled.get("face", True):
            ratios.append(face_ratio)
        if self._enabled.get("pose", True):
            ratios.append(pose_ratio)
        if self._enabled.get("hands", True):
            ratios.append(hands_ratio)
        quality = round(sum(ratios) / len(ratios), 3) if (ratios and valid) else 0.0

        return MediaPipeResult(
            mediapipe_uuid=uuid.uuid4().hex,
            frame_count=frame_count,
            analyzed_frames=analyzed_frames,
            valid_frames=valid,
            face_detected=face_cnt > 0,
            face_detection_count=face_cnt,
            pose_detected=pose_cnt > 0,
            pose_detection_count=pose_cnt,
            hands_detected=hand_frames > 0,
            hand_detection_count=hand_frames,
            max_hands=max_hands,
            avg_face_landmarks=avg_face_lm,
            avg_pose_landmarks=avg_pose_lm,
            avg_hand_landmarks=avg_hand_lm,
            head_features={
                "face_visible_ratio": face_ratio,
                "approximate_head_center": head_center,
                "face_landmark_count": avg_face_lm,
                "face_presence_score": face_presence,
            },
            hand_features={
                "hands_visible_ratio": hands_ratio,
                "left_hand_detected": left,
                "right_hand_detected": right,
                "avg_hand_count": avg_hand_count,
                "hand_landmark_count": avg_hand_lm,
            },
            pose_features={
                "pose_visible_ratio": pose_ratio,
                "shoulder_visible": shoulder_visible,
                "upper_body_visible": upper_body_visible,
                "pose_landmark_count": avg_pose_lm,
            },
            quality_score=quality,
            metadata={
                "seat_id": getattr(burst, "seat_id", ""),
                "roi_applied": bool(self.apply_roi and self._rois.get(
                    getattr(burst, "seat_id", ""))),
            },
        )


# ---------------------------------------------------------------- numpy helpers
def _bgr_to_rgb(img: "np.ndarray") -> "np.ndarray":
    """OpenCV BGR → RGB. cv2 없이 numpy 슬라이싱으로(2D 는 그대로, BGRA 는 앞 3채널)."""
    if img.ndim == 2:
        return img
    if img.shape[2] == 4:
        return np.ascontiguousarray(img[:, :, [2, 1, 0]])
    return np.ascontiguousarray(img[:, :, ::-1])


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

### 2-4. `config/mediapipe.yaml`

```yaml
# =========================================================================
# MediaPipe Engine v0.1 설정
# =========================================================================
# MediaPipe Face / Pose / Hands Landmarker 로 "원자적 특징(Facts)" 만 추출한다.
# 공부/휴대폰/수면/자리비움 같은 최종 행동 판별은 절대 하지 않는다(Rule Engine 의 일).
#
# 주의:
#   - 모델 파일(.task)은 레포에 포함하지 않는다. models/ 는 .gitignore 처리.
#   - 모델 파일이 없으면 해당 detector 는 자동 비활성화된다(전체 크래시 X).
#   - 모델 파일 배치 방법은 README 의 "MediaPipe 모델 파일" 절 참고.
# =========================================================================

# 사용할 detector 활성화 여부
enabled_detectors:
  face: true
  pose: true
  hands: true

# 모델 파일 경로(레포 미포함 — 직접 내려받아 models/ 에 둔다)
model_paths:
  face_landmarker: "models/face_landmarker.task"
  pose_landmarker: "models/pose_landmarker.task"
  hand_landmarker: "models/hand_landmarker.task"

# 런타임 옵션
runtime:
  delegate: "CPU"               # CPU | GPU
  max_faces: 1
  max_hands: 2
  min_detection_confidence: 0.5
  min_tracking_confidence: 0.5
  sample_every_n_frames: 2      # N프레임마다 1장만 분석
  max_analyzed_frames: 10       # Burst 당 분석 프레임 상한
```

### 2-5. `mediapipe_demo.py`

```python
"""
Solomon MediaPipe Engine v0.1 - CLI 데모
========================================

BurstPackage 프레임에서 얼굴/손/자세 **원자적 특징(Facts)** 만 추출해 출력한다.
**행동 판별(공부/휴대폰/수면/자리비움)은 절대 하지 않는다** — activity 는 항상 UNKNOWN.

실행 예시:
  python mediapipe_demo.py --fake               # Fake backend(모델 파일 불필요)
  python mediapipe_demo.py --dummy-frames 5     # 합성 프레임 5장, Fake backend
  python mediapipe_demo.py --real --seat 1      # 실제 CameraManager + 실제 모델 파일 필요
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

import numpy as np

from burst_package import BurstPackage
from plugins.mediapipe_engine import MediaPipeEngine
from mediapipe_backend import FakeMediaPipeBackend


def parse_args():
    p = argparse.ArgumentParser(description="Solomon MediaPipe Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--fake", action="store_true",
                      help="Fake backend 사용(기본, 모델 파일 불필요)")
    mode.add_argument("--real", action="store_true",
                      help="실제 MediaPipe backend + CameraManager")
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
        # 밝고 디테일 있는 합성 프레임(검증 통과용). 내용 해석은 하지 않는다.
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
        eng = MediaPipeEngine()              # real backend (모델 파일 필요)
        cm, pkg = build_real(args.seat)
    else:
        # Fake backend 주입 → mediapipe / 모델 파일 없이 동작
        eng = MediaPipeEngine(backend=FakeMediaPipeBackend())
        pkg = build_dummy_burst(args.dummy_frames)

    eng.initialize()
    res = eng.analyze(pkg)
    mp = eng.last_result

    print("===== MediaPipeResult (원자적 특징만) =====")
    print(f"  seat={pkg.seat_id} frame_count={mp.frame_count} "
          f"analyzed_frames={mp.analyzed_frames} valid_frames={mp.valid_frames}")
    print(f"  face_detected={mp.face_detected} ({mp.face_detection_count}) "
          f"pose_detected={mp.pose_detected} ({mp.pose_detection_count}) "
          f"hands_detected={mp.hands_detected} ({mp.hand_detection_count}) "
          f"max_hands={mp.max_hands}")
    print(f"  quality_score={mp.quality_score}")
    print(f"  head_features={mp.head_features}")
    print(f"  hand_features={mp.hand_features}")
    print(f"  pose_features={mp.pose_features}")
    print("===== AnalysisResult =====")
    print(f"  status={res.status} activity={res.activity} "
          f"confidence(=추출품질)={res.confidence} proc={res.processing_time:.2f}ms")
    print(f"  scores={res.scores}")
    print(f"  detector_status={res.metadata['detector_status']} "
          f"model_paths_loaded={res.metadata['model_paths_loaded']}")

    eng.shutdown()
    if cm is not None and hasattr(cm, "stop_all"):
        cm.stop_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 2-6. `test_mediapipe_engine.py`

```python
"""
MediaPipe Engine v0.1 테스트.

**실제 MediaPipe 모델 파일 / mediapipe 라이브러리 없이** Fake Backend 로 통과한다.

검증:
  - MediaPipeEngine 초기화(Fake backend 주입)
  - Fake BurstPackage 분석 → MediaPipeResult / AnalysisResult 생성
  - activity 가 항상 UNKNOWN
  - face/pose/hands detected 가 metadata 에 반영
  - empty/dark/corrupt 프레임만 있으면 SKIPPED
  - backend 예외 발생 시 FAILED
  - 샘플링/상한(sample_every_n_frames / max_analyzed_frames)
  - enabled_detectors 비활성화 반영
  - engine_registry 에서 mediapipe 생성 가능(mediapipe import 없이)
  - 기존 dummy / opencv 엔진 등록이 깨지지 않음
"""
from datetime import datetime

import numpy as np

from analysis_result import (
    ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_SKIPPED, STATUS_FAILED,
)
from mediapipe_result import MediaPipeResult
from burst_package import BurstPackage
from mediapipe_backend import FakeMediaPipeBackend
from plugins.mediapipe_engine import MediaPipeEngine


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
    eng = MediaPipeEngine(backend=backend or FakeMediaPipeBackend(),
                          config={"runtime": {"sample_every_n_frames": 1,
                                              "max_analyzed_frames": 100}}, **kw)
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_init_and_analyze():
    eng = make_engine()
    assert eng.health()["ready"] is True
    res = eng.analyze(burst([fake_item(normal_frame(1)), fake_item(normal_frame(2))]))

    assert isinstance(eng.last_result, MediaPipeResult)
    assert res.status == STATUS_SUCCESS
    assert res.activity == ACTIVITY_UNKNOWN, "MediaPipe 는 행동 판별 안 함"
    mp = eng.last_result
    assert mp.valid_frames == 2 and mp.analyzed_frames == 2
    assert mp.face_detected and mp.pose_detected and mp.hands_detected
    assert mp.face_detection_count == 2
    assert mp.max_hands == 2
    # 원자적 특징 키 존재
    assert "face_visible_ratio" in mp.head_features
    assert "hands_visible_ratio" in mp.hand_features
    assert "pose_visible_ratio" in mp.pose_features
    print("PASS init/analyze: MediaPipeResult/AnalysisResult, activity=UNKNOWN")


def test_metadata_has_detections():
    eng = make_engine()
    res = eng.analyze(burst([fake_item(normal_frame(3))]))
    summ = res.metadata["mediapipe_result"]
    assert summ["face_detected"] is True
    assert summ["pose_detected"] is True
    assert summ["hands_detected"] is True
    assert res.metadata["engine"] == "mediapipe"
    assert set(res.scores) == {
        "quality_score", "face_visible_ratio", "hands_visible_ratio", "pose_visible_ratio"}
    assert res.metadata["detector_status"] == {"face": True, "pose": True, "hands": True}
    # confidence 는 추출 품질 점수(= quality_score)
    assert res.confidence == res.scores["quality_score"]
    print("PASS metadata: face/pose/hands detected 가 metadata 에 반영")


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
    eng = make_engine(backend=FakeMediaPipeBackend(fail=True))
    res = eng.analyze(burst([fake_item(normal_frame(5))]))
    assert res.status == STATUS_FAILED
    assert res.activity == ACTIVITY_UNKNOWN
    assert res.metadata["errors"], "예외 메시지가 errors 에 기록돼야 함"
    print("PASS failed: backend 예외 → FAILED")


def test_sampling_and_cap():
    eng = MediaPipeEngine(backend=FakeMediaPipeBackend(),
                          config={"runtime": {"sample_every_n_frames": 2,
                                              "max_analyzed_frames": 3}})
    eng.initialize()
    frames = [fake_item(normal_frame(i)) for i in range(10)]
    res = eng.analyze(burst(frames))
    mp = eng.last_result
    assert mp.frame_count == 10
    # 10프레임 → step2 = 5장 → cap3 = 3장 분석
    assert mp.analyzed_frames == 3, mp.analyzed_frames
    assert mp.valid_frames == 3
    print("PASS sampling: sample_every_n_frames + max_analyzed_frames 적용")


def test_disabled_detectors():
    eng = MediaPipeEngine(
        backend=FakeMediaPipeBackend(config={"enabled_detectors": {"face": True,
                                                                   "pose": False,
                                                                   "hands": False}}),
        config={"enabled_detectors": {"face": True, "pose": False, "hands": False}})
    eng.initialize()
    res = eng.analyze(burst([fake_item(normal_frame(7))]))
    mp = eng.last_result
    assert mp.face_detected is True
    assert mp.pose_detected is False and mp.hands_detected is False
    # 비활성 detector 는 quality 평균에서 제외 → face 만으로 품질 = 1.0
    assert mp.quality_score == 1.0
    print("PASS disabled: enabled_detectors 비활성화 반영")


def test_registry_creates_mediapipe():
    import engine_registry as reg
    assert "mediapipe" in reg.available_engines()
    # backend 주입으로 mediapipe import 없이 생성/초기화
    eng = reg.create_engine("mediapipe", backend=FakeMediaPipeBackend())
    eng.initialize()
    assert eng.name == "mediapipe"
    res = eng.analyze(burst([fake_item(normal_frame(8))]))
    assert res.activity == ACTIVITY_UNKNOWN
    print("PASS registry: create_engine('mediapipe') 동작")


def test_existing_engines_intact():
    import engine_registry as reg
    for name in ("dummy", "opencv", "mediapipe"):
        assert name in reg.available_engines(), name
    d = reg.create_engine("dummy")
    d.initialize()
    res = d.analyze(burst([fake_item(normal_frame(9))]))
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    print("PASS intact: dummy/opencv/mediapipe 등록 유지(dummy 동작)")


def main():
    test_init_and_analyze()
    test_metadata_has_detections()
    test_empty_frames_skipped()
    test_backend_failure_failed()
    test_sampling_and_cap()
    test_disabled_detectors()
    test_registry_creates_mediapipe()
    test_existing_engines_intact()
    print("\nALL PASS: init / metadata / skipped / failed / sampling / "
          "disabled / registry / intact")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드 (변경 부분)

### 3-1. `engine_registry.py` — `mediapipe` lazy 등록 추가

```python
register("opencv", _make_opencv)


# mediapipe 는 mediapipe/numpy 의존이 있으므로 lazy 등록(create 시점에만 import).
# 실제 mediapipe import 는 engine.initialize() 의 real backend 생성 이후에만 일어난다.
def _make_mediapipe(**kw):
    from plugins.mediapipe_engine import MediaPipeEngine
    return MediaPipeEngine(**kw)


register("mediapipe", _make_mediapipe)
```
> 기존 주석 처리돼 있던 "향후 예시"를 실제 등록으로 대체. `dummy`/`opencv` 등록은 그대로.

### 3-2. `.gitignore` — 모델 파일 무시 추가

```gitignore
.env
__pycache__/
*.pyc
.venv/
venv/

# MediaPipe 모델 파일은 레포에 포함하지 않는다(용량/라이선스). 직접 내려받아 배치.
models/
*.task
```

### 3-3. `README.md` — 추가/변경 요약

- 헤더 모듈 목록에 **MediaPipe Engine v0.1** 줄 추가, 범위 경고에 "MediaPipe 는 판단자가 아니라 특징 추출기" 명시.
- 파일 구조 표에 `mediapipe_result.py / mediapipe_backend.py / plugins/mediapipe_engine.py /
  config/mediapipe.yaml / mediapipe_demo.py / test_mediapipe_engine.py` 6행 추가.
- **"## MediaPipe Engine v0.1"** 절 신규 추가: 파이프라인 / Landmarker 역할 / MediaPipeResult /
  Backend 구조 / 설정 / **모델 파일 배치 방법** / 실행 / 테스트 / 다음 단계.

---

## 4. MediaPipe Engine 구조도

```
                     ┌──────────────────────────────────────────────┐
                     │              BurstPackage(frames)             │
                     └───────────────────────┬──────────────────────┘
                                             │
                          MediaPipeEngine.analyze()
                                             │
        ┌───────────────────────────────────┼─────────────────────────────────┐
        │  1) _select_frames()  sample_every_n_frames → max_analyzed_frames    │
        │  2) _prepare_rgb()    검증(empty/corrupt/too_dark) + (선택)ROI crop   │
        │                       + BGR→RGB (numpy 슬라이싱, cv2 미사용)          │
        └───────────────────────────────────┬─────────────────────────────────┘
                                             │ rgb_frame (검증 통과분만)
                                             ▼
                         ┌─────────────────────────────────────┐
                         │   Backend.analyze_frame(rgb_frame)  │   ← 교체 가능
                         │   ┌──────────────┐  ┌──────────────┐ │
                         │   │MediaPipeBackend│ │FakeMediaPipe │ │
                         │   │(Tasks API,    │ │Backend       │ │
                         │   │ lazy import)  │ │(테스트/데모)  │ │
                         │   └──────────────┘  └──────────────┘ │
                         │   Face / Pose / Hands Landmarker     │
                         └──────────────────┬──────────────────┘
                                             │ per-frame Facts(dict) × N
                                             ▼
                          MediaPipeEngine._aggregate()
                                  (검출 수·비율·평균·가시성 집계)
                                             │
                                             ▼
                                   ┌───────────────────┐
                                   │  MediaPipeResult  │  원자적 특징 묶음
                                   └─────────┬─────────┘
                                             ▼
                                   ┌───────────────────┐
                                   │  AnalysisResult   │  activity=UNKNOWN
                                   │  confidence=품질  │  scores/metadata
                                   └───────────────────┘
                                             │
                                             ▼
                            (향후) YOLO + Rule Engine → 최종 행동 판별
```

**핵심 설계 원칙**
- **추출기 ↔ 판단자 분리**: MediaPipe 는 관측만, 판단은 Rule Engine.
- **Backend 분리**: 실제/Fake 를 교체해 모델 파일·라이브러리 없이 로직 검증.
- **lazy import**: `mediapipe` 는 real backend `initialize()` 에서만 import.
- **cv2 비의존**: 엔진은 numpy 만 사용(BGR→RGB·ROI crop) → 테스트 가볍고 안정.

---

## 5. MediaPipeResult 설명

| 필드 | 의미 |
|------|------|
| `mediapipe_uuid` | 결과 고유 id |
| `frame_count` | BurstPackage 입력 프레임 수 |
| `analyzed_frames` | 샘플링/상한 적용 후 실제 분석 대상 프레임 수 |
| `valid_frames` | 검증 통과(=backend 에 들어간) 프레임 수 |
| `face_detected` / `face_detection_count` | 얼굴 검출 여부 / 검출된 프레임 수 |
| `pose_detected` / `pose_detection_count` | 자세 검출 여부 / 검출된 프레임 수 |
| `hands_detected` / `hand_detection_count` | 손 검출 여부 / 손이 1개+ 잡힌 프레임 수 |
| `max_hands` | 한 프레임에서 동시에 잡힌 손 최대 개수 |
| `avg_face_landmarks` / `avg_pose_landmarks` / `avg_hand_landmarks` | 분석 프레임당 평균 랜드마크 수(미검출=0) |
| `head_features` | `face_visible_ratio` / `approximate_head_center` / `face_landmark_count` / `face_presence_score` |
| `hand_features` | `hands_visible_ratio` / `left_hand_detected` / `right_hand_detected` / `avg_hand_count` / `hand_landmark_count` |
| `pose_features` | `pose_visible_ratio` / `shoulder_visible` / `upper_body_visible` / `pose_landmark_count` |
| `quality_score` | **활성 detector 가시 비율의 평균(0~1)** — landmark 추출 품질이지 행동 신뢰도가 아님 |
| `metadata` | `seat_id` / `roi_applied` |

> **해석 금지 원칙**: 고개 숙임·졸음·공부·휴대폰 같은 판단은 담지 않는다.
> `approximate_head_center` 도 "위치 좌표"일 뿐 의미 부여를 하지 않는다.

---

## 6. Backend 구조 설명

```
Backend 공통 계약:  initialize() / analyze_frame(rgb)->dict / shutdown() / health()
```

| 항목 | `MediaPipeBackend` (실제) | `FakeMediaPipeBackend` (테스트/데모) |
|------|---------------------------|--------------------------------------|
| 의존성 | `mediapipe`(lazy) + `.task` 모델 파일 | **없음** (numpy 입력만) |
| 모델 로드 | `initialize()` 에서 Face/Pose/Hands Landmarker 생성 | 플래그만 세팅 |
| 모델 없음 | 해당 detector 자동 비활성화, `health().loaded` 에 표시 | 해당 없음 |
| analyze_frame | 실제 추론 → per-frame Facts | **설정대로 결정적** Facts 반환 |
| 예외 시뮬 | — | `fail=True` 면 예외 → 엔진 FAILED 검증 |

**per-frame Facts 스키마(공통)**
```python
{
  "face":  {"detected": bool, "landmark_count": int, "presence_score": float, "head_center": [x,y]|None},
  "pose":  {"detected": bool, "landmark_count": int, "shoulder_visible": bool, "upper_body_visible": bool},
  "hands": {"detected": bool, "count": int, "landmark_count": int, "left": bool, "right": bool},
}
```
엔진은 이 스키마만 알면 되므로 backend 를 자유롭게 교체할 수 있다(원격 추론 서버 등).

---

## 7. Face / Pose / Hands 특징 설명

### Face (FaceLandmarker)
- **추출**: 얼굴 검출 여부, 랜드마크 수(표준 468), `presence_score`, `approximate_head_center`(정규화 좌표 평균).
- **집계**: `face_visible_ratio` = 얼굴 잡힌 프레임 / valid_frames.
- **안 하는 것**: 고개 숙임/졸음/시선 판단. (각도·시선은 v0.2+ 원시 특징으로만 검토)

### Pose (PoseLandmarker)
- **추출**: 자세 검출 여부, 랜드마크 수(표준 33), `shoulder_visible`(11·12), `upper_body_visible`(0·11·12·23·24) — **원시 visibility 임계만**.
- **집계**: `pose_visible_ratio`, 상체/어깨 가시성 OR 집계.
- **안 하는 것**: 엎드림/자리비움/앉은 자세 해석.

### Hands (HandLandmarker)
- **추출**: 손 검출 여부, 손 개수(`max_hands`), 좌/우 라벨, 랜드마크 수(손당 21).
- **집계**: `hands_visible_ratio`, `avg_hand_count`, `left/right_hand_detected`.
- **안 하는 것**: 휴대폰 파지/필기/턱 괴기 판단. (객체는 향후 YOLO 담당)

> 세 detector 모두 **"무엇이 보이는가"** 까지만. **"그래서 무엇을 하는가"** 는 Rule Engine.

---

## 8. 테스트 결과

`python test_mediapipe_engine.py` (실제 mediapipe·모델 파일 **없이** 실행):

```
PASS init/analyze: MediaPipeResult/AnalysisResult, activity=UNKNOWN
PASS metadata: face/pose/hands detected 가 metadata 에 반영
PASS skipped: 분석 가능한 프레임 없음 → SKIPPED
PASS failed: backend 예외 → FAILED
PASS sampling: sample_every_n_frames + max_analyzed_frames 적용
PASS disabled: enabled_detectors 비활성화 반영
PASS registry: create_engine('mediapipe') 동작
PASS intact: dummy/opencv/mediapipe 등록 유지(dummy 동작)

ALL PASS: init / metadata / skipped / failed / sampling / disabled / registry / intact
```

**데모** `python mediapipe_demo.py --fake`:
```
===== MediaPipeResult (원자적 특징만) =====
  seat=Seat1 frame_count=6 analyzed_frames=3 valid_frames=3
  face_detected=True (3) pose_detected=True (3) hands_detected=True (3) max_hands=2
  quality_score=1.0
  head_features={'face_visible_ratio': 1.0, 'approximate_head_center': [0.5, 0.45], 'face_landmark_count': 468.0, 'face_presence_score': 1.0}
  hand_features={'hands_visible_ratio': 1.0, 'left_hand_detected': True, 'right_hand_detected': True, 'avg_hand_count': 2.0, 'hand_landmark_count': 42.0}
  pose_features={'pose_visible_ratio': 1.0, 'shoulder_visible': True, 'upper_body_visible': True, 'pose_landmark_count': 33.0}
===== AnalysisResult =====
  status=SUCCESS activity=UNKNOWN confidence(=추출품질)=1.0 proc=2.21ms
  scores={'quality_score': 1.0, 'face_visible_ratio': 1.0, 'hands_visible_ratio': 1.0, 'pose_visible_ratio': 1.0}
  detector_status={'face': True, 'pose': True, 'hands': True} model_paths_loaded={'face': True, 'pose': True, 'hands': True}
```

**회귀 확인**
- 새 모듈 import 시 `cv2`/`mediapipe` 가 로드되지 않음(`sys.modules` 확인 통과).
- `engine_registry.available_engines()` → `['dummy', 'mediapipe', 'opencv']`.
- `AIManager.load_engine('mediapipe', backend=Fake)` 정상.
- `test_scheduler_engine.py` 등 기존 비-cv2 테스트 정상.

---

## 9. 남은 기술부채

1. **실제 backend 미검증**: `mediapipe`/모델 파일이 환경에 없어 `MediaPipeBackend` 의 실제 추론 경로는 코드 리뷰 수준까지만 확인됨. 실제 모델로 통합 테스트 필요.
2. **MediaPipe Tasks API 호환성**: `FaceLandmarkerOptions` 등 인자 이름은 현재 API 기준. 버전에 따라 `IMAGE`/`VIDEO` running_mode, blendshapes 옵션 등 조정 필요.
3. **품질 점수 단순화**: `quality_score` 가 "가시 비율 평균"이라 실제 landmark 신뢰도(visibility/presence 분포)를 충분히 반영하지 못함.
4. **블러 검증 생략**: cv2 의존 회피를 위해 엔진 검증에서 blur 체크를 뺐음(밝기만). OpenCVEngine 의 품질 결과(VisionResult)와 파이프라인 연계 미구현.
5. **ROI 미연동 기본값**: `apply_roi=False` 기본. OpenCVEngine 의 `roi.yaml` 재사용은 설계만 되어 있고 실사용 검증 안 됨.
6. **단일 인물 가정**: `max_faces=1`. 좌석당 1인 가정이라 다인 프레임 처리 정책 없음.
7. **시간/좌표 정규화**: `head_center` 가 정규화 좌표(0~1)라 ROI/원본 좌표계 변환 규약이 아직 없음.
8. **성능**: 프레임마다 `detect()`(IMAGE 모드) 호출 — 다좌석 동시에는 VIDEO 모드/배치/스레드 풀 필요.

---

## 10. v0.2 개선계획

1. **실제 모델 통합 테스트**: `models/*.task` + `pip install mediapipe` 환경에서 `--real` E2E 검증, CI 에 옵셔널 잡 추가.
2. **OpenCV ↔ MediaPipe 파이프라인 연계**: OpenCVEngine 의 검증 통과 프레임/ROI(VisionResult)를 MediaPipeEngine 입력으로 직접 전달(이중 검증 제거).
3. **풍부한 원시 특징(여전히 해석 X)**: 목/어깨 각도, 눈/입 개폐 비율(EAR/MAR), 손-얼굴 근접도 등을 **수치로만** 저장 → Rule Engine 재료 확충.
4. **품질 점수 고도화**: visibility/presence 분포 기반 `quality_score`, 좌석/조명별 캘리브레이션.
5. **VIDEO running_mode + 타임스탬프**: 프레임 timestamp 활용한 트래킹, 다좌석 배치 추론으로 처리량 개선.
6. **YOLO Engine v0.1 준비**: 휴대폰 등 객체 검출 엔진 인터페이스 정의(같은 AIEngine 계약) — MediaPipe(자세/손) + YOLO(객체) Facts 통합 스키마 설계.
7. **Rule Engine v0.1 설계 착수**: MediaPipe+YOLO Facts → 행동(공부/휴대폰/수면/자리비움) 판별 규칙. **이때 처음으로 activity 가 UNKNOWN 이 아니게 됨.**
8. **좌표계 규약**: 정규화↔원본↔ROI 좌표 변환 유틸 + 다인 프레임 정책.

> v0.1 범위 재확인: **특징 추출까지만.** 행동 판별/YOLO/Rule Engine/Supabase/대시보드는 다음 단계.
