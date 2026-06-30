"""
OpenCV Vision 유틸
==================

프레임 품질 계산 + 전처리 공통 함수. **전처리/품질검사만** 한다(행동/사람 판별 없음).

calculate_blur / calculate_brightness / calculate_contrast / calculate_sharpness
crop_roi / resize_frame / validate_frame / bgr_to_rgb
"""

from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np


def _to_gray(img: "np.ndarray") -> "np.ndarray":
    if img.ndim == 2:
        return img
    if img.ndim == 3 and img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    if img.ndim == 3 and img.shape[2] == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    raise ValueError("지원하지 않는 프레임 형상")


def bgr_to_rgb(img: "np.ndarray") -> "np.ndarray":
    """OpenCV 기본 BGR → RGB 변환."""
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def calculate_blur(img: "np.ndarray") -> float:
    """Laplacian 분산. 값이 낮을수록 흐림(blur)."""
    return float(cv2.Laplacian(_to_gray(img), cv2.CV_64F).var())


def calculate_brightness(img: "np.ndarray") -> float:
    """그레이스케일 평균 밝기(0~255)."""
    return float(_to_gray(img).mean())


def calculate_contrast(img: "np.ndarray") -> float:
    """그레이스케일 표준편차(대비)."""
    return float(_to_gray(img).std())


def calculate_sharpness(img: "np.ndarray") -> float:
    """Sobel 그래디언트 크기 평균(선명도)."""
    g = _to_gray(img)
    gx = cv2.Sobel(g, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_64F, 0, 1, ksize=3)
    return float(np.sqrt(gx * gx + gy * gy).mean())


def crop_roi(img: "np.ndarray", roi: dict) -> "np.ndarray":
    """ROI(rectangle: x,y,w,h)로 자른다. 경계를 벗어나면 클램프. 유효하지 않으면 원본 반환."""
    if not roi:
        return img
    h, w = img.shape[:2]
    x = max(0, int(roi.get("x", 0)))
    y = max(0, int(roi.get("y", 0)))
    rw = int(roi.get("w", w))
    rh = int(roi.get("h", h))
    x2 = min(w, x + rw)
    y2 = min(h, y + rh)
    if x2 <= x or y2 <= y:
        return img
    return img[y:y2, x:x2]


def resize_frame(img: "np.ndarray", width: int, height: int) -> "np.ndarray":
    return cv2.resize(img, (width, height))


def validate_frame(
    img: Optional["np.ndarray"],
    min_brightness: float = 25.0,
    min_blur: float = 12.0,
) -> Tuple[bool, str]:
    """
    프레임 유효성 검사. (ok, reason) 반환.
    reason: "ok" | "empty" | "corrupt" | "too_dark" | "too_blurry"
    """
    if img is None:
        return False, "empty"
    if not isinstance(img, np.ndarray):
        return False, "corrupt"
    if img.size == 0:
        return False, "empty"
    if img.ndim not in (2, 3):
        return False, "corrupt"
    if img.ndim == 3 and img.shape[2] not in (3, 4):
        return False, "corrupt"
    try:
        brightness = calculate_brightness(img)
        blur = calculate_blur(img)
    except Exception:
        return False, "corrupt"
    if brightness < min_brightness:
        return False, "too_dark"
    if blur < min_blur:
        return False, "too_blurry"
    return True, "ok"
