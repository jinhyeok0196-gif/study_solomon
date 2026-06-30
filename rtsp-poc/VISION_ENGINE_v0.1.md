# OpenCV Vision Engine v0.1 — 구현 완료 리뷰 (복붙용)

> 클립보드 복붙용. 전체 선택(Ctrl/Cmd+A) → 복사.
> 범위: OpenCV **전처리·품질검사·ROI** 까지. BurstPackage → VisionResult → AnalysisResult.
> **미구현(절대 추가 안 함): MediaPipe/YOLO/Rule Engine/Supabase/Dashboard/행동·사람·휴대폰 판별.**
> OpenCV 는 전처리와 품질검사만 — 향후 MediaPipe/YOLO 가 쓸 표준 입력을 만든다.

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── ring_buffer.py / camera_core.py / main.py                 # [Core] 변경 없음
├── camera_config.py / camera_manager.py / manage.py / cameras.yaml   # [Manager] 변경 없음
├── schedule_config.py / scheduler_engine.py / scheduler_demo.py / schedule.yaml  # [Scheduler] 변경 없음
├── burst_package.py / trigger_queue.py / orchestrator_engine.py / orchestrator_demo.py  # [Orchestrator] 변경 없음
├── analysis_result.py / ai_engine.py / ai_manager.py / ai_demo.py    # [AI Core] 변경 없음
├── engine_registry.py        # [수정] opencv lazy 등록 추가
├── vision_result.py          # [NEW] VisionResult
├── vision_utils.py           # [NEW] OpenCV 품질/전처리 함수
├── vision_demo.py            # [NEW] CLI 데모(--dummy/--real)
├── test_vision_engine.py     # [NEW] 테스트
├── plugins/
│   ├── __init__.py           # 변경 없음
│   ├── dummy_engine.py       # 변경 없음
│   └── opencv_engine.py      # [NEW] OpenCVEngine
├── config/
│   └── roi.yaml              # [NEW] 좌석별 ROI(Seat1~8)
├── test_*.py (camera/scheduler/orchestrator/ai)              # 변경 없음
├── requirements.txt / .env.example                           # 변경 없음
├── README.md                 # [수정] OpenCV Vision Engine 섹션 추가
├── ... (단계별 리뷰 .md)
├── VISION_ENGINE_v0.1.md     # (이 문서)
└── rtsp_poc.py               # [레거시]
```

기존 AIEngine/AIManager/Orchestrator 등 **코드 파일 무수정**. 변경은 `engine_registry.py`(opencv lazy 등록)와 README 뿐.

---

## 2. 신규 파일 전체 코드

### vision_result.py
```python
"""
VisionResult
============

OpenCV Vision Engine 의 전처리/품질검사 결과. AnalysisResult 에 임베드되어
향후 MediaPipe/YOLO 가 사용할 "표준 입력 품질" 을 표현한다.

이 모듈은 OpenCV 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class VisionResult:
    vision_uuid: str
    frame_count: int            # 입력 프레임 수
    valid_frames: int           # 검증 통과 프레임 수
    blur_score: float           # Laplacian 분산 평균(낮을수록 흐림)
    brightness: float           # 밝기 평균(0~255)
    contrast: float             # 대비(그레이 표준편차) 평균
    sharpness: float            # Sobel 그래디언트 크기 평균
    roi_applied: bool           # 좌석 ROI 가 적용됐는지
    metadata: Dict[str, Any] = field(default_factory=dict)
```

### vision_utils.py
```python
"""
OpenCV Vision 유틸
==================

프레임 품질 계산 + 전처리 공통 함수. **전처리/품질검사만** 한다(행동/사람 판별 없음).

