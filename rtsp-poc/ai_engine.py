"""
AIEngine 인터페이스
==================

모든 AI 엔진(Dummy / 향후 MediaPipe / YOLO / OpenCV / VisionTransformer)이
구현해야 하는 공통 추상 인터페이스.

이 인터페이스 덕분에 AIManager 는 어떤 엔진이든 동일하게 다루고 교체할 수 있다.
이 모듈은 OpenCV / AI 라이브러리에 의존하지 않는다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from analysis_result import AnalysisResult

if TYPE_CHECKING:
    from burst_package import BurstPackage


class AIEngine(ABC):
    """모든 AI 엔진의 공통 인터페이스."""

    name: str = "base"

    @abstractmethod
    def initialize(self) -> None:
        """모델 로드 등 1회 초기화."""
        raise NotImplementedError

    @abstractmethod
    def analyze(self, burst: "BurstPackage") -> AnalysisResult:
        """BurstPackage 를 분석해 AnalysisResult 를 반환한다."""
        raise NotImplementedError

    @abstractmethod
    def shutdown(self) -> None:
        """리소스 해제."""
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict:
        """엔진 상태(준비 여부 등)."""
        raise NotImplementedError
