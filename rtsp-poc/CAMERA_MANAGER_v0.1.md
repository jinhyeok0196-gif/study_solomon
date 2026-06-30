# CameraManager v0.1 — 구현 완료 보고 (전체 파일 목록 + 전체 코드)

> 클립보드 복붙용 문서. 전체 선택(Ctrl/Cmd+A) → 복사.

## 검증 결과 (카메라 없이 전부 통과)
- CameraManager 테스트: enabled 필터 / get_recent_frames / get_all_health / stop_all 스레드 종료
- 설정 로더: cameras.yaml 8좌석, `${SEATn_RTSP_URL}` env 치환, 미설정 좌석 placeholder 유지(비밀번호 미노출)
- manage.py CLI: `--single-seat 1 --headless --duration 3` 부팅→health 8좌석→정상 종료(exit=0), URL 마스킹
- CameraCore 회귀: 기존 테스트 PASS (camera_core.py 무수정)

---

## 전체 파일 목록

```
rtsp-poc/
├── ring_buffer.py          # [Core v0.1] FrameItem + RingBuffer (변경 없음)
├── camera_core.py          # [Core v0.1] CameraCore (변경 없음·재사용)
├── main.py                 # [Core v0.1] 단일 카메라 실행 (변경 없음)
├── camera_config.py        # [NEW] CameraConfig + cameras.yaml/json 로더
├── camera_manager.py       # [NEW] CameraManager (Seat1~8 관리)
├── manage.py               # [NEW] CameraManager 실행 CLI
├── cameras.yaml            # [NEW] Seat1~8 설정 예시
├── test_camera_manager.py  # [NEW] CameraManager 통합 테스트
├── test_camera_core.py     # [Core v0.1] (변경 없음)
├── requirements.txt        # [수정] PyYAML 추가
├── .env.example            # [수정] SEAT1~8_RTSP_URL 추가
├── README.md               # [수정] Core+Manager 통합 문서
├── CODE_REVIEW_v0.1.md     # [Core v0.1 리뷰 문서]
├── CAMERA_MANAGER_v0.1.md  # (이 문서)
└── rtsp_poc.py             # [레거시]
```

변경 없는 `camera_core.py` / `ring_buffer.py` / `main.py` 전체 코드는 `CODE_REVIEW_v0.1.md` 참고.

---