calculate_blur / calculate_brightness / calculate_contrast / calculate_sharpness
crop_roi / resize_frame / validate_frame / bgr_to_rgb
"""

from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np


def _to_gray(img: "np.ndarray") -> "np.ndarray":
    if img.ndim == 2:
        return img
    if img.ndim == 3 and img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    if img.ndim == 3 and img.shape[2] == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    raise ValueError("지원하지 않는 프레임 형상")


def bgr_to_rgb(img: "np.ndarray") -> "np.ndarray":
    """OpenCV 기본 BGR → RGB 변환."""
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def calculate_blur(img: "np.ndarray") -> float:
    """Laplacian 분산. 값이 낮을수록 흐림(blur)."""
    return float(cv2.Laplacian(_to_gray(img), cv2.CV_64F).var())


def calculate_brightness(img: "np.ndarray") -> float:
    """그레이스케일 평균 밝기(0~255)."""
    return float(_to_gray(img).mean())


def calculate_contrast(img: "np.ndarray") -> float:
    """그레이스케일 표준편차(대비)."""
    return float(_to_gray(img).std())


def calculate_sharpness(img: "np.ndarray") -> float:
    """Sobel 그래디언트 크기 평균(선명도)."""
    g = _to_gray(img)
    gx = cv2.Sobel(g, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_64F, 0, 1, ksize=3)
    return float(np.sqrt(gx * gx + gy * gy).mean())


def crop_roi(img: "np.ndarray", roi: dict) -> "np.ndarray":
    """ROI(rectangle: x,y,w,h)로 자른다. 경계를 벗어나면 클램프. 유효하지 않으면 원본 반환."""
    if not roi:
        return img
    h, w = img.shape[:2]
    x = max(0, int(roi.get("x", 0)))
    y = max(0, int(roi.get("y", 0)))
    rw = int(roi.get("w", w))
    rh = int(roi.get("h", h))
    x2 = min(w, x + rw)
    y2 = min(h, y + rh)
    if x2 <= x or y2 <= y:
        return img
    return img[y:y2, x:x2]


def resize_frame(img: "np.ndarray", width: int, height: int) -> "np.ndarray":
    return cv2.resize(img, (width, height))


def validate_frame(
    img: Optional["np.ndarray"],
    min_brightness: float = 25.0,
    min_blur: float = 12.0,
) -> Tuple[bool, str]:
    """
    프레임 유효성 검사. (ok, reason) 반환.
    reason: "ok" | "empty" | "corrupt" | "too_dark" | "too_blurry"
    """
    if img is None:
        return False, "empty"
    if not isinstance(img, np.ndarray):
        return False, "corrupt"
    if img.size == 0:
        return False, "empty"
    if img.ndim not in (2, 3):
        return False, "corrupt"
    if img.ndim == 3 and img.shape[2] not in (3, 4):
        return False, "corrupt"
    try:
        brightness = calculate_brightness(img)
        blur = calculate_blur(img)
    except Exception:
        return False, "corrupt"
    if brightness < min_brightness:
        return False, "too_dark"
    if blur < min_blur:
        return False, "too_blurry"
    return True, "ok"
```

### plugins/opencv_engine.py
```python
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
```

### config/roi.yaml
```yaml
# 좌석별 ROI(관심영역) - OpenCV Vision Engine v0.1
# 각 좌석 프레임에서 분석할 사각형 영역(x, y, w, h, 픽셀). 서브스트림 848x480 기준 예시.
# 경계 초과 시 자동 클램프. 좌석이 없으면 ROI 미적용. 현재는 단순 Rectangle.
rois:
  Seat1: { x: 0,   y: 0,   w: 424, h: 240 }
  Seat2: { x: 424, y: 0,   w: 424, h: 240 }
  Seat3: { x: 0,   y: 240, w: 424, h: 240 }
  Seat4: { x: 424, y: 240, w: 424, h: 240 }
  Seat5: { x: 106, y: 60,  w: 320, h: 240 }
  Seat6: { x: 424, y: 60,  w: 320, h: 240 }
  Seat7: { x: 106, y: 240, w: 320, h: 180 }
  Seat8: { x: 424, y: 240, w: 320, h: 180 }
```

### vision_demo.py
```python
"""
OpenCV Vision Engine v0.1 - CLI 데모
===================================

Dummy BurstPackage(합성 프레임) 또는 실제 CameraManager 의 프레임을
OpenCVEngine 으로 전처리·품질검사하고 결과를 출력한다. **AI 판별 없음.**

실행 예시:
  python vision_demo.py --dummy --frames 6
  python vision_demo.py --real --seat 1            # cameras.yaml + 실제 카메라 필요
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

import numpy as np

from burst_package import BurstPackage
from plugins.opencv_engine import OpenCVEngine

log = logging.getLogger("vision_demo")


def parse_args():
    p = argparse.ArgumentParser(description="Solomon OpenCV Vision Engine v0.1 데모")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--dummy", action="store_true", help="합성 프레임 사용(기본)")
    mode.add_argument("--real", action="store_true", help="실제 CameraManager 사용")
    p.add_argument("--frames", type=int, default=6, help="--dummy 합성 프레임 수")
    p.add_argument("--seat", type=int, default=1, help="--real 대상 좌석 번호")
    return p.parse_args()


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def _frame(kind, seed=0):
    rng = np.random.RandomState(seed)
    if kind == "normal":
        return rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)
    if kind == "dark":
        return np.full((240, 320, 3), 5, dtype=np.uint8)
    if kind == "blur":
        return np.full((240, 320, 3), 128, dtype=np.uint8)
    return None  # corrupt/empty


