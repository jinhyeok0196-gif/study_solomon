"""
AI Engine Core 테스트 (OpenCV/AI 없이).

검증:
  - Fake BurstPackage 생성
  - DummyAIEngine 분석 → AnalysisResult(activity=UNKNOWN, confidence=0, status=SUCCESS)
  - AIManager 분석 / 엔진 교체(reload, 다른 엔진 load)
  - Engine Registry (available/create/unknown)
  - 엔진 없을 때 analyze → SKIPPED, 엔진 예외 → FAILED
"""
from datetime import datetime

import engine_registry
from ai_engine import AIEngine
from ai_manager import AIManager
from analysis_result import (
    AnalysisResult, ACTIVITY_UNKNOWN,
    STATUS_SUCCESS, STATUS_FAILED, STATUS_SKIPPED,
)
from burst_package import BurstPackage
from plugins.dummy_engine import DummyAIEngine


def fake_burst(seat="Seat1"):
    now = datetime(2026, 6, 30, 9, 5)
    return BurstPackage(
        burst_uuid="burst-abc", trigger_uuid="trig-1", trigger_id="2026-06-30_P0_start",
        trigger_type="start_attendance_check", period_id="P0", period_name="0교시",
        seat_id=seat, captured_at=now, frame_count=5,
        frames=[f"{seat}-f{i}" for i in range(5)], metadata={},
    )


# 교체 검증용 fake 엔진(다른 activity)
class FakeEngine(AIEngine):
    name = "fake"

    def __init__(self, **kw):
        self._ready = False

    def initialize(self):
        self._ready = True

    def analyze(self, burst):
        return AnalysisResult(
            analysis_uuid="fake-uuid", burst_uuid=burst.burst_uuid, seat_id=burst.seat_id,
            started_at=datetime.now(), finished_at=datetime.now(), processing_time=1.0,
            confidence=0.0, status=STATUS_SUCCESS, activity="FAKE_OK", scores={}, metadata={"engine": "fake"},
        )

    def shutdown(self):
        self._ready = False

    def health(self):
        return {"name": self.name, "ready": self._ready}


def test_registry():
    assert "dummy" in engine_registry.available_engines()
    eng = engine_registry.create_engine("dummy")
    assert isinstance(eng, DummyAIEngine)
    try:
        engine_registry.create_engine("nope")
        assert False, "알 수 없는 엔진은 예외"
    except KeyError:
        pass
    print("PASS registry: available/create/unknown")


def test_dummy_engine():
    eng = DummyAIEngine()
    eng.initialize()
    assert eng.health()["ready"] is True
    res = eng.analyze(fake_burst("Seat2"))
    assert isinstance(res, AnalysisResult)
    assert res.activity == ACTIVITY_UNKNOWN and res.confidence == 0.0
    assert res.status == STATUS_SUCCESS
    assert res.seat_id == "Seat2" and res.burst_uuid == "burst-abc"
    for fld in ["analysis_uuid", "burst_uuid", "seat_id", "started_at", "finished_at",
                "processing_time", "confidence", "status", "activity", "scores", "metadata"]:
        assert hasattr(res, fld), f"필드 누락 {fld}"
    eng.shutdown()
    assert eng.health()["ready"] is False
    print("PASS dummy: AnalysisResult(UNKNOWN/0/SUCCESS) + 필드 완비")


def test_manager_and_swap():
    mgr = AIManager(engine_name="dummy")
    h = mgr.health()
    assert h["loaded"] and h["engine"] == "dummy"
    res = mgr.analyze(fake_burst())
    assert res.activity == ACTIVITY_UNKNOWN and res.status == STATUS_SUCCESS
    assert mgr.health()["analyzed"] == 1

    # reload(같은 엔진)
    mgr.reload()
    assert mgr.health()["engine"] == "dummy"

    # 엔진 교체: fake 등록 후 load
    engine_registry.register("fake", FakeEngine)
    mgr.load_engine("fake")
    res2 = mgr.analyze(fake_burst())
    assert res2.activity == "FAKE_OK", "교체된 엔진 결과여야 함"

    # 언로드 후 analyze → SKIPPED
    mgr.unload_engine()
    res3 = mgr.analyze(fake_burst())
    assert res3.status == STATUS_SKIPPED
    engine_registry.unregister("fake")
    print("PASS manager: load/analyze/reload/swap/unload(SKIPPED)")


def test_failed_path():
    class BoomEngine(AIEngine):
        name = "boom"
        def initialize(self): pass
        def analyze(self, burst): raise RuntimeError("boom")
        def shutdown(self): pass
        def health(self): return {"name": "boom"}
    engine_registry.register("boom", BoomEngine)
    mgr = AIManager(engine_name="boom")
    res = mgr.analyze(fake_burst())
    assert res.status == STATUS_FAILED and "boom" in res.metadata.get("reason", "")
    engine_registry.unregister("boom")
    print("PASS failed: 엔진 예외 → FAILED 결과")


def main():
    test_registry()
    test_dummy_engine()
    test_manager_and_swap()
    test_failed_path()
    print("\nALL PASS: registry / dummy / manager+swap / failed")


if __name__ == "__main__":
    main()
