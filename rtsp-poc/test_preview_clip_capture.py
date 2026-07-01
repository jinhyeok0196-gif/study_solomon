"""
Preview Clip Capture v0.5 테스트 — cv2/카메라 없이 순수 로직만 검증.

검증:
  - clip_paths / build_metadata / is_expired / mask_rtsp
  - RTSP URL 없으면 capture() 가 status=unavailable 메타만 남기고 mp4 는 안 만든다
  - cleanup_expired: 만료 메타는 삭제, 신선한 메타는 유지
  - 소스에 DB 저장/업데이트/삭제/프레임 개별 저장/학생 도메인 코드가 없다
"""
import os
import tempfile
from datetime import datetime, timedelta

import preview_clip_capture as pc


def test_mask_rtsp():
    assert pc.mask_rtsp("rtsp://admin:secret@10.0.0.1:554/stream2") \
        == "rtsp://admin:****@10.0.0.1:554/stream2"
    assert "secret" not in pc.mask_rtsp("rtsp://admin:secret@10.0.0.1:554/s")
    assert pc.mask_rtsp("") == "(none)"
    assert pc.mask_rtsp(None) == "(none)"
    print("PASS mask_rtsp: 비밀번호 마스킹")


def test_clip_paths():
    seat_dir, clip, meta = pc.clip_paths("/tmp/previews", "Seat1")
    assert seat_dir.endswith(os.path.join("previews", "Seat1"))
    assert clip.endswith("latest.mp4") and meta.endswith("latest.json")
    print("PASS clip_paths: 좌석별 임시 경로")


def test_build_metadata_available_and_expiry():
    now = datetime(2026, 7, 1, 9, 0, 0)
    m = pc.build_metadata("Seat1", pc.STATUS_AVAILABLE, generated_at=now,
                          duration_seconds=5.0, ttl_seconds=120.0,
                          frame_count=75, fps=15.0, clip_filename="latest.mp4")
    assert m["seat_id"] == "Seat1" and m["status"] == "available"
    assert m["duration_seconds"] == 5.0 and m["frame_count"] == 75
    assert m["clip_filename"] == "latest.mp4"
    # expires_at = generated + ttl
    assert m["expires_at"] == (now + timedelta(seconds=120)).isoformat()
    # 원문 경로/URL 은 메타에 없다(파일명만)
    assert "rtsp" not in str(m).lower() and "/" not in (m["clip_filename"] or "")
    print("PASS build_metadata: available + 만료시각 계산")


def test_build_metadata_non_available_has_no_filename():
    now = datetime(2026, 7, 1, 9, 0, 0)
    for st in (pc.STATUS_UNAVAILABLE, pc.STATUS_ERROR, pc.STATUS_EXPIRED, pc.STATUS_LOADING):
        m = pc.build_metadata("Seat1", st, generated_at=now)
        assert m["clip_filename"] is None, st        # 재생 불가 상태엔 파일명 없음
    print("PASS build_metadata: 비가용 상태엔 clip_filename 없음")


def test_is_expired():
    past = pc.build_metadata("Seat1", pc.STATUS_AVAILABLE,
                             generated_at=datetime.now() - timedelta(seconds=300),
                             ttl_seconds=60.0)
    fresh = pc.build_metadata("Seat1", pc.STATUS_AVAILABLE,
                              generated_at=datetime.now(), ttl_seconds=600.0)
    assert pc.is_expired(past) is True
    assert pc.is_expired(fresh) is False
    print("PASS is_expired: TTL 기준 만료 판정")


def test_capture_without_rtsp_is_unavailable_no_mp4():
    with tempfile.TemporaryDirectory() as d:
        # RTSP env 없음 보장
        os.environ.pop("SEAT1_RTSP_URL", None)
        cap = pc.PreviewClipCapturer(seat="Seat1", out_root=d)
        meta = cap.capture()
        assert meta["status"] == pc.STATUS_UNAVAILABLE
        _, clip_path, meta_path = pc.clip_paths(d, "Seat1")
        assert os.path.exists(meta_path)             # 메타는 남김
        assert not os.path.exists(clip_path)         # mp4 는 안 만듦(연결 시도 없음)
    print("PASS capture(no rtsp): unavailable + mp4 미생성")


def test_cleanup_expired():
    with tempfile.TemporaryDirectory() as d:
        cap = pc.PreviewClipCapturer(seat="Seat1", out_root=d)
        _, clip_path, meta_path = pc.clip_paths(d, "Seat1")
        os.makedirs(os.path.dirname(meta_path), exist_ok=True)
        # 만료된 메타 + 가짜 클립 파일
        expired = pc.build_metadata("Seat1", pc.STATUS_AVAILABLE,
                                    generated_at=datetime.now() - timedelta(seconds=999),
                                    ttl_seconds=60.0, clip_filename="latest.mp4")
        pc.write_meta(meta_path, expired)
        with open(clip_path, "wb") as f:
            f.write(b"\x00\x00")                     # 더미(테스트용, 실제 영상 아님)
        removed = cap.cleanup_expired()
        assert removed >= 1
        assert not os.path.exists(clip_path) and not os.path.exists(meta_path)
    print("PASS cleanup_expired: 만료 클립/메타 삭제")


def test_cleanup_keeps_fresh():
    with tempfile.TemporaryDirectory() as d:
        cap = pc.PreviewClipCapturer(seat="Seat1", out_root=d)
        _, clip_path, meta_path = pc.clip_paths(d, "Seat1")
        os.makedirs(os.path.dirname(meta_path), exist_ok=True)
        fresh = pc.build_metadata("Seat1", pc.STATUS_AVAILABLE,
                                  generated_at=datetime.now(), ttl_seconds=600.0,
                                  clip_filename="latest.mp4")
        pc.write_meta(meta_path, fresh)
        with open(clip_path, "wb") as f:
            f.write(b"\x00\x00")
        assert cap.cleanup_expired() == 0
        assert os.path.exists(clip_path) and os.path.exists(meta_path)
    print("PASS cleanup_keeps_fresh: 만료 안 된 클립 유지")


def test_no_db_or_student_domain_in_source():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "preview_clip_capture.py"), "r", encoding="utf-8") as f:
        src = f.read().lower()
    # DB 저장/수정/삭제, 프레임 개별 저장, 학생 도메인 자동 변경 코드가 없어야 한다
    forbidden = ["supabase", ".insert(", ".update(", ".delete(", ".upload(",
                 "imwrite", "imsave",
                 "penalty", "attendance", "notification", "membership_status"]
    for tok in forbidden:
        assert tok not in src, f"preview_clip_capture.py 에 금지 토큰 '{tok}'"
    # 영상은 mp4 임시 파일로만(VideoWriter), 개별 이미지 저장 없음
    assert "videowriter" in src
    print("PASS no_db/student: DB·프레임개별저장·학생도메인 코드 없음")


def main():
    test_mask_rtsp()
    test_clip_paths()
    test_build_metadata_available_and_expiry()
    test_build_metadata_non_available_has_no_filename()
    test_is_expired()
    test_capture_without_rtsp_is_unavailable_no_mp4()
    test_cleanup_expired()
    test_cleanup_keeps_fresh()
    test_no_db_or_student_domain_in_source()
    print("\nALL PASS: mask / paths / metadata / expiry / capture(no-rtsp) / "
          "cleanup / no_db_student")


if __name__ == "__main__":
    main()