## camera_config.py
```python
"""
CameraConfig & 설정 로더
========================

카메라 목록(Seat1~Seat8)을 cameras.yaml / cameras.json 으로 관리한다.
- 민감정보(비밀번호 포함 RTSP URL)는 .env 에 두고, 설정 파일에서는 ${SEATn_RTSP_URL}
  형태의 환경변수 placeholder 로만 참조한다 → 설정 파일에 비밀번호가 남지 않는다.

이 모듈은 OpenCV 에 의존하지 않는다(테스트 용이).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from string import Template
from typing import List

log = logging.getLogger("camera_config")


@dataclass
class CameraConfig:
    """카메라 1대(=좌석 1개)의 설정."""
    seat_id: str            # 정규화된 좌석 ID. 예: "Seat1"
    name: str               # 표시 이름. 예: "1번 좌석"
    rtsp_url: str           # 환경변수 치환이 끝난 최종 RTSP URL
    enabled: bool = False   # false 면 start 대상에서 제외
    stream_type: str = "sub"  # 'main'(고해상) | 'sub'(서브, 848x480)
    memo: str = ""


def normalize_seat_id(seat) -> str:
    """1 / "1" / "Seat1" / "seat1" 등을 모두 "Seat1" 로 정규화한다."""
    s = str(seat).strip()
    low = s.lower()
    num = low[4:] if low.startswith("seat") else low
    return f"Seat{int(num)}"  # 숫자가 아니면 ValueError


def _mask_url(url: str) -> str:
    """로그용 비밀번호 마스킹(이 모듈은 camera_core 에 의존하지 않으려 별도 구현)."""
    if not url or "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.split("@", 1)
    if ":" in creds:
        creds = creds.split(":", 1)[0] + ":****"
    return f"{scheme}://{creds}@{host}"


def _expand_env(value: str) -> str:
    """문자열 안의 ${VAR} / $VAR 를 환경변수로 치환(없으면 그대로 둠)."""
    if not isinstance(value, str):
        return value
    return Template(value).safe_substitute(os.environ)


def _read_raw(path: str):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if path.endswith((".yaml", ".yml")):
        import yaml  # PyYAML (yaml 파일을 쓸 때만 필요)
        return yaml.safe_load(text)
    return json.loads(text)


def load_camera_configs(path: str) -> List[CameraConfig]:
    """
    cameras.yaml / cameras.json 을 읽어 CameraConfig 리스트로 반환한다.
    파일 구조는 최상위 `cameras:` 리스트 또는 그냥 리스트 둘 다 허용.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"카메라 설정 파일을 찾을 수 없습니다: {path}")

    raw = _read_raw(path)
    entries = raw.get("cameras", []) if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise ValueError("설정 파일의 cameras 는 리스트여야 합니다.")

    configs: List[CameraConfig] = []
    for entry in entries:
        seat = normalize_seat_id(entry["seat_id"])
        url = _expand_env(str(entry.get("rtsp_url", "")))
        enabled = bool(entry.get("enabled", False))

        if enabled and (not url or "${" in url):
            log.warning("[%s] enabled=true 이지만 rtsp_url 이 비었거나 치환되지 않았습니다: %s "
                        "(.env 에 해당 환경변수를 설정하세요)", seat, _mask_url(url))

        configs.append(CameraConfig(
            seat_id=seat,
            name=str(entry.get("name", seat)),
            rtsp_url=url,
            enabled=enabled,
            stream_type=str(entry.get("stream_type", "sub")),
            memo=str(entry.get("memo", "")),
        ))
    return configs
```

