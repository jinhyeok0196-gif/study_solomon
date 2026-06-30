"""
SchedulerEngine 테스트 (카메라/AI 없이).

검증 항목:
  - 09:05 → start_attendance_check 발생
  - 같은 시각 재호출 시 중복 발생하지 않음 (dedup)
  - 교시 종료 5분 전 → end_attendance_check 발생
  - 점심/저녁 시간에는 trigger 발생하지 않음
  - get_current_period() / get_today_timeline() 정상
  - TriggerEvent 필드 완비
"""
from datetime import datetime, time

from schedule_config import ScheduleConfig, TriggerEvent
from scheduler_engine import SchedulerEngine

D = (2026, 6, 30)  # 고정 날짜로 결정적 테스트


def _periods():
    return [
        ScheduleConfig("arrival", "등원 확인", time(8, 40), time(9, 0), "attendance_check"),
        ScheduleConfig("P0", "0교시", time(9, 0), time(9, 50), "study_period"),
        ScheduleConfig("break1", "쉬는시간", time(9, 50), time(10, 0), "break"),
        ScheduleConfig("P1", "1교시", time(10, 0), time(10, 50), "study_period"),
        ScheduleConfig("lunch", "점심", time(11, 50), time(13, 0), "meal"),
        ScheduleConfig("P3", "3교시", time(13, 0), time(13, 50), "study_period"),
        ScheduleConfig("dinner", "저녁", time(16, 50), time(18, 0), "meal"),
    ]


def at(h, m):
    return datetime(D[0], D[1], D[2], h, m)


def main():
    eng = SchedulerEngine(periods=_periods(), target_seats=["all"],
                          enable_random=False)  # 랜덤 제외 → 결정적

    # 1) 09:05 → start_attendance_check
    due = eng.get_due_triggers(at(9, 5))
    types = [e.trigger_type for e in due]
    print("09:05 due:", types)
    assert "start_attendance_check" in types, "09:05 start_attendance_check 필요"
    start_ev = next(e for e in due if e.trigger_type == "start_attendance_check")
    assert start_ev.period_id == "P0", start_ev.period_id

    # 2) 같은 시각 재호출 → dedup (빈 결과)
    due2 = eng.get_due_triggers(at(9, 5))
    print("09:05 재호출 due:", [e.trigger_type for e in due2])
    assert due2 == [], "중복 트리거가 발생하면 안 됨"
    # 새 엔진(기록 없음)에서는 should_trigger_burst True 여야 함(peek)
    fresh = SchedulerEngine(periods=_periods(), enable_random=False)
    assert fresh.should_trigger_burst(at(9, 5)) is True
    assert "start_attendance_check" in (fresh.get_trigger_reason(at(9, 5)) or "")

    # 3) 교시 종료 5분 전(0교시 09:50 → 09:45) → end_attendance_check
    eng2 = SchedulerEngine(periods=_periods(), enable_random=False)
    due_end = eng2.get_due_triggers(at(9, 45))
    print("09:45 due:", [e.trigger_type for e in due_end])
    assert any(e.trigger_type == "end_attendance_check" for e in due_end), "end_attendance_check 필요"

    # 4) 점심/저녁 → trigger 없음
    eng3 = SchedulerEngine(periods=_periods(), enable_random=False)
    assert eng3.get_due_triggers(at(12, 0)) == [], "점심엔 트리거 없음"
    assert eng3.should_trigger_burst(at(12, 0)) is False
    assert eng3.get_due_triggers(at(17, 0)) == [], "저녁엔 트리거 없음"

    # 5) get_current_period
    assert eng3.get_current_period(at(9, 5)).period_id == "P0"
    assert eng3.get_current_period(at(12, 0)).type == "meal"
    nxt = eng3.get_next_period(at(9, 55))  # 쉬는시간 09:50-10:00, 다음 교시는 P1
    assert nxt.period_id == "P1", nxt.period_id

    # 6) get_today_timeline
    timeline = eng3.get_today_timeline()
    assert len(timeline) == len(_periods())
    assert timeline == sorted(timeline, key=lambda p: p.start_time), "시작시각 정렬"

    # 7) TriggerEvent 필드 완비
    ev = start_ev
    for fld in ["trigger_id", "period_id", "period_name", "trigger_type",
                "scheduled_time", "reason", "target_seats", "created_at"]:
        assert hasattr(ev, fld), f"필드 누락: {fld}"
    assert ev.created_at is not None and ev.target_seats == ["all"]
    assert ev.trigger_id == "2026-06-30_P0_start_attendance_check", ev.trigger_id

    # 8) mid_study_check 가 교시 중간에 생성되는지(0교시 09:00~09:50, 18분 간격)
    planned = eng3.get_planned_triggers(at(9, 0).date())
    mids = [e for e in planned if e.period_id == "P0" and e.trigger_type == "mid_study_check"]
    print("P0 mid checks:", [f"{e.scheduled_time:%H:%M}" for e in mids])
    assert len(mids) >= 1, "mid_study_check 최소 1개"

    print("\nPASS: 09:05 start / dedup / 09:45 end / meal무트리거 / current_period / timeline / 필드 모두 정상")


if __name__ == "__main__":
    main()