class _Item:
    def __init__(self, img, ts):
        self.frame = img
        self.timestamp = ts
        self.frame_index = 0


def build_dummy(n):
    kinds = ["normal", "normal", "dark", "blur", "normal", None]
    items = []
    for i in range(n):
        k = kinds[i % len(kinds)]
        items.append(_Item(_frame(k, i) if k else None, float(i)))
    return BurstPackage(
        burst_uuid="demo", trigger_uuid="demo", trigger_id="demo_P0_x",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id="Seat1", captured_at=datetime.now(),
        frame_count=len(items), frames=items, metadata={},
    )


def build_real(seat_no):
    from camera_manager import CameraManager
    from camera_config import load_camera_configs
    from dotenv import load_dotenv
    import os, time
    load_dotenv()
    here = os.path.dirname(os.path.abspath(__file__))
    cm = CameraManager(load_camera_configs(os.path.join(here, "cameras.yaml")), status_interval=5.0)
    seat = f"Seat{seat_no}"
    cm.start_camera(seat)
    time.sleep(3.0)  # 프레임 수집 대기
    frames = cm.get_recent_frames(seat, seconds=3)
    pkg = BurstPackage(
        burst_uuid="real", trigger_uuid="real", trigger_id="real_P0_x",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )
    return cm, pkg


def main() -> int:
    args = parse_args()
    setup_logging()

    eng = OpenCVEngine()
    eng.initialize()

    cm = None
    if args.real:
        cm, pkg = build_real(args.seat)
    else:
        pkg = build_dummy(args.frames)

    res = eng.analyze(pkg)
    vr = eng.last_vision

    print("===== VisionResult =====")
    print(f"  seat={pkg.seat_id} frames={vr.frame_count} valid={vr.valid_frames} "
          f"roi_applied={vr.roi_applied} resolution={vr.metadata.get('resolution')}")
    print(f"  blur={vr.blur_score} brightness={vr.brightness} "
          f"contrast={vr.contrast} sharpness={vr.sharpness}")
    print(f"  discard_reasons={vr.metadata['discard_reasons']}")
    print("===== AnalysisResult =====")
    print(f"  status={res.status} activity={res.activity} conf={res.confidence} "
          f"proc={res.processing_time:.2f}ms discarded={res.metadata['discarded_frames']}")
    print(f"  scores={res.scores}")

    if cm is not None and hasattr(cm, "stop_all"):
        cm.stop_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### test_vision_engine.py
