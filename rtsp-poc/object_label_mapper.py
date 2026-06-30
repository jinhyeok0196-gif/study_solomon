"""
ObjectLabelMapper
=================

YOLO 원본 라벨(예: COCO 의 "cell phone")을 **Solomon 표준 라벨**로 정규화한다.

표준 라벨:
  phone / book / laptop / tablet / person / unknown_object

매핑 규칙은 config/yolo.yaml 의 `target_objects` 를 우선 사용하고, 없으면 기본값을 쓴다.
이 모듈은 라벨 문자열 변환만 한다(행동 판별 없음). OpenCV/YOLO 비의존.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

UNKNOWN_OBJECT = "unknown_object"

# 표준 라벨(순서 고정 — scores/카운트 순회용)
STANDARD_LABELS: List[str] = ["phone", "book", "laptop", "tablet", "person"]

# config 가 없을 때 쓰는 기본 매핑(표준 → 원본 라벨 후보들)
DEFAULT_TARGET_OBJECTS: Dict[str, Dict[str, Any]] = {
    "phone":  {"labels": ["cell phone", "phone", "mobile phone", "cellphone"]},
    "book":   {"labels": ["book"]},
    "laptop": {"labels": ["laptop"]},
    "tablet": {"labels": ["tablet", "ipad"]},
    "person": {"labels": ["person"]},
}


def _norm(s: str) -> str:
    return str(s).strip().lower()


class ObjectLabelMapper:
    def __init__(self, target_objects: Optional[Dict[str, Dict[str, Any]]] = None) -> None:
        spec = target_objects or DEFAULT_TARGET_OBJECTS
        # 원본 라벨(소문자) → 표준 라벨
        self._map: Dict[str, str] = {}
        self._standards: List[str] = []
        for std, body in spec.items():
            std_l = _norm(std)
            self._standards.append(std_l)
            for raw in (body or {}).get("labels", []) or []:
                self._map[_norm(raw)] = std_l
            # 표준 라벨 자체도 자기 자신으로 매핑
            self._map.setdefault(std_l, std_l)

    def normalize(self, source_label: str) -> str:
        """YOLO 원본 라벨 → 표준 라벨. 매칭 안 되면 'unknown_object'."""
        return self._map.get(_norm(source_label), UNKNOWN_OBJECT)

    def standard_labels(self) -> List[str]:
        """설정에 등장한 표준 라벨 목록(순서 유지)."""
        return list(self._standards)

    def known_source_labels(self) -> List[str]:
        return sorted(self._map.keys())
