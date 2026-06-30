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