```python
"""
OpenCV Vision Engine 테스트.

검증:
  - vision_utils 품질 함수(blur/brightness/contrast/sharpness)
  - validate_frame: normal/dark/blur/corrupt/empty 분류
  - crop_roi: ROI 적용 및 경계 클램프
  - OpenCVEngine.analyze: VisionResult/AnalysisResult, discarded_frames, activity=UNKNOWN
  - ROI 적용 확인
"""
import numpy as np

import vision_utils as vu
from analysis_result import ACTIVITY_UNKNOWN, STATUS_SUCCESS, STATUS_SKIPPED
from vision_result import VisionResult
from burst_package import BurstPackage
from plugins.opencv_engine import OpenCVEngine
from datetime import datetime


# ---- 합성 프레임 ----------------------------------------------------------
def normal_frame(seed=0):
    rng = np.random.RandomState(seed)
    return rng.randint(40, 220, (240, 320, 3), dtype=np.uint8)  # 밝고 디테일 많음

def dark_frame():
    return np.full((240, 320, 3), 5, dtype=np.uint8)            # 너무 어두움

def blur_frame():
    return np.full((240, 320, 3), 128, dtype=np.uint8)          # 균일 → Laplacian≈0

def corrupt_frame():
    return np.zeros((240,), dtype=np.uint8)                     # 1D → 손상

def empty_frame():
    return np.array([], dtype=np.uint8)


def fake_item(img, ts=0.0):
    class _It:  # FrameItem 흉내
        pass
    it = _It(); it.frame = img; it.timestamp = ts; it.frame_index = 0
    return it


def burst(frames, seat="Seat1"):
    return BurstPackage(
        burst_uuid="b1", trigger_uuid="t1", trigger_id="2026-06-30_P0_x",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=datetime(2026, 6, 30, 9, 5),
        frame_count=len(frames), frames=frames, metadata={},
    )


def test_utils():
    assert vu.calculate_brightness(dark_frame()) < 20
    assert vu.calculate_brightness(normal_frame()) > 80
    assert vu.calculate_blur(blur_frame()) < 5, "균일 프레임은 blur 낮음"
    assert vu.calculate_blur(normal_frame()) > 50, "노이즈 프레임은 blur 높음"
    assert vu.calculate_contrast(blur_frame()) < 2
    assert vu.calculate_sharpness(normal_frame()) > vu.calculate_sharpness(blur_frame())
    print("PASS utils: blur/brightness/contrast/sharpness")


def test_validate():
    assert vu.validate_frame(normal_frame())[0] is True
    assert vu.validate_frame(dark_frame()) == (False, "too_dark")
    assert vu.validate_frame(blur_frame()) == (False, "too_blurry")
    assert vu.validate_frame(corrupt_frame()) == (False, "corrupt")
    assert vu.validate_frame(empty_frame()) == (False, "empty")
    assert vu.validate_frame(None) == (False, "empty")
    print("PASS validate: normal/dark/blur/corrupt/empty")


def test_crop_roi():
    img = normal_frame()
    cropped = vu.crop_roi(img, {"x": 10, "y": 20, "w": 100, "h": 80})
    assert cropped.shape[:2] == (80, 100), cropped.shape
    # 경계 초과 → 클램프
    clamp = vu.crop_roi(img, {"x": 300, "y": 200, "w": 999, "h": 999})
    assert clamp.shape[0] <= 40 and clamp.shape[1] <= 20
    print("PASS crop_roi: 적용 + 경계 클램프")


def test_engine_analyze():
    eng = OpenCVEngine(rois={})  # ROI 없음
    eng.initialize()
    frames = [fake_item(normal_frame(1)), fake_item(normal_frame(2)),
              fake_item(dark_frame()), fake_item(blur_frame()), fake_item(None)]
    res = eng.analyze(burst(frames))
    assert res.activity == ACTIVITY_UNKNOWN, "OpenCV 는 활동 판별 안 함"
    assert res.status == STATUS_SUCCESS
    assert res.metadata["discarded_frames"] == 3, res.metadata["discarded_frames"]
    assert res.metadata["vision"]["valid_frames"] == 2
    assert set(res.scores) == {"blur_score", "brightness", "contrast", "sharpness"}
    assert eng.last_vision.frame_count == 5 and eng.last_vision.valid_frames == 2
    print("PASS engine: VisionResult/AnalysisResult, discarded=3, activity=UNKNOWN")

    # 전부 폐기 → SKIPPED
    res2 = eng.analyze(burst([fake_item(dark_frame()), fake_item(None)]))
    assert res2.status == STATUS_SKIPPED
    print("PASS engine: 전 프레임 폐기 → SKIPPED")


def test_roi_applied():
    eng = OpenCVEngine(rois={"Seat3": {"x": 0, "y": 0, "w": 100, "h": 100}})
    eng.initialize()
    res = eng.analyze(burst([fake_item(normal_frame(3))], seat="Seat3"))
    assert res.metadata["vision"]["roi_applied"] is True
    assert eng.last_vision.roi_applied is True
    # ROI 없는 좌석
    res2 = eng.analyze(burst([fake_item(normal_frame(4))], seat="SeatX"))
    assert res2.metadata["vision"]["roi_applied"] is False
    print("PASS roi: 좌석 ROI 적용/미적용 구분")


def main():
    test_utils()
    test_validate()
    test_crop_roi()
    test_engine_analyze()
    test_roi_applied()
    print("\nALL PASS: utils / validate / crop_roi / engine / roi")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드

### engine_registry.py (opencv lazy 등록 추가분)
```python
# 기본 등록: dummy
register("dummy", DummyAIEngine)


# opencv 는 cv2 의존이 있으므로 lazy 등록(create 시점에만 import)
def _make_opencv(**kw):
    from plugins.opencv_engine import OpenCVEngine
    return OpenCVEngine(**kw)


