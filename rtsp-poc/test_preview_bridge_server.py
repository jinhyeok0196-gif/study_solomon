"""
Preview Bridge Server v0.6-pre 테스트 — 순수 로직 + 경량 HTTP 통합.

검증:
  - seat_id 안전성(path traversal 방지)
  - CORS origin 허용(localhost 계열만)
  - resolve_clip_path 가 out_root 밖으로 안 나감
  - build_preview_response: available / unavailable / expired / mp4없음
  - HTTP: /health, /api/previews/<seat>/latest, /previews/<seat>/latest.mp4, 404, traversal 400
"""
import json
import os
import tempfile
import threading
from datetime import datetime, timedelta
from urllib.request import urlopen
from urllib.error import HTTPError

import preview_clip_capture as pc
import preview_bridge_server as bs


# ---- 도우미 ---------------------------------------------------------------
def _write_available(out_root, seat="Seat1", ttl=600.0, with_mp4=True, gen=None,
                     codec="h264", browser_compatible=True, transcode_status="success",
                     codec_warning=None):
    _, clip_path, meta_path = pc.clip_paths(out_root, seat)
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    meta = pc.build_metadata(seat, pc.STATUS_AVAILABLE,
                             generated_at=gen or datetime.now(),
                             ttl_seconds=ttl, frame_count=133, fps=25.0,
                             clip_filename="latest.mp4",
                             codec=codec, browser_compatible=browser_compatible,
                             transcode_status=transcode_status, codec_warning=codec_warning)
    pc.write_meta(meta_path, meta)
    if with_mp4:
        with open(clip_path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42")   # 더미 바이트(실제 영상 아님)
    return clip_path, meta_path


# ---- 순수 로직 ------------------------------------------------------------
def test_is_safe_seat():
    for ok in ("Seat1", "Seat8", "A_1", "cam-3", "Seat10"):
        assert bs.is_safe_seat(ok), ok
    for bad in ("", "..", "../etc", "Seat/../x", "a/b", "Seat 1", "..%2f", "Seat.1", "/"):
        assert not bs.is_safe_seat(bad), bad
    print("PASS is_safe_seat: 안전 문자만 허용(traversal 방지)")


def test_is_allowed_origin():
    for ok in ("http://localhost:5173", "http://127.0.0.1:5173",
               "http://localhost:3000", "http://127.0.0.1:8765", "https://localhost"):
        assert bs.is_allowed_origin(ok), ok
    for bad in (None, "", "http://evil.com", "http://example.com:5173",
                "http://localhost.evil.com", "http://10.0.0.5:5173"):
        assert not bs.is_allowed_origin(bad), bad
    print("PASS is_allowed_origin: localhost/127.0.0.1 만 허용")


def test_resolve_clip_path_within_root():
    with tempfile.TemporaryDirectory() as d:
        p = bs.resolve_clip_path(d, "Seat1")
        assert p is not None
        assert os.path.commonpath([os.path.abspath(d), p]) == os.path.abspath(d)
        # 불안전 seat 는 None
        assert bs.resolve_clip_path(d, "../../etc") is None
        assert bs.resolve_clip_path(d, "a/b") is None
    print("PASS resolve_clip_path: out_root 밖으로 안 나감")


def test_build_preview_available():
    with tempfile.TemporaryDirectory() as d:
        _write_available(d, "Seat1")
        r = bs.build_preview_response(d, "Seat1", "http://127.0.0.1:8765")
        assert r["preview_status"] == "available"
        assert r["preview_clip_url"] == "http://127.0.0.1:8765/previews/Seat1/latest.mp4"
        assert r["preview_duration_seconds"] == 5.0
        assert r["preview_expires_at"] and r["preview_generated_at"]
    print("PASS build_preview: json+mp4 있음 → available + clip_url")


def test_build_preview_includes_codec_fields():
    with tempfile.TemporaryDirectory() as d:
        _write_available(d, "Seat1", codec="h264", browser_compatible=True,
                         transcode_status="success")
        r = bs.build_preview_response(d, "Seat1", "http://127.0.0.1:8765")
        assert r["codec"] == "h264"
        assert r["browser_compatible"] is True
        assert r["transcode_status"] == "success"
        # mp4v fallback 도 그대로 반영(browser_compatible=False + codec_warning)
        _write_available(d, "Seat2", codec="mp4v", browser_compatible=False,
                         transcode_status="ffmpeg_missing", codec_warning=pc.CODEC_WARNING)
        r2 = bs.build_preview_response(d, "Seat2", "http://127.0.0.1:8765")
        assert r2["codec"] == "mp4v" and r2["browser_compatible"] is False
        assert r2["transcode_status"] == "ffmpeg_missing"
        assert r2["codec_warning"] == pc.CODEC_WARNING
    print("PASS build_preview: codec/browser_compatible/transcode_status 반환")


def test_build_preview_unavailable_when_no_json():
    with tempfile.TemporaryDirectory() as d:
        r = bs.build_preview_response(d, "Seat1", "http://127.0.0.1:8765")
        assert r["preview_status"] == "unavailable"
        assert r["preview_clip_url"] is None
    print("PASS build_preview: json 없음 → unavailable")


def test_build_preview_expired():
    with tempfile.TemporaryDirectory() as d:
        _write_available(d, "Seat1", ttl=60.0,
                         gen=datetime.now() - timedelta(seconds=600))  # 이미 만료
        r = bs.build_preview_response(d, "Seat1", "http://127.0.0.1:8765")
        assert r["preview_status"] == "expired"
        assert r["preview_clip_url"] is None
    print("PASS build_preview: expires_at 지남 → expired")


def test_build_preview_available_status_but_no_mp4():
    with tempfile.TemporaryDirectory() as d:
        _write_available(d, "Seat1", with_mp4=False)   # 메타는 available, mp4 없음
        r = bs.build_preview_response(d, "Seat1", "http://127.0.0.1:8765")
        assert r["preview_status"] == "unavailable"
        assert r["preview_clip_url"] is None
    print("PASS build_preview: mp4 없음 → unavailable")


def test_build_preview_unsafe_seat():
    with tempfile.TemporaryDirectory() as d:
        r = bs.build_preview_response(d, "../secret", "http://127.0.0.1:8765")
        assert r["preview_status"] == "unavailable"
    print("PASS build_preview: 불안전 seat → unavailable")


# ---- HTTP 통합(경량) ------------------------------------------------------
def _run_server(out_root):
    srv = bs.make_server("127.0.0.1", 0, out_root)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    port = srv.server_address[1]
    return srv, port


def test_http_endpoints():
    with tempfile.TemporaryDirectory() as d:
        _write_available(d, "Seat1")
        srv, port = _run_server(d)
        base = f"http://127.0.0.1:{port}"
        try:
            # /health
            with urlopen(f"{base}/health") as r:
                assert r.status == 200
                h = json.loads(r.read())
                assert h["status"] == "ok"
                assert r.headers.get("Cache-Control") == "no-store"

            # /api/previews/Seat1/latest → available
            with urlopen(f"{base}/api/previews/Seat1/latest") as r:
                data = json.loads(r.read())
                assert data["preview_status"] == "available"
                assert data["preview_clip_url"].endswith("/previews/Seat1/latest.mp4")

            # /previews/Seat1/latest.mp4 → 200 video/mp4
            with urlopen(f"{base}/previews/Seat1/latest.mp4") as r:
                assert r.status == 200
                assert r.headers.get("Content-Type") == "video/mp4"
                assert r.headers.get("Cache-Control") == "no-store"
                assert len(r.read()) > 0

            # 없는 seat → api 는 unavailable(200), mp4 는 404
            with urlopen(f"{base}/api/previews/Seat2/latest") as r:
                assert json.loads(r.read())["preview_status"] == "unavailable"
            _assert_http_status(f"{base}/previews/Seat2/latest.mp4", 404)

            # traversal 시도 → 400 (안전 seat 아님)
            _assert_http_status(f"{base}/api/previews/..%2f..%2fetc/latest", 400)

            # 알 수 없는 경로 → 404 (디렉터리 목록 노출 없음)
            _assert_http_status(f"{base}/previews/", 404)
            _assert_http_status(f"{base}/", 404)
        finally:
            srv.shutdown()
            srv.server_close()
    print("PASS http: health/api/mp4/404/traversal 방지")


def _assert_http_status(url, expected):
    try:
        with urlopen(url) as r:
            got = r.status
    except HTTPError as e:
        got = e.code
    assert got == expected, f"{url} → {got} (기대 {expected})"


def test_no_db_or_student_domain_in_source():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "preview_bridge_server.py"), "r", encoding="utf-8") as f:
        src = f.read().lower()
    forbidden = ["supabase", ".insert(", ".update(", ".delete(", ".upload(",
                 "imwrite", "imsave",
                 "penalty", "attendance", "notification", "membership_status"]
    for tok in forbidden:
        assert tok not in src, f"preview_bridge_server.py 에 금지 토큰 '{tok}'"
    print("PASS no_db/student: DB·학생도메인 코드 없음")


def main():
    test_is_safe_seat()
    test_is_allowed_origin()
    test_resolve_clip_path_within_root()
    test_build_preview_available()
    test_build_preview_includes_codec_fields()
    test_build_preview_unavailable_when_no_json()
    test_build_preview_expired()
    test_build_preview_available_status_but_no_mp4()
    test_build_preview_unsafe_seat()
    test_http_endpoints()
    test_no_db_or_student_domain_in_source()
    print("\nALL PASS: safe_seat / origin / resolve / build(available,unavailable,expired,no-mp4,"
          "unsafe) / http / no_db")


if __name__ == "__main__":
    main()
