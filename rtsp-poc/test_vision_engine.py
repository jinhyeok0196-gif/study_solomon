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
