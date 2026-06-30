"""
MediaPipeResult
===============

MediaPipe Engine 이 BurstPackage 에서 추출한 **원자적 특징(Facts)** 묶음.

여기에는 얼굴/손/자세 랜드마크의 "관측 가능한 수치"만 담는다.
공부/휴대폰/수면/자리비움 같은 **최종 행동 판별은 절대 하지 않는다**(그건 Rule Engine 의 일).
각도 등도 해석 없이 원시 특징 수준으로만 보관한다.

이 모듈은 OpenCV / MediaPipe 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class MediaPipeResult:
    mediapipe_uuid: str

    # ----- 프레임 카운트 -----
    frame_count: int                 # BurstPackage 입력 프레임 수
    analyzed_frames: int             # 실제 MediaPipe 에 넣은 프레임 수(샘플링/상한 적용 후)
    valid_frames: int                # 검증을 통과한(=분석 대상) 프레임 수

    # ----- 얼굴(Face) -----
    face_detected: bool              # 분석 프레임 중 1개 이상에서 얼굴이 잡혔는가
    face_detection_count: int        # 얼굴이 잡힌 프레임 수

    # ----- 자세(Pose) -----
    pose_detected: bool
    pose_detection_count: int

    # ----- 손(Hands) -----
    hands_detected: bool
    hand_detection_count: int        # 손이 1개 이상 잡힌 프레임 수
    max_hands: int                   # 한 프레임에서 동시에 잡힌 손의 최대 개수

    # ----- 평균 랜드마크 수(분석 프레임 기준, 미검출=0) -----
    avg_face_landmarks: float
    avg_pose_landmarks: float
    avg_hand_landmarks: float

    # ----- 원자적 특징 묶음(해석 X) -----
    head_features: Dict[str, Any] = field(default_factory=dict)
    hand_features: Dict[str, Any] = field(default_factory=dict)
    pose_features: Dict[str, Any] = field(default_factory=dict)

    # landmark 추출 "품질" 점수(0~1). 최종 행동 신뢰도가 아님.
    quality_score: float = 0.0

    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        """로그/메타데이터 임베드용 축약 dict (랜드마크 좌표 등 무거운 값 제외)."""
        return {
            "mediapipe_uuid": self.mediapipe_uuid,
            "frame_count": self.frame_count,
            "analyzed_frames": self.analyzed_frames,
            "valid_frames": self.valid_frames,
            "face_detected": self.face_detected,
            "face_detection_count": self.face_detection_count,
            "pose_detected": self.pose_detected,
            "pose_detection_count": self.pose_detection_count,
            "hands_detected": self.hands_detected,
            "hand_detection_count": self.hand_detection_count,
            "max_hands": self.max_hands,
            "avg_face_landmarks": self.avg_face_landmarks,
            "avg_pose_landmarks": self.avg_pose_landmarks,
            "avg_hand_landmarks": self.avg_hand_landmarks,
            "quality_score": self.quality_score,
        }
