"""
VisionResult
============

OpenCV Vision Engine 의 전처리/품질검사 결과. AnalysisResult 에 임베드되어
향후 MediaPipe/YOLO 가 사용할 "표준 입력 품질" 을 표현한다.

이 모듈은 OpenCV 에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class VisionResult:
    vision_uuid: str
    frame_count: int            # 입력 프레임 수
    valid_frames: int           # 검증 통과 프레임 수
    blur_score: float           # Laplacian 분산 평균(낮을수록 흐림)
    brightness: float           # 밝기 평균(0~255)
    contrast: float             # 대비(그레이 표준편차) 평균
    sharpness: float            # Sobel 그래디언트 크기 평균
    roi_applied: bool           # 좌석 ROI 가 적용됐는지
    metadata: Dict[str, Any] = field(default_factory=dict)
