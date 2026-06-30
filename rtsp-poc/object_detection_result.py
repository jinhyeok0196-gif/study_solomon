"""
ObjectDetectionResult
=====================

YOLO Object Engine 이 BurstPackage 에서 추출한 **객체 관련 원자적 특징(Facts)** 묶음.

여기에는 "어떤 객체가 어디에 보였는가" 까지만 담는다.
"휴대폰을 사용 중이다 / 공부 중이다" 같은 **최종 행동 판별은 절대 하지 않는다**(Rule Engine 의 일).

이 모듈은 OpenCV / YOLO 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class ObjectDetectionResult:
    object_uuid: str

    # ----- 프레임 카운트 -----
    frame_count: int                 # BurstPackage 입력 프레임 수
    analyzed_frames: int             # 샘플링/상한 적용 후 분석 대상 프레임 수
    valid_frames: int                # 검증 통과(=YOLO 에 들어간) 프레임 수

    # ----- 검출된 객체 원본 목록(프레임별) -----
    detected_objects: List[Dict[str, Any]] = field(default_factory=list)
    # 표준 라벨 → 총 검출 인스턴스 수
    object_counts: Dict[str, int] = field(default_factory=dict)
    max_person_count: int = 0        # 한 프레임에서 동시에 잡힌 사람 최대 수

    # ----- 표준 객체별 검출 여부 / 검출 프레임 수 -----
    phone_detected: bool = False
    phone_detection_count: int = 0
    book_detected: bool = False
    book_detection_count: int = 0
    laptop_detected: bool = False
    laptop_detection_count: int = 0
    tablet_detected: bool = False
    tablet_detection_count: int = 0
    person_detected: bool = False
    person_detection_count: int = 0

    # ----- 신뢰도 통계 -----
    avg_detection_confidence: float = 0.0
    max_detection_confidence: float = 0.0

    # 객체 검출 "품질" 점수(0~1). 최종 행동 신뢰도가 아님.
    quality_score: float = 0.0

    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        """로그/메타데이터 임베드용 축약 dict (detected_objects 원본 목록은 제외)."""
        return {
            "object_uuid": self.object_uuid,
            "frame_count": self.frame_count,
            "analyzed_frames": self.analyzed_frames,
            "valid_frames": self.valid_frames,
            "object_counts": dict(self.object_counts),
            "max_person_count": self.max_person_count,
            "phone_detected": self.phone_detected,
            "phone_detection_count": self.phone_detection_count,
            "book_detected": self.book_detected,
            "book_detection_count": self.book_detection_count,
            "laptop_detected": self.laptop_detected,
            "laptop_detection_count": self.laptop_detection_count,
            "tablet_detected": self.tablet_detected,
            "tablet_detection_count": self.tablet_detection_count,
            "person_detected": self.person_detected,
            "person_detection_count": self.person_detection_count,
            "avg_detection_confidence": self.avg_detection_confidence,
            "max_detection_confidence": self.max_detection_confidence,
            "quality_score": self.quality_score,
        }
