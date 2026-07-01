"""
Preview Clip Capture (v0.5) — 로컬 임시 5초 미리보기 클립 생성 골격
====================================================================

관리자 대시보드의 "최근 5초 보기"를 위한 **로컬 전용** 임시 클립을 만든다.

⚠️ 매우 중요(원칙):
  - 이것은 실시간 스트리밍(WebRTC/HLS)이 아니라, **로컬에서 임시로 만든 5초 클립**이다.
  - 클립은 `temp/previews/<Seat>/latest.mp4` 같은 **임시 파일**로만 저장한다(gitignore).
  - **DB(ai_rule_decisions)에 영상/이미지/프레임 바이너리를 절대 저장하지 않는다.**
  - 클립은 만료(TTL) 기준을 갖고 자동 삭제된다(기본값: 저장 안 함 지향, 짧은 TTL).
  - RTSP URL 비밀번호는 항상 마스킹한다. service role key / .env 는 절대 출력하지 않는다.
  - 학생 상태/출결/벌점/알림/보호자 연락을 자동 변경하지 않는다.
  - 실제 카메라 캡처는 스터디카페 Wi-Fi 로컬 노트북에서만 한다(Codespaces 금지).

구조:
  - 순수 함수(경로/메타데이터/만료/마스킹)는 cv2·카메라 없이 테스트 가능.
  - 실제 캡처(capture)는 cv2 를 lazy import 하며 로컬에서만 실행된다.

메타데이터(사이드카 JSON, latest.json)가 프론트 preview 필드의 원천이다(영상 바이너리 아님):
  {
    "seat_id", "status", "generated_at", "expires_at",
    "duration_seconds", "clip_filename", "frame_count", "fps"
  }

실행 예시(로컬):
  python preview_clip_capture.py --seat Seat1 --seconds 5 --ttl 120
  python preview_clip_capture.py --cleanup            # 만료 클립 정리만
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

log = logging.getLogger("preview_clip")

DEFAULT_OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp", "previews")
DEFAULT_DURATION_SECONDS = 5.0
DEFAULT_TTL_SECONDS = 120.0          # 짧게 — 관리자 확인용, 오래 남기지 않는다
CLIP_FILENAME = "latest.mp4"
META_FILENAME = "latest.json"

# preview 상태(프론트 PreviewStatus 와 동일 어휘)
STATUS_AVAILABLE = "available"
STATUS_LOADING = "loading"
STATUS_EXPIRED = "expired"
STATUS_UNAVAILABLE = "unavailable"
STATUS_ERROR = "error"

# 메타데이터 note 문구는 **ASCII 영문**으로 고정한다.
# (Windows PowerShell 기본 인코딩(cp949 등)에서 한글이 깨지는 문제 방지 — v0.5.1)
PREVIEW_NOTE = ("admin preview only; temporary clip; not stored in DB; "
                "no automatic status change")


# ============================================================ 보안/마스킹
def mask_rtsp(url: Optional[str]) -> str:
    """RTSP URL 의 비밀번호를 마스킹. 로그/메타 어디에도 원문 URL 을 남기지 않는다."""
    if not url:
        return "(none)"
    return re.sub(r"://([^:/@]+):([^@]+)@", r"://\1:****@", url)


# ============================================================ 순수 함수(테스트 가능)
def clip_paths(out_root: str, seat: str) -> Tuple[str, str, str]:
    """(seat_dir, clip_path, meta_path). 실제 파일을 만들지는 않는다."""
    seat_dir = os.path.join(out_root, seat)
    return seat_dir, os.path.join(seat_dir, CLIP_FILENAME), os.path.join(seat_dir, META_FILENAME)


def build_metadata(seat: str, status: str, *, generated_at: datetime,
                   duration_seconds: float = DEFAULT_DURATION_SECONDS,
                   ttl_seconds: float = DEFAULT_TTL_SECONDS,
                   frame_count: int = 0, fps: float = 0.0,
                   clip_filename: Optional[str] = None) -> Dict[str, Any]:
    """프론트 preview 필드의 원천이 되는 사이드카 메타데이터(영상 바이너리 아님).

    ⚠️ 실제 파일 경로/URL 은 넣지 않는다(로컬 서빙 레이어가 결정). 파일명만 남긴다.
    """
    expires_at = generated_at + timedelta(seconds=max(0.0, float(ttl_seconds)))
    return {
        "seat_id": seat,
        "status": status,
        "generated_at": generated_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "duration_seconds": round(float(duration_seconds), 2),
        "ttl_seconds": round(float(ttl_seconds), 2),
        "frame_count": int(frame_count),
        "fps": round(float(fps), 2),
        "clip_filename": clip_filename if status == STATUS_AVAILABLE else None,
        "note": PREVIEW_NOTE,          # ASCII 영문(Windows PowerShell 인코딩 안전)
    }


def is_expired(meta: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """메타데이터 expires_at 기준 만료 여부."""
    now = now or datetime.now()
    exp = meta.get("expires_at")
    if not exp:
        return False
    try:
        return now > datetime.fromisoformat(str(exp))
    except (TypeError, ValueError):
        return False


def write_meta(meta_path: str, meta: Dict[str, Any]) -> None:
    """사이드카 메타 JSON 저장.

    encoding="utf-8" 명시 + ensure_ascii=True 로 **파일을 순수 ASCII** 로 만든다.
    → Windows PowerShell 기본 인코딩(cp949 등)에서도 깨지지 않는다(v0.5.1).
    """
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=True, indent=2)


def read_meta(meta_path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ============================================================ Capturer
class PreviewClipCapturer:
    """로컬 RTSP → 최근 N초 임시 클립(mp4) + 사이드카 메타 생성. 자동 만료/삭제."""

    def __init__(self, seat: str = "Seat1", out_root: str = DEFAULT_OUT_ROOT,
                 duration_seconds: float = DEFAULT_DURATION_SECONDS,
                 ttl_seconds: float = DEFAULT_TTL_SECONDS,
                 rtsp_env: Optional[str] = None) -> None:
        self.seat = seat
        self.out_root = out_root
        self.duration_seconds = max(1.0, float(duration_seconds))
        self.ttl_seconds = max(1.0, float(ttl_seconds))
        self.rtsp_env = rtsp_env or f"{seat.upper()}_RTSP_URL"

    # ----- 만료 클립 정리(영상 오래 남기지 않기) -----
    def cleanup_expired(self) -> int:
        """out_root 아래 만료된 클립/메타를 삭제. 삭제 개수 반환."""
        removed = 0
        if not os.path.isdir(self.out_root):
            return 0
        for seat in os.listdir(self.out_root):
            _, clip_path, meta_path = clip_paths(self.out_root, seat)
            meta = read_meta(meta_path)
            if meta is not None and not is_expired(meta):
                continue
            for p in (clip_path, meta_path):
                if os.path.exists(p):
                    try:
                        os.remove(p)
                        removed += 1
                    except OSError:
                        pass
        return removed

    # ----- 실제 캡처(로컬 전용, cv2 lazy import) -----
    def capture(self) -> Dict[str, Any]:
        """RTSP 에서 최근 duration 초를 캡처해 임시 mp4 + 메타 생성.

        반환: 메타데이터 dict(status 포함). 실패해도 예외 대신 status=error 메타를 남긴다.
        ⚠️ Codespaces/내부망 밖에서는 연결 불가 → 로컬 노트북에서만 성공한다.
        """
        seat_dir, clip_path, meta_path = clip_paths(self.out_root, self.seat)
        rtsp = (os.environ.get(self.rtsp_env) or "").strip()
        if not rtsp:
            meta = build_metadata(self.seat, STATUS_UNAVAILABLE, generated_at=datetime.now(),
                                  duration_seconds=self.duration_seconds, ttl_seconds=self.ttl_seconds)
            write_meta(meta_path, meta)
            log.warning("[preview %s] RTSP URL 없음(%s) - unavailable", self.seat, self.rtsp_env)
            return meta

        log.info("[preview %s] 캡처 시도 rtsp=%s dur=%.1fs (로컬 전용)",
                 self.seat, mask_rtsp(rtsp), self.duration_seconds)
        try:
            frame_count, fps = self._capture_to_mp4(rtsp, seat_dir, clip_path)
        except Exception as exc:                 # cv2 없음/연결 실패 등
            meta = build_metadata(self.seat, STATUS_ERROR, generated_at=datetime.now(),
                                  duration_seconds=self.duration_seconds, ttl_seconds=self.ttl_seconds)
            write_meta(meta_path, meta)
            log.warning("[preview %s] 캡처 실패: %s - error", self.seat, type(exc).__name__)
            return meta

        status = STATUS_AVAILABLE if frame_count > 0 else STATUS_UNAVAILABLE
        meta = build_metadata(self.seat, status, generated_at=datetime.now(),
                              duration_seconds=self.duration_seconds, ttl_seconds=self.ttl_seconds,
                              frame_count=frame_count, fps=fps,
                              clip_filename=CLIP_FILENAME)
        write_meta(meta_path, meta)
        log.info("[preview %s] status=%s frames=%d fps=%.1f (clip=%s, 만료 %s)",
                 self.seat, status, frame_count, fps, CLIP_FILENAME, meta["expires_at"])
        return meta

    def _capture_to_mp4(self, rtsp: str, seat_dir: str, clip_path: str) -> Tuple[int, float]:
        """cv2 로 RTSP 를 열어 duration 초만큼 mp4 로 기록. (frame_count, fps).

        ⚠️ 프레임/이미지 개별 저장 없음 — mp4 임시 파일 하나만. cv2 는 여기서만 import.
        """
        import time
        import cv2  # lazy import (로컬 전용)

        os.makedirs(seat_dir, exist_ok=True)
        cap = cv2.VideoCapture(rtsp)
        if not cap.isOpened():
            raise RuntimeError("RTSP open 실패")
        fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
        if fps <= 1 or fps > 60:
            fps = 15.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(clip_path, fourcc, fps, (w, h))
        deadline = time.time() + self.duration_seconds
        count = 0
        try:
            while time.time() < deadline:
                ok, frame = cap.read()
                if not ok:
                    break
                writer.write(frame)
                count += 1
        finally:
            writer.release()
            cap.release()
        return count, float(fps)


# ============================================================ CLI
def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Preview Clip Capture v0.5 (로컬 전용)")
    p.add_argument("--seat", default="Seat1", help="대상 좌석(기본 Seat1)")
    p.add_argument("--seconds", type=float, default=DEFAULT_DURATION_SECONDS,
                   help=f"클립 길이(초, 기본 {DEFAULT_DURATION_SECONDS})")
    p.add_argument("--ttl", type=float, default=DEFAULT_TTL_SECONDS,
                   help=f"만료 시간(초, 기본 {DEFAULT_TTL_SECONDS}) - 지나면 자동 삭제 대상")
    p.add_argument("--out-root", default=DEFAULT_OUT_ROOT, help="임시 클립 루트(gitignore)")
    p.add_argument("--cleanup", action="store_true", help="만료 클립 정리만 하고 종료")
    return p.parse_args(argv)


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def main(argv=None) -> int:
    args = parse_args(argv)
    setup_logging()
    cap = PreviewClipCapturer(seat=args.seat, out_root=args.out_root,
                              duration_seconds=args.seconds, ttl_seconds=args.ttl)
    if args.cleanup:
        n = cap.cleanup_expired()
        print(f"[preview] 만료 클립 정리: {n}개 삭제")
        return 0

    removed = cap.cleanup_expired()
    if removed:
        print(f"[preview] 만료 클립 선정리: {removed}개")
    meta = cap.capture()
    # 민감정보 없이 상태만 출력
    print("===== Preview Clip =====")
    for k in ("seat_id", "status", "generated_at", "expires_at",
              "duration_seconds", "frame_count", "fps", "clip_filename"):
        print(f"  {k} = {meta.get(k)}")
    print(f"  note: {PREVIEW_NOTE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
