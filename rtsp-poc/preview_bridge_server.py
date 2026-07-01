"""
Preview Bridge Server (v0.6-pre) — 로컬 전용 미리보기 브리지
============================================================

v0.5 에서 만든 로컬 임시 클립(`temp/previews/<Seat>/latest.mp4` + `latest.json`)을
관리자 대시보드의 "최근 5초 보기"가 재생할 수 있도록 **로컬 HTTP** 로 노출한다.

⚠️ 매우 중요(원칙):
  - **로컬 노트북 전용.** 기본 바인드는 127.0.0.1(localhost). Cloudflare 배포 화면에서는 동작하지 않아도 된다.
  - **DB(ai_rule_decisions)에 영상/이미지/프레임 바이너리를 저장하지 않는다.** 브리지는 로컬 임시 파일만 서빙.
  - 클립은 만료(expires_at) 지나면 available 로 제공하지 않는다.
  - **path traversal 방지**: seat_id 는 안전한 문자만 허용, 파일 경로는 out_root 밖으로 못 나간다.
  - **디렉터리 목록 노출 금지**(라우팅으로만 처리, SimpleHTTPRequestHandler 미사용).
  - CORS 는 로컬 개발용(localhost / 127.0.0.1)만 허용. 캐시 방지(Cache-Control: no-store).
  - service role key / .env / RTSP 원문 URL 을 절대 출력하지 않는다.
  - 학생 상태/출결/벌점/알림을 자동 변경하지 않는다(읽기 전용 보조).

엔드포인트:
  GET /health                          → {"status":"ok", ...}
  GET /api/previews/<Seat>/latest      → preview 필드 JSON(프론트가 소비)
  GET /previews/<Seat>/latest.mp4      → 임시 클립 스트리밍(video/mp4)

실행(로컬):
  python preview_bridge_server.py --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import preview_clip_capture as pc

log = logging.getLogger("preview_bridge")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

# seat_id 안전 문자만(영문/숫자/_/-) 1~32자. '/', '.', '..' 등 경로 문자 불허 → path traversal 방지.
SAFE_SEAT_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")

# 로컬 개발 origin 만 허용(localhost / 127.0.0.1, 임의 포트).
ALLOWED_ORIGIN_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


# ============================================================ 순수 로직(테스트 가능)
def is_safe_seat(seat: str) -> bool:
    return bool(seat) and bool(SAFE_SEAT_RE.match(seat))


def is_allowed_origin(origin: Optional[str]) -> bool:
    return bool(origin) and bool(ALLOWED_ORIGIN_RE.match(origin))


def resolve_clip_path(out_root: str, seat: str) -> Optional[str]:
    """seat 의 latest.mp4 절대경로. **out_root 밖으로 나가면 None**(traversal 방지)."""
    if not is_safe_seat(seat):
        return None
    _, clip_path, _ = pc.clip_paths(out_root, seat)
    root_abs = os.path.abspath(out_root)
    clip_abs = os.path.abspath(clip_path)
    # 정규화 후 반드시 out_root 하위여야 한다.
    if os.path.commonpath([root_abs, clip_abs]) != root_abs:
        return None
    return clip_abs


def build_preview_response(out_root: str, seat: str, base_url: str,
                           now: Optional[Any] = None) -> Dict[str, Any]:
    """/api/previews/<seat>/latest 응답(프론트 preview 필드).

    상태 규칙:
      - seat 불안전 → unavailable(빈 응답)
      - latest.json 없음 → unavailable
      - expires_at 지남 → expired
      - status=available 인데 mp4 없음 → unavailable
      - status=available + mp4 존재 + 미만료 → available(+clip_url)
      - 그 외 meta status 그대로(loading/error/unavailable)
    """
    resp: Dict[str, Any] = {
        "seat_id": seat,
        "preview_status": pc.STATUS_UNAVAILABLE,
        "preview_clip_url": None,
        "preview_generated_at": None,
        "preview_expires_at": None,
        "preview_duration_seconds": None,
    }
    if not is_safe_seat(seat):
        return resp

    _, _, meta_path = pc.clip_paths(out_root, seat)
    meta = pc.read_meta(meta_path)
    if not meta:
        return resp

    resp["preview_generated_at"] = meta.get("generated_at")
    resp["preview_expires_at"] = meta.get("expires_at")
    resp["preview_duration_seconds"] = meta.get("duration_seconds")

    status = str(meta.get("status") or pc.STATUS_UNAVAILABLE)
    clip_abs = resolve_clip_path(out_root, seat)
    mp4_exists = bool(clip_abs) and os.path.exists(clip_abs)

    if pc.is_expired(meta, now):
        resp["preview_status"] = pc.STATUS_EXPIRED
        return resp

    if status == pc.STATUS_AVAILABLE:
        if mp4_exists:
            resp["preview_status"] = pc.STATUS_AVAILABLE
            resp["preview_clip_url"] = f"{base_url}/previews/{seat}/latest.mp4"
        else:
            resp["preview_status"] = pc.STATUS_UNAVAILABLE
        return resp

    # loading / error / unavailable 등은 그대로 전달
    resp["preview_status"] = status
    return resp


def _parse_seat_from_path(path: str, prefix: str, suffix: str = "") -> Optional[str]:
    """'/api/previews/<seat>/latest' 또는 '/previews/<seat>/latest.mp4' 에서 seat 추출."""
    p = urlparse(path).path
    if not p.startswith(prefix) or not p.endswith(suffix):
        return None
    middle = p[len(prefix):len(p) - len(suffix)] if suffix else p[len(prefix):]
    seat = middle.strip("/")
    return seat or None


# ============================================================ HTTP 핸들러
class PreviewBridgeHandler(BaseHTTPRequestHandler):
    out_root: str = pc.DEFAULT_OUT_ROOT
    server_version = "PreviewBridge/0.6-pre"

    # --- 공통 응답 헬퍼 ---
    def _base_url(self) -> str:
        host = self.headers.get("Host") or f"{DEFAULT_HOST}:{DEFAULT_PORT}"
        return f"http://{host}"

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_status(self, code: int, text: str = "") -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    # --- 라우팅 ---
    def do_OPTIONS(self) -> None:   # CORS preflight
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/health":
            self._send_json(200, {"status": "ok", "service": "preview-bridge",
                                  "version": "0.6-pre",
                                  "note": "local admin preview only; not stored in DB"})
            return

        # /api/previews/<seat>/latest
        if path.startswith("/api/previews/") and path.endswith("/latest"):
            seat = _parse_seat_from_path(path, "/api/previews/", "/latest")
            if not seat or not is_safe_seat(seat):
                self._send_json(400, {"error": "invalid seat_id"})
                return
            self._send_json(200, build_preview_response(self.out_root, seat, self._base_url()))
            return

        # /previews/<seat>/latest.mp4
        if path.startswith("/previews/") and path.endswith("/latest.mp4"):
            seat = _parse_seat_from_path(path, "/previews/", "/latest.mp4")
            if not seat or not is_safe_seat(seat):
                self._send_status(400, "invalid seat_id")
                return
            self._serve_clip(seat)
            return

        # 그 외(디렉터리 목록 등) 전부 404
        self._send_status(404, "not found")

    def _serve_clip(self, seat: str) -> None:
        clip_abs = resolve_clip_path(self.out_root, seat)
        if not clip_abs or not os.path.exists(clip_abs):
            self._send_status(404, "clip not found")
            return
        # 만료된 클립은 서빙하지 않는다.
        _, _, meta_path = pc.clip_paths(self.out_root, seat)
        meta = pc.read_meta(meta_path)
        if meta and pc.is_expired(meta):
            self._send_status(410, "clip expired")
            return
        try:
            size = os.path.getsize(clip_abs)
            with open(clip_abs, "rb") as f:
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Accept-Ranges", "none")
                self._cors_headers()
                self.send_header("Content-Length", str(size))
                self.end_headers()
                # 청크 스트리밍(개별 프레임/이미지 저장 없음)
                while True:
                    chunk = f.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except OSError:
            self._send_status(404, "clip not found")

    # 로그를 우리 logger 로(민감정보 없이 경로만)
    def log_message(self, fmt: str, *args: Any) -> None:
        log.info("%s - %s", self.address_string(), fmt % args)


# ============================================================ 서버 팩토리 / CLI
def make_server(host: str, port: int, out_root: str) -> ThreadingHTTPServer:
    handler = type("BoundPreviewBridgeHandler", (PreviewBridgeHandler,),
                   {"out_root": out_root})
    return ThreadingHTTPServer((host, port), handler)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Preview Bridge Server v0.6-pre (로컬 전용)")
    p.add_argument("--host", default=DEFAULT_HOST, help="바인드 호스트(기본 127.0.0.1=localhost)")
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"포트(기본 {DEFAULT_PORT})")
    p.add_argument("--out-root", default=pc.DEFAULT_OUT_ROOT, help="preview 루트(temp/previews)")
    return p.parse_args(argv)


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def main(argv=None) -> int:
    args = parse_args(argv)
    setup_logging()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        log.warning("[bridge] host=%s (로컬 전용 권장: 127.0.0.1). 외부 노출 주의.", args.host)
    srv = make_server(args.host, args.port, args.out_root)
    print(f"[preview-bridge] http://{args.host}:{args.port}  (로컬 관리자 확인용 · DB 미저장)")
    print(f"  GET /health")
    print(f"  GET /api/previews/<Seat>/latest")
    print(f"  GET /previews/<Seat>/latest.mp4")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[preview-bridge] 종료")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