## camera_manager.py
```python
"""
CameraManager v0.1
==================

VIGI C420I 카메라 8대(Seat1~Seat8)를 관리하는 매니저.

원칙:
  - CameraCore 는 수정하지 않고 그대로 재사용한다. (CameraCore 1개 = 카메라 1대)
  - CameraManager 는 좌석(seat_id) ↔ CameraCore 인스턴스를 관리한다.
  - enabled=false 인 카메라는 시작하지 않는다.

이 단계에서 하지 않는 것: AI / MediaPipe / YOLO / Supabase / Rule Engine / 교시 Scheduler.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from camera_core import CameraCore
from camera_config import CameraConfig, normalize_seat_id
from ring_buffer import FrameItem

log = logging.getLogger("camera_manager")


class CameraManager:
    """좌석별 CameraCore 수명주기를 관리한다."""

    def __init__(self, configs: List[CameraConfig], **core_kwargs) -> None:
        # 설정 순서(Seat1..Seat8)를 보존하기 위해 dict(삽입순서) 사용
        self._configs: Dict[str, CameraConfig] = {c.seat_id: c for c in configs}
        self._cores: Dict[str, CameraCore] = {}
        self._core_kwargs = core_kwargs  # CameraCore 로 그대로 전달(status_interval 등)

    @property
    def seat_ids(self) -> List[str]:
        return list(self._configs.keys())

    # ------------------------------------------------------------- lifecycle
    def start_all(self) -> None:
        for seat, cfg in self._configs.items():
            if cfg.enabled:
                self.start_camera(seat)
            else:
                log.info("[%s] enabled=false → 시작하지 않음", seat)

    def stop_all(self) -> None:
        for seat in list(self._cores.keys()):
            self.stop_camera(seat)

    def start_camera(self, seat_id) -> Optional[CameraCore]:
        seat = normalize_seat_id(seat_id)
        cfg = self._configs.get(seat)
        if cfg is None:
            log.error("알 수 없는 seat_id: %s", seat)
            return None
        if not cfg.enabled:
            log.warning("[%s] enabled=false 라 시작하지 않습니다.", seat)
            return None
        if seat in self._cores:
            log.info("[%s] 이미 실행 중", seat)
            return self._cores[seat]

        core = CameraCore(rtsp_url=cfg.rtsp_url, name=seat, **self._core_kwargs)
        self._cores[seat] = core
        core.start()
        log.info("[%s] 시작 (%s, stream=%s)", seat, cfg.name, cfg.stream_type)
        return core

    def stop_camera(self, seat_id) -> None:
        seat = normalize_seat_id(seat_id)
        core = self._cores.pop(seat, None)
        if core is None:
            return
        core.stop()
        log.info("[%s] 정지", seat)

    # --------------------------------------------------------------- getters
    def get_camera(self, seat_id) -> Optional[CameraCore]:
        return self._cores.get(normalize_seat_id(seat_id))

    def get_latest_frame(self, seat_id) -> Optional[FrameItem]:
        core = self.get_camera(seat_id)
        return core.get_latest_frame() if core else None

    def get_recent_frames(self, seat_id, seconds: float = 3.0) -> List[FrameItem]:
        core = self.get_camera(seat_id)
        return core.get_recent_frames(seconds=seconds) if core else []

    # ---------------------------------------------------------------- health
    def get_health(self, seat_id) -> dict:
        seat = normalize_seat_id(seat_id)
        cfg = self._configs.get(seat)
        core = self._cores.get(seat)

        health = {
            "seat_id": seat,
            "name": cfg.name if cfg else None,
            "enabled": cfg.enabled if cfg else False,
            "running": core is not None,
            "connected": False,
            "fps": 0.0,
            "resolution": "0x0",
            "frames_received": 0,
            "last_frame_age": None,
            "reconnects": 0,
            "buffer_len": 0,
        }
        if core is not None:
            h = core.health()
            health.update({
                "connected": h["connected"],
                "fps": h["fps"],
                "resolution": h["resolution"],
                "frames_received": h["frames_received"],
                "last_frame_age": h["last_frame_age"],
                "reconnects": h["reconnects"],
                "buffer_len": h["buffer_len"],
            })
        return health

    def get_all_health(self) -> List[dict]:
        """설정된 모든 좌석(Seat1..Seat8)의 상태를 리스트로 반환한다."""
        return [self.get_health(seat) for seat in self._configs]
```

