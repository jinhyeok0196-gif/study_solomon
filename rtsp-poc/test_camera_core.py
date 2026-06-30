"""
CameraCore 통합 테스트 (실제 카메라/네트워크 없이).

camera_core.cv2.VideoCapture 를 가짜 캡처로 주입(monkeypatch)해서
캡처 스레드 / 링버퍼 적재 / health / get_recent_frames / 재연결 을 검증한다.
"""
import logging
import time

import numpy as np

import camera_core
from camera_core import CameraCore

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                    datefmt="%H:%M:%S")


class FakeCapture:
    """cv2.VideoCapture 흉내. fail_reads 동안은 read 실패 → 재연결 유도."""
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
        # 약 30fps 로 합성 프레임 생성
        time.sleep(1 / 30)
        if FAIL_READS[0] > 0:
            FAIL_READS[0] -= 1
            return False, None
        frame = np.zeros((self.h, self.w, 3), dtype=np.uint8)
        return True, frame

    def release(self):
        self._opened = False


# 전역 플래그: read 가 몇 번 실패할지 (재연결 시뮬레이션용)
FAIL_READS = [0]
OPEN_COUNT = [0]


def fake_videocapture(url, backend=None):
    OPEN_COUNT[0] += 1
    return FakeCapture(url, backend)


def main():
    camera_core.cv2.VideoCapture = fake_videocapture  # 주입

    core = CameraCore(
        rtsp_url="rtsp://admin:secret@192.168.219.50:554/stream2",
        name="testcam",
        buffer_seconds=3.0,
        max_fps=30,
        target_fps=10.0,
        max_read_failures=5,      # 테스트를 빠르게: 5회 실패면 재연결
        reconnect_start=0.5,
        status_interval=1.0,
    )
    core.start()

    # 1) 정상 수신 확인
    time.sleep(2.5)
    h = core.health()
    print("HEALTH-1:", h)
    assert h["connected"] is True, "연결 상태여야 함"
    assert h["frames_received"] > 0, "프레임이 들어와야 함"
    assert h["fps"] > 0, "FPS > 0"
    assert h["resolution"] == "848x480", h["resolution"]

    recent = core.get_recent_frames(seconds=3)
    print(f"get_recent_frames(3) -> {len(recent)}장, idx {recent[0].frame_index}~{recent[-1].frame_index}")
    assert len(recent) > 0, "최근 프레임 반환되어야 함"
    span = recent[-1].timestamp - recent[0].timestamp
    assert span <= 3.0 + 0.1, f"3초 윈도우 초과: {span}"
    assert all(r.frame.shape == (480, 848, 3) for r in recent), "프레임 형상"

    # 2) 재연결 검증: read 를 연속 실패시켜 끊김 유발
    opens_before = OPEN_COUNT[0]
    rec_before = core.health()["reconnects"]
    print(f"--- 끊김 유발 (opens={opens_before}, reconnects={rec_before}) ---")
    FAIL_READS[0] = 100  # 충분히 많이 실패 → max_read_failures(5) 초과로 재연결
    time.sleep(2.0)
    FAIL_READS[0] = 0    # 복구
    time.sleep(2.0)

    h2 = core.health()
    print("HEALTH-2:", h2)
    assert OPEN_COUNT[0] > opens_before, "재연결로 VideoCapture 가 다시 열려야 함"
    assert h2["reconnects"] > rec_before, "reconnects 카운트 증가해야 함"
    assert h2["connected"] is True, "복구 후 다시 연결 상태"
    assert h2["frames_received"] > h["frames_received"], "복구 후 프레임 계속 증가"

    # 3) 정상 종료
    core.stop()
    assert not core._capture_thread.is_alive(), "캡처 스레드 종료"
    assert not core._monitor_thread.is_alive(), "모니터 스레드 종료"

    print("\nPASS: 수신/health/get_recent_frames/재연결/정상종료 모두 정상")


if __name__ == "__main__":
    main()
