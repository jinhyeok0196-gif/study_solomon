"""
OpenCVEngine (Vision Engine v0.1)
=================================

AIEngine 인터페이스 구현체. **OpenCV 전처리/품질검사만** 한다.
행동/사람/휴대폰 판별은 절대 하지 않는다(activity 는 항상 "UNKNOWN").

흐름:
  BurstPackage → (프레임별) 검증/ROI crop/품질계산 → VisionResult → AnalysisResult

향후 MediaPipe/YOLO 가 이 표준화된 입력(VisionResult/검증 통과 프레임)을 사용한다.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Dict, List, Optional

from ai_engine import AIEngine
from analysis_result import AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_SKIPPED
from vision_result import VisionResult
import vision_utils as vu

if TYPE_CHECKING:
    from burst_package import BurstPackage

log = logging.getLogger("opencv_engine")

_DEFAULT_ROI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "config", "roi.yaml")


class OpenCVEngine(AIEngine):
    name = "opencv"

    def __init__(
        self,
        roi_path: Optional[str] = None,
        rois: Optional[Dict[str, dict]] = None,
        min_brightness: float = 25.0,
        min_blur: float = 12.0,
        **kwargs,
    ) -> None:
        self.roi_path = roi_path or _DEFAULT_ROI
        self._rois: Dict[str, dict] = dict(rois) if rois else {}
        self.min_brightness = min_brightness
        self.min_blur = min_blur
        self._ready = False
        self._analyzed = 0
        self.last_vision: Optional[VisionResult] = None

    # ----------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        if not self._rois:
            self._rois = self._load_rois(self.roi_path)
        self._ready = True
        log.info("OpenCVEngine 초기화 - ROI %d개 좌석", len(self._rois))

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
        self._ready = False

    def health(self) -> dict:
        return {"name": self.name, "ready": self._ready, "analyzed": self._analyzed,
                "roi_seats": sorted(self._rois.keys())}

    # ------------------------------------------------------------- preprocess
    def preprocess(self, burst: "BurstPackage") -> VisionResult:
        """프레임 검증 + ROI crop + 품질 계산 → VisionResult."""
        seat = getattr(burst, "seat_id", "")
        roi = self._rois.get(seat)
        frames = getattr(burst, "frames", []) or []

        blur_l: List[float] = []
        bright_l: List[float] = []
        contrast_l: List[float] = []
        sharp_l: List[float] = []
        timestamps: List[float] = []
        discard_reasons: Dict[str, int] = {}
        resolution = None

        for f in frames:
            img = getattr(f, "frame", f)   # FrameItem 이면 .frame, 아니면 그대로
            ts = getattr(f, "timestamp", None)

            ok, reason = vu.validate_frame(img, self.min_brightness, self.min_blur)
            if not ok:
                discard_reasons[reason] = discard_reasons.get(reason, 0) + 1
                continue

            if resolution is None:
                h, w = img.shape[:2]
                resolution = f"{w}x{h}"

            roi_img = vu.crop_roi(img, roi) if roi else img
            blur_l.append(vu.calculate_blur(roi_img))
            bright_l.append(vu.calculate_brightness(roi_img))
            contrast_l.append(vu.calculate_contrast(roi_img))
            sharp_l.append(vu.calculate_sharpness(roi_img))
            if ts is not None:
                timestamps.append(ts)

        def _mean(xs: List[float]) -> float:
            return float(sum(xs) / len(xs)) if xs else 0.0

        valid = len(blur_l)
        vr = VisionResult(
            vision_uuid=uuid.uuid4().hex,
            frame_count=len(frames),
            valid_frames=valid,
            blur_score=round(_mean(blur_l), 2),
            brightness=round(_mean(bright_l), 2),
            contrast=round(_mean(contrast_l), 2),
            sharpness=round(_mean(sharp_l), 2),
            roi_applied=roi is not None,
            metadata={
                "seat_id": seat,
                "roi": roi,
                "resolution": resolution,
                "discard_reasons": discard_reasons,
                "discarded_frames": len(frames) - valid,
                "timestamps": timestamps,
            },
        )
        self.last_vision = vr
        return vr

    # ------------------------------------------------------------- analyze
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        started = datetime.now()
        vr = self.preprocess(burst)
        finished = datetime.now()
        self._analyzed += 1

        status = STATUS_SUCCESS if vr.valid_frames > 0 else STATUS_SKIPPED
        return AnalysisResult(
            analysis_uuid=uuid.uuid4().hex,
            burst_uuid=getattr(burst, "burst_uuid", ""),
            seat_id=getattr(burst, "seat_id", ""),
            started_at=started,
            finished_at=finished,
            processing_time=(finished - started).total_seconds() * 1000.0,
            confidence=0.0,                 # 전처리 단계 - 판별 없음
            status=status,
            activity=ACTIVITY_UNKNOWN,      # OpenCV 는 활동 판별 안 함
            scores={
                "blur_score": vr.blur_score,
                "brightness": vr.brightness,
                "contrast": vr.contrast,
                "sharpness": vr.sharpness,
            },
            metadata={
                "engine": self.name,
                "vision": {
                    "vision_uuid": vr.vision_uuid,
                    "frame_count": vr.frame_count,
                    "valid_frames": vr.valid_frames,
                    "roi_applied": vr.roi_applied,
                    "resolution": vr.metadata.get("resolution"),
                },
                "discarded_frames": vr.metadata["discarded_frames"],
                "discard_reasons": vr.metadata["discard_reasons"],
            },
        )