## manage.py
```python
"""
CameraManager v0.1 - 실행 엔트리포인트
======================================

cameras.yaml 의 Seat1~Seat8 설정으로 CameraManager 를 띄운다.

실행 예시:
  python manage.py --single-seat 1                 # Seat1 1대만
  python manage.py --all                           # enabled=true 인 전체
  python manage.py --all --headless --duration 600 # 서버 10분
  python manage.py --single-seat 1 --health-interval 5

종료: 일반 모드 q, headless 모드 Ctrl+C, 또는 --duration 도달.
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import sys
import time

# camera_core(→camera_manager) 를 cv2 보다 먼저 import 해야 FFmpeg 옵션(env)이 적용된다.
from camera_manager import CameraManager
from camera_config import load_camera_configs, normalize_seat_id
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

log = logging.getLogger("manage")

WINDOW_NAME = "Solomon CameraManager v0.1"
DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cameras.yaml")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Solomon CameraManager v0.1 (8대 카메라 관리)")
    target = p.add_mutually_exclusive_group()
    target.add_argument("--single-seat", type=int, metavar="N",
                        help="해당 좌석 1대만 실행 (예: --single-seat 1)")
    target.add_argument("--all", action="store_true",
                        help="enabled=true 인 모든 좌석 실행")
    p.add_argument("--headless", action="store_true", help="영상 창 없이 로그만 출력")
    p.add_argument("--duration", type=float, default=0.0, help="N초 후 자동 종료(0=무한)")
    p.add_argument("--health-interval", type=float, default=5.0,
                   help="get_all_health() 출력 주기(초), 기본 5")
    p.add_argument("--config", default=DEFAULT_CONFIG, help="카메라 설정 파일 경로")
    return p.parse_args()


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def print_health(mgr: CameraManager) -> None:
    log.info("===== HEALTH (%d seats) =====", len(mgr.seat_ids))
    for h in mgr.get_all_health():
        age = f"{h['last_frame_age']:.1f}s" if h["last_frame_age"] is not None else "N/A"
        log.info("  %-6s [%s] enabled=%s running=%s connected=%s fps=%.1f res=%s "
                 "frames=%d last=%s reconnects=%d buf=%d",
                 h["seat_id"], h["name"], h["enabled"], h["running"], h["connected"],
                 h["fps"], h["resolution"], h["frames_received"], age,
                 h["reconnects"], h["buffer_len"])


def make_thumb(frame, seat: str, cell=(320, 180)):
    w, h = cell
    if frame is None:
        thumb = np.zeros((h, w, 3), dtype=np.uint8)
        cv2.putText(thumb, f"{seat}: no frame", (10, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (90, 90, 90), 1, cv2.LINE_AA)
    else:
        thumb = cv2.resize(frame, (w, h))
        cv2.putText(thumb, seat, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (0, 255, 0), 2, cv2.LINE_AA)
    return thumb


def build_montage(items, cell=(320, 180)):
    """[(seat, frame|None), ...] 를 격자(montage)로 합친다."""
    n = max(1, len(items))
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    w, h = cell
    canvas = np.zeros((rows * h, cols * w, 3), dtype=np.uint8)
    for i, (seat, frame) in enumerate(items):
        r, c = divmod(i, cols)
        canvas[r * h:(r + 1) * h, c * w:(c + 1) * w] = make_thumb(frame, seat, cell)
    return canvas


def main() -> int:
    args = parse_args()
    setup_logging()
    load_dotenv()

    try:
        configs = load_camera_configs(args.config)
    except Exception as exc:
        log.error("설정 로드 실패: %s", exc)
        return 1

    mgr = CameraManager(configs, status_interval=args.health_interval)

    # 실행 대상 선택
    if args.single_seat is not None:
        mgr.start_camera(normalize_seat_id(args.single_seat))
    elif args.all:
        mgr.start_all()
    else:
        log.error("실행 대상을 지정하세요: --single-seat N 또는 --all")
        return 1

    if not any(mgr.get_camera(s) for s in mgr.seat_ids):
        log.error("실행된 카메라가 없습니다. cameras.yaml 의 enabled / .env 의 RTSP URL 을 확인하세요.")
        mgr.stop_all()
        return 1

    if not args.headless:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

    start = time.time()
    last_health = 0.0
    exit_code = 0
    try:
        while True:
            now = time.time()
            if args.duration and (now - start) >= args.duration:
                log.info("지정 실행 시간(%.0fs) 도달 - 종료", args.duration)
                break

            if now - last_health >= args.health_interval:
                print_health(mgr)
                last_health = now

            if args.headless:
                time.sleep(0.1)
            else:
                running = [s for s in mgr.seat_ids if mgr.get_camera(s)]
                items = []
                for s in running:
                    it = mgr.get_latest_frame(s)
                    items.append((s, it.frame if it is not None else None))
                if items:
                    cv2.imshow(WINDOW_NAME, build_montage(items))
                if (cv2.waitKey(1) & 0xFF) == ord("q"):
                    log.info("q 입력 - 종료합니다.")
                    break
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt - 종료합니다.")
    except Exception as exc:
        log.exception("메인 루프 예외: %s", exc)
        exit_code = 1
    finally:
        mgr.stop_all()
        if not args.headless:
            cv2.destroyAllWindows()

    log.info("프로그램 종료 (exit=%d)", exit_code)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
```

