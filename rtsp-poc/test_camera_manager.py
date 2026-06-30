"""
CameraManager 통합 테스트 (실제 카메라/네트워크 없이).

camera_core.cv2.VideoCapture 를 가짜로 주입해서 검증한다:
  - enabled=true 좌석만 시작되는지 (enabled=false 는 시작 안 됨)
  - get_recent_frames(seat_id, 3) 가 동작하는지
  - get_all_health() 가 좌석별 상태를 제대로 반환하는지
  - stop_all() 시 모든 스레드가 종료되는지
"""
import logging
import time

import numpy as np

import camera_core
from camera_config import CameraConfig
from camera_manager import CameraManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                    datefmt="%H:%M:%S")


class FakeCapture:
    def __init__(self, url, backend=None):
        self.url = url
        self._opened = True
        self.w, self.h = 848, 480

    def isOpened(self):
        return self._opened

    def set(self, *a, **k):
        return True

    def get(self, prop):
        if prop == camera_core.cv2.CAP_PROP_FRAME_WIDTH:
            return float(self.w)
        if prop == camera_core.cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self.h)
        return 0.0

    def read(self):
        time.sleep(1 / 30)
        return True, np.zeros((self.h, self.w, 3), dtype=np.uint8)

    def release(self):
        self._opened = False


def fake_videocapture(url, backend=None):
    return FakeCapture(url, backend)


def main():
    camera_core.cv2.VideoCapture = fake_videocapture  # 주입

    configs = [
        CameraConfig(seat_id="Seat1", name="1번", rtsp_url="rtsp://x:y@1.1.1.1/stream2",
                     enabled=True, stream_type="sub"),
        CameraConfig(seat_id="Seat2", name="2번", rtsp_url="rtsp://x:y@1.1.1.2/stream2",
                     enabled=True, stream_type="sub"),
        CameraConfig(seat_id="Seat3", name="3번", rtsp_url="rtsp://x:y@1.1.1.3/stream2",
                     enabled=False, stream_type="sub"),  # disabled
    ]

    mgr = CameraManager(configs, status_interval=1.0, reconnect_start=0.5)
    mgr.start_all()
    time.sleep(2.0)

    # 1) enabled 좌석만 시작되었는지
    assert mgr.get_camera("Seat1") is not None, "Seat1 시작되어야 함"
    assert mgr.get_camera("Seat2") is not None, "Seat2 시작되어야 함"
    assert mgr.get_camera("Seat3") is None, "Seat3(enabled=false)은 시작되면 안 됨"
    # seat_id 정규화: 정수/문자 모두 동일 좌석을 가리켜야 함
    assert mgr.get_camera(1) is mgr.get_camera("Seat1"), "seat_id 정규화"

    # 2) get_recent_frames(seat_id, 3)
    recent = mgr.get_recent_frames("Seat1", seconds=3)
    print(f"Seat1 get_recent_frames(3) -> {len(recent)}장")
    assert len(recent) > 0, "Seat1 최근 프레임 반환되어야 함"
    assert mgr.get_recent_frames("Seat3", 3) == [], "비실행 좌석은 빈 리스트"

    # 3) get_all_health()
    health = mgr.get_all_health()
    print("ALL HEALTH:")
    for h in health:
        print("  ", h)
    assert len(health) == 3, "설정된 3좌석 전부 반환"
    by_seat = {h["seat_id"]: h for h in health}
    assert by_seat["Seat1"]["running"] is True and by_seat["Seat1"]["connected"] is True
    assert by_seat["Seat1"]["frames_received"] > 0
    assert by_seat["Seat1"]["resolution"] == "848x480"
    assert by_seat["Seat3"]["enabled"] is False and by_seat["Seat3"]["running"] is False
    # 필수 키 존재 확인
    for key in ["connected", "fps", "resolution", "frames_received",
                "last_frame_age", "reconnects", "buffer_len"]:
        assert key in by_seat["Seat1"], f"health 키 누락: {key}"

    # 4) stop_all() 후 모든 스레드 종료
    cores = [mgr.get_camera("Seat1"), mgr.get_camera("Seat2")]
    mgr.stop_all()
    for core in cores:
        assert not core._capture_thread.is_alive(), "캡처 스레드 종료되어야 함"
        assert not core._monitor_thread.is_alive(), "모니터 스레드 종료되어야 함"
    assert mgr.get_camera("Seat1") is None, "stop_all 후 실행 카메라 없음"

    print("\nPASS: enabled필터 / get_recent_frames / get_all_health / stop_all 모두 정상")


if __name__ == "__main__":
    main()
