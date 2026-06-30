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