## cameras.yaml
```yaml
# =========================================================================
# CameraManager 카메라 목록 (Seat1 ~ Seat8)
# =========================================================================
# - 비밀번호 같은 민감정보는 여기 두지 않는다.
# - rtsp_url 은 ${SEATn_RTSP_URL} 환경변수 placeholder 로만 참조하고,
#   실제 URL(비밀번호 포함)은 .env 에 둔다. (.env 는 깃에 올리지 않음)
# - enabled=false 인 좌석은 시작되지 않는다.
# - 테스트는 Seat1 한 대만 enabled=true 로 두면 된다.
#
# stream_type: main(고해상도 /stream1) | sub(서브 848x480 /stream2)
# =========================================================================

cameras:
  - seat_id: Seat1
    name: "1번 좌석"
    rtsp_url: "${SEAT1_RTSP_URL}"
    enabled: true            # ← 1대 테스트: Seat1 만 true
    stream_type: sub
    memo: "출입문 쪽"

  - seat_id: Seat2
    name: "2번 좌석"
    rtsp_url: "${SEAT2_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""

  - seat_id: Seat3
    name: "3번 좌석"
    rtsp_url: "${SEAT3_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""

  - seat_id: Seat4
    name: "4번 좌석"
    rtsp_url: "${SEAT4_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""

  - seat_id: Seat5
    name: "5번 좌석"
    rtsp_url: "${SEAT5_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""

  - seat_id: Seat6
    name: "6번 좌석"
    rtsp_url: "${SEAT6_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""

  - seat_id: Seat7
    name: "7번 좌석"
    rtsp_url: "${SEAT7_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""

  - seat_id: Seat8
    name: "8번 좌석"
    rtsp_url: "${SEAT8_RTSP_URL}"
    enabled: false
    stream_type: sub
    memo: ""
```

## test_camera_manager.py
```python
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
```

## requirements.txt
```
opencv-python>=4.8.0
python-dotenv>=1.0.0
numpy>=1.24.0
PyYAML>=6.0
```

## .env.example
```bash
# =========================================================================
# 민감정보(.env) — 실제 값은 .env 에 넣고 .env 는 깃에 올리지 않는다
# =========================================================================
#
# RTSP URL 형식: rtsp://아이디:비밀번호@IP:554/스트림경로
#   - 메인 스트림(고해상도)      : /stream1
#   - 서브 스트림(848x480, 권장) : /stream2
# 비밀번호 특수문자는 URL 인코딩: @ -> %40, : -> %3A, # -> %23
#
# -------------------------------------------------------------------------
# (1) Camera Core v0.1 — 단일 카메라용 (main.py / rtsp_poc.py)
# -------------------------------------------------------------------------
RTSP_URL=rtsp://admin:YOUR_PASSWORD@192.168.219.50:554/stream2

# -------------------------------------------------------------------------
# (2) CameraManager v0.1 — 좌석별 카메라 (manage.py + cameras.yaml)
#     cameras.yaml 의 ${SEATn_RTSP_URL} 가 아래 값으로 치환된다.
#     1대 테스트면 SEAT1_RTSP_URL 만 채우고 나머지는 비워도 된다.
# -------------------------------------------------------------------------
SEAT1_RTSP_URL=rtsp://admin:YOUR_PASSWORD@192.168.219.50:554/stream2
SEAT2_RTSP_URL=
SEAT3_RTSP_URL=
SEAT4_RTSP_URL=
SEAT5_RTSP_URL=
SEAT6_RTSP_URL=
SEAT7_RTSP_URL=
SEAT8_RTSP_URL=
```

---

## 완료 조건 체크
- [x] Seat1 1대만 enabled로 실행 (cameras.yaml 기본값)
- [x] --single-seat 1 실행
- [x] --all 실행
- [x] get_all_health()로 전체 상태 확인 (8좌석 dict 리스트)
- [x] headless 실행 구조 (10분은 --duration 600)
- [x] 기존 CameraCore v0.1 미파손 (회귀 테스트 PASS, 코어 무수정)