register("opencv", _make_opencv)
```
(그 외 engine_registry.py 는 AI Engine Core v0.1 과 동일. README 는 OpenCV Vision Engine 섹션 추가.)

---

## 4. OpenCV Vision Engine 구조도

```
 BurstPackage(frames=[FrameItem…])
        │   seat_id
        ▼
 OpenCVEngine.analyze()
        │
        ├─ preprocess(burst):
        │     roi = rois.get(seat)            ← config/roi.yaml (좌석별 Rectangle)
        │     for frame in frames:
        │        img = frame.frame
        │        ok, reason = validate_frame(img)   ─ 실패 → discard_reasons[reason]++
        │        if ok:
        │           roi_img = crop_roi(img, roi)     ← ROI 있으면 crop
        │           blur/brightness/contrast/sharpness 계산(누적)
        │     → VisionResult(평균 품질, valid_frames, roi_applied, discard_reasons, timestamps)
        │
        ▼
 AnalysisResult(activity="UNKNOWN", confidence=0,
                status=SUCCESS(valid>0)|SKIPPED(valid=0),
                scores={blur,brightness,contrast,sharpness},
                metadata={vision{…}, discarded_frames, discard_reasons})
        │
        ▼
 (향후 MediaPipe/YOLO 가 검증 통과 프레임 + ROI 를 입력으로 사용)

 AIManager.load_engine("opencv")  ← dummy↔opencv 교체(코드 무수정)
 OrchestratorEngine.burst_consumer = AIManager.analyze  ← Orchestrator 무수정
```

---

## 5. VisionResult 설명

| 필드 | 의미 |
|------|------|
| `vision_uuid` | 전처리 결과 고유 id |
| `frame_count` | 입력 프레임 수 |
| `valid_frames` | 검증 통과 수 |
| `blur_score` | Laplacian 분산 평균(낮을수록 흐림) |
| `brightness` | 밝기 평균(0~255) |
| `contrast` | 그레이 표준편차 평균 |
| `sharpness` | Sobel 그래디언트 크기 평균 |
| `roi_applied` | 좌석 ROI 적용 여부 |
| `metadata` | resolution / discard_reasons / discarded_frames / timestamps / roi |

집계는 **검증 통과 프레임들의 평균**. AnalysisResult.scores 에 4개 지표가, metadata.vision 에 요약이 담긴다.

---

## 6. ROI 구조

```
config/roi.yaml:
  rois:
    Seat1: { x, y, w, h }   # 픽셀 단위 사각형
    ...
- OpenCVEngine.initialize() 가 로드(또는 생성자 rois= 로 주입).
- analyze 시 seat_id 로 ROI 조회 → 있으면 crop_roi 로 그 영역만 분석(roi_applied=True).
- 경계 초과 시 자동 클램프. 좌석에 ROI 없으면 전체 프레임(roi_applied=False).
- 현재 단순 Rectangle. (향후: 다각형/마스크/좌석 자동 캘리브레이션)
```

---

## 7. Frame Validation 설명

`validate_frame(img, min_brightness=25, min_blur=12)` → `(ok, reason)`:

| reason | 조건 |
|--------|------|
| `empty` | img None / size 0 |
| `corrupt` | ndarray 아님 / ndim·채널 비정상 / 계산 중 예외 |
| `too_dark` | 밝기 < min_brightness |
| `too_blurry` | Laplacian 분산 < min_blur |
| `ok` | 위 모두 통과 |

- 폐기 프레임은 품질 집계에서 제외.
- `AnalysisResult.metadata.discarded_frames`(개수) + `discard_reasons`(사유별 개수) 기록.
- 임계값(min_brightness/min_blur)은 엔진 생성 인자로 조절 가능.

---

## 8. 테스트 결과

### test_vision_engine.py
```
PASS utils: blur/brightness/contrast/sharpness
PASS validate: normal/dark/blur/corrupt/empty
PASS crop_roi: 적용 + 경계 클램프
PASS engine: VisionResult/AnalysisResult, discarded=3, activity=UNKNOWN
PASS engine: 전 프레임 폐기 → SKIPPED
PASS roi: 좌석 ROI 적용/미적용 구분
ALL PASS: utils / validate / crop_roi / engine / roi
```

### vision_demo.py --dummy --frames 6
```
===== VisionResult =====
  seat=Seat1 frames=6 valid=3 roi_applied=True resolution=320x240
  blur=24354.64 brightness=129.56 contrast=34.78 sharpness=151.01
  discard_reasons={'too_dark': 1, 'too_blurry': 1, 'empty': 1}
