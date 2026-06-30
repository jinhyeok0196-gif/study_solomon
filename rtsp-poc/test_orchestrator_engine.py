"""
OrchestratorEngine 테스트 (카메라/AI 없이, Fake Scheduler/CameraManager).

검증:
  - TriggerQueue 동작(enqueue/dequeue/peek/clear/size/overflow)
  - BurstPackage 생성
  - Worker Thread 동작(start/stop)
  - Retry (실패 후 성공 / 영구 실패 → Error Queue)
  - Queue Overflow
  - Multi Seat (["all"] → 여러 좌석)
  - 정상 종료(스레드 join)
"""
import time
from datetime import datetime

from schedule_config import TriggerEvent
from trigger_queue import TriggerQueue
from orchestrator_engine import OrchestratorEngine


# ----------------------------------------------------------------- fakes
class FakeScheduler:
    """record=True 호출 시 보류 트리거를 1회만 방출(=dedup 흉내)."""
    def __init__(self, triggers=None):
        self._pending = list(triggers or [])

    def add(self, ev):
        self._pending.append(ev)

    def get_due_triggers(self, now=None, record=True):
        if not record:
            return list(self._pending)
        out, self._pending = self._pending, []
        return out


class FakeCameraManager:
    def __init__(self, seats, fail_times=None, frames_per_seat=5):
        self.seats = list(seats)
        self.fail_times = dict(fail_times or {})  # seat -> 남은 실패 횟수
        self.frames_per_seat = frames_per_seat

    def get_all_health(self):
        return [{"seat_id": s, "running": True, "enabled": True} for s in self.seats]

    def get_recent_frames(self, seat_id, seconds=3):
        rem = self.fail_times.get(seat_id, 0)
        if rem > 0:
            self.fail_times[seat_id] = rem - 1
            return []  # 실패(빈 결과)
        return [f"{seat_id}-frame{i}" for i in range(self.frames_per_seat)]


def mk_trigger(ttype="start_attendance_check", target=None):
    return TriggerEvent(
        trigger_id=f"2026-06-30_P0_{ttype}",
        period_id="P0", period_name="0교시",
        trigger_type=ttype,
        scheduled_time=datetime(2026, 6, 30, 9, 5),
        reason="테스트",
        target_seats=target or ["all"],
    )


def test_queue():
    q = TriggerQueue(max_size=3)
    assert q.size() == 0 and q.peek() is None
    assert q.enqueue("a") and q.enqueue("b")
    assert q.size() == 2 and q.peek() == "a"
    assert q.dequeue() == "a" and q.size() == 1
    # overflow
    assert q.enqueue("c") and q.enqueue("d")  # now b,c,d = 3
    assert q.enqueue("e") is False, "가득 차면 False"
    assert q.dropped == 1
    q.clear()
    assert q.size() == 0
    assert q.dequeue(timeout=0) is None
    print("PASS queue: enqueue/dequeue/peek/clear/size/overflow")


def test_burst_and_multiseat():
    sch = FakeScheduler([mk_trigger(target=["all"])])
    cm = FakeCameraManager(["Seat1", "Seat2", "Seat3"])
    orch = OrchestratorEngine(sch, cm, max_retries=2, retry_delay=0)
    pkgs = orch.process_once(now=datetime(2026, 6, 30, 9, 5))
    seats = sorted(p.seat_id for p in pkgs)
    print("multiseat pkgs:", seats)
    assert seats == ["Seat1", "Seat2", "Seat3"], "['all'] → 3좌석"
    p = pkgs[0]
    for fld in ["burst_uuid", "trigger_uuid", "trigger_id", "trigger_type",
                "period_id", "period_name", "seat_id", "captured_at",
                "frame_count", "frames", "metadata"]:
        assert hasattr(p, fld), f"필드 누락 {fld}"
    assert p.frame_count == 5 and len(p.frames) == 5
    assert p.metadata["attempts"] == 1
    assert "queue_delay_ms" in p.metadata and "processing_ms" in p.metadata
    print("PASS burst+multiseat: BurstPackage 생성/필드/멀티좌석")


def test_retry():
    # Seat1: 2회 실패 후 성공(attempts=3), Seat2: 영구 실패 → Error Queue
    sch = FakeScheduler([mk_trigger(target=["Seat1", "Seat2"])])
    cm = FakeCameraManager(["Seat1", "Seat2"], fail_times={"Seat1": 2, "Seat2": 99})
    orch = OrchestratorEngine(sch, cm, max_retries=2, retry_delay=0)
    pkgs = orch.process_once(now=datetime(2026, 6, 30, 9, 5))
    by_seat = {p.seat_id: p for p in pkgs}
    assert "Seat1" in by_seat, "Seat1 은 retry 후 성공해야 함"
    assert by_seat["Seat1"].metadata["attempts"] == 3, by_seat["Seat1"].metadata["attempts"]
    assert "Seat2" not in by_seat, "Seat2 는 실패해야 함"
    assert orch.error_queue.size() == 1, "Seat2 는 Error Queue 로"
    err = orch.error_queue.peek()
    assert err.seat_id == "Seat2" and err.attempts == 3
    print("PASS retry: 실패후성공(attempts=3) / 영구실패 → Error Queue")


def test_overflow():
    # 큐를 작게 두고, 여러 트리거를 한 번에 폴링 → 일부 드롭
    triggers = [mk_trigger(ttype=f"t{i}", target=["Seat1"]) for i in range(5)]
    for i, t in enumerate(triggers):
        t.trigger_id = f"2026-06-30_P0_t{i}"  # 유니크 id
    sch = FakeScheduler(triggers)
    cm = FakeCameraManager(["Seat1"])
    orch = OrchestratorEngine(sch, cm, max_queue_size=2, max_retries=0, retry_delay=0)
    orch._poll_once(now=datetime(2026, 6, 30, 9, 5))  # 5개 중 2개만 적재
    assert orch.queue.size() == 2, orch.queue.size()
    assert orch.queue.dropped == 3, orch.queue.dropped
    print("PASS overflow: max_queue=2 에서 5개 중 3개 드롭")


def test_worker_thread_and_shutdown():
    sch = FakeScheduler()
    cm = FakeCameraManager(["Seat1", "Seat2"])
    orch = OrchestratorEngine(sch, cm, poll_interval=0.1, max_retries=0, retry_delay=0)
    orch.start()
    # 트리거를 흘려보냄 → poll 스레드가 집어서 worker 가 처리
    sch.add(mk_trigger(target=["all"]))
    time.sleep(0.6)
    st = orch.stats()
    print("worker stats:", st)
    assert st["processed"] >= 2, "두 좌석 처리되어야 함"
    orch.stop()
    assert not orch._poll_thread.is_alive(), "poll 스레드 종료"
    assert not orch._worker_thread.is_alive(), "worker 스레드 종료"
    print("PASS worker+shutdown: 스레드 처리 및 정상 종료")


def main():
    test_queue()
    test_burst_and_multiseat()
    test_retry()
    test_overflow()
    test_worker_thread_and_shutdown()
    print("\nALL PASS: queue / burst / multiseat / retry / overflow / worker / shutdown")


if __name__ == "__main__":
    main()
