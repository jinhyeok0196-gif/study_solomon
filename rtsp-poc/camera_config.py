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