===== AnalysisResult =====
  status=SUCCESS activity=UNKNOWN conf=0.0 proc=9.64ms discarded=3
  scores={'blur_score': 24354.64, 'brightness': 129.56, 'contrast': 34.78, 'sharpness': 151.01}
```

### registry / AIManager 교체
```
available: ['dummy', 'opencv']
AIManager(engine_name='opencv') → loaded: opencv
```

### 회귀 (기존 단계 미파손)
```
test_camera_core / test_camera_manager / test_scheduler_engine /
test_orchestrator_engine / test_ai_engine / test_vision_engine  → 전부 PASS
```

### 완료 조건 체크
- [x] OpenCVEngine 동작 (전처리/품질검사)
- [x] ROI 적용 (config/roi.yaml + crop, 클램프)
- [x] Frame Validation (dark/blur/corrupt/empty 제외, discarded_frames 기록)
- [x] VisionResult 생성 / AnalysisResult 생성(activity=UNKNOWN)
- [x] 기존 AIEngine 무수정(인터페이스 그대로), registry 만 opencv lazy 추가
- [x] MediaPipe/YOLO/Rule Engine/Supabase/Dashboard/판별 **미구현**

---

## 9. 남은 기술 부채 (운영 기준)

1. **품질 임계값이 고정/전역** — min_brightness/min_blur 가 엔진 생성값. 좌석별/시간대별(야간) 적응형 임계값·자동 캘리브레이션 없음.
2. **ROI 가 정적 Rectangle** — 좌석 이동/카메라 흔들림 대응 불가. 다각형/마스크/자동 좌석 검출 없음.
3. **품질 집계가 단순 평균** — 이상치(한 프레임만 흐림) 가려짐. 분포/최댓값/프레임별 결과 미보존(타임스탬프만).
4. **frame 포맷 가정** — BGR ndarray 가정. 색공간/채널/스케일 메타 검증 없음. RGB 변환 유틸은 있으나 파이프라인에 미연결.
5. **연산 비용** — 프레임마다 Laplacian+Sobel(그레이 변환 중복). 8좌석×다프레임이면 CPU 부담. 다운샘플/샘플링/벡터화 최적화 없음.
6. **"손상" 판정이 형상 위주** — 부분 손상/코덱 아티팩트/프리징(동일 프레임 반복) 미탐지.
7. **resize_frame 미사용** — 표준 해상도 정규화가 파이프라인에 안 들어감(MediaPipe 입력 규격 통일 필요).
8. **VisionResult ↔ AnalysisResult 중복** — 품질 데이터가 양쪽에 분산. 다운스트림이 어느 쪽을 볼지 계약 불명확.
9. **타임스탬프만 보존, 프레임 자체는 안 넘김** — 다음 엔진(MediaPipe)이 "검증 통과 프레임"을 받을 표준 컨테이너가 아직 없음.
10. **테스트가 합성 프레임 위주** — 실제 RTSP 프레임/조명/노이즈 케이스 부재. pytest 아님.

---

## 10. v0.2 개선 계획

**P0 — MediaPipe/YOLO 입력 표준화**
1. **표준 프레임 컨테이너** — 검증 통과 프레임을 `resize_frame` 으로 정규 해상도+색공간(RGB) 통일해 VisionResult 에 담아 다음 엔진에 전달.
2. **품질 임계값 적응형** — 좌석/시간대별 임계값, 자동 캘리브레이션(초기 N프레임 기준), 야간 모드.
3. **프리징/동일프레임 검출** — 프레임 간 차분으로 정지·코덱 멈춤 탐지(품질 사유 추가).

**P1 — 정확성/성능**
4. ROI 확장 — 다각형/마스크, 좌석 자동 검출/보정.
5. 연산 최적화 — 다운샘플 후 계산, 그레이 1회 변환 공유, 샘플링(전 프레임 대신 일부).
6. 품질 통계 — 평균+분산+최악프레임, 프레임별 결과 옵션 보존.

**P2 — 연결(다음 단계)**
7. **MediaPipeEngine/YOLOEngine 플러그인**(별도 단계) — OpenCVEngine 산출(정규화 프레임/ROI)을 입력으로. 동일 AIEngine 인터페이스, AIManager/Orchestrator 무수정.
8. pytest 전환 + 실제 RTSP 프레임 픽스처, CI.

> 경계: v0.2 까지도 **행동/사람/휴대폰 판별·Rule Engine·Supabase·대시보드는 미구현**. "표준 입력 생성"의 견고화까지만.
