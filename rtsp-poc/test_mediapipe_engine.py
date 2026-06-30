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
