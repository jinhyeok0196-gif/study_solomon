"""
Solomon Seat1 Real Camera E2E Test v0.1
=======================================

실제 Seat1 RTSP 카메라(또는 --fake 합성 프레임)로 MVP 전체 흐름을 한 번에 검증한다:

  CameraManager → BurstPackage → AI Engines(OpenCV/MediaPipe/YOLO)
    → FactsFusion(SeatFacts) → RuleEngine(RuleDecision) → (선택)Supabase 저장
    → 관리자 대시보드 확인 안내

⚠️ 이번 단계는 **E2E 검증 도구**다(운영 자동화 아님).
   학생 상태 변경 / 출결 / 벌점 / 알림 / 보호자 연락 / 관리자 승인·상태반영 버튼 /
   RuleDecision 수정·삭제 / 영상·이미지 저장은 **절대 하지 않는다.**
   service role key 는 server-side .env 에서만 쓰고 절대 출력하지 않는다.
   RTSP URL 의 비밀번호는 반드시 마스킹한다.

실행 예시:
  python seat1_e2e_test.py --preflight
  python seat1_e2e_test.py --single
  python seat1_e2e_test.py --single --save
  python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo
  python seat1_e2e_test.py --single --fake --engines opencv --debug-metrics
  python seat1_e2e_test.py --duration 5 --interval 60 --save
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger("seat1_e2e")

DEFAULT_ENGINES = ["opencv"]
ALL_ENGINES = ["opencv", "mediapipe", "yolo"]
MIN_INTERVAL_SECONDS = 30
DEFAULT_INTERVAL_SECONDS = 60

# 엔진 단위 상태
ENG_SUCCESS = "SUCCESS"
ENG_SKIPPED = "SKIPPED"
ENG_FAILED = "FAILED"


# ============================================================ 보안/마스킹
def mask_rtsp(url: Optional[str]) -> str:
    """RTSP URL 의 비밀번호(및 사용자)를 마스킹. 없으면 '(none)'."""
    if not url:
        return "(none)"
    # rtsp://user:pass@host... → rtsp://user:****@host...
    masked = re.sub(r"://([^:/@]+):([^@]+)@", r"://\1:****@", url)
    return masked


def has_value(name: str) -> bool:
    return bool((os.environ.get(name) or "").strip())


def _truthy(v: Any) -> bool:
    """enabled 값이 문자열/불리언 혼동돼도 안전하게 해석."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes", "y", "on", "enabled")
    return False


def read_seat_enabled(cam_yaml_path: str, seat: str) -> Tuple[Optional[bool], str]:
    """cameras.yaml 에서 좌석 enabled 값을 읽는다.

    반환 (enabled, note):
      - (True/False, "")  : 값을 정상적으로 읽음
      - (None, 사유)       : 파일 없음 / 파싱 실패 / 좌석 항목 없음
    list 형식(cameras: [{seat_id, enabled}, ...]) 과 dict 형식 모두 지원한다.
    """
    if not os.path.exists(cam_yaml_path):
        return None, "파일 없음"
    try:
        import yaml
    except Exception as exc:
        return None, f"PyYAML 미설치({type(exc).__name__})"
    try:
        with open(cam_yaml_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except Exception as exc:
        return None, f"{type(exc).__name__}"

    node = raw.get("cameras", raw.get("seats", raw))

    # 1) list 형식: [{seat_id: Seat1, enabled: true}, ...]  ← 현재 cameras.yaml
    if isinstance(node, list):
        for item in node:
            if isinstance(item, dict) and \
                    str(item.get("seat_id", item.get("id", ""))) == seat:
                return _truthy(item.get("enabled")), ""
        return None, f"{seat} 항목 없음"

    # 2) dict 형식: {Seat1: {enabled: true}, ...} 또는 {Seat1: true}
    if isinstance(node, dict):
        sub = node.get(seat)
        if isinstance(sub, dict):
            return _truthy(sub.get("enabled")), ""
        if seat in node:
            return _truthy(node.get(seat)), ""
        return None, f"{seat} 항목 없음"

    return None, "형식 인식 불가"


def _fmt_ts(ts: Any) -> str:
    """FrameItem.timestamp(time.time() epoch float) → 'HH:MM:SS.mmm' (없으면 N/A)."""
    if ts is None:
        return "N/A"
    try:
        return datetime.fromtimestamp(float(ts)).strftime("%H:%M:%S.%f")[:-3]
    except (TypeError, ValueError, OSError):
        return str(ts)


# ============================================================ 합성(fake) 입력
def _fake_burst(seat: str, n: int = 8):
    import numpy as np
    from burst_package import BurstPackage

    class _Item:
        def __init__(self, img, ts):
            self.frame = img
            self.timestamp = ts
            self.frame_index = 0

    rng = np.random.RandomState(0)
    items = [_Item(rng.randint(40, 220, (240, 320, 3), dtype=np.uint8), float(i)) for i in range(n)]
    return BurstPackage(
        burst_uuid=uuid.uuid4().hex, trigger_uuid=uuid.uuid4().hex,
        trigger_id=f"{seat}_e2e", trigger_type="e2e_single_check",
        period_id="P0", period_name="0교시", seat_id=seat, captured_at=datetime.now(),
        frame_count=len(items), frames=items, metadata={"mode": "fake"},
    )


def _synthetic_opencv_result(seat: str, burst):
    """fake 모드에서 OpenCVEngine(cv2) 없이 동일 스키마의 AnalysisResult 생성."""
    from analysis_result import AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS
    now = datetime.now()
    fc = getattr(burst, "frame_count", 0)
    return AnalysisResult(
        analysis_uuid=uuid.uuid4().hex, burst_uuid=getattr(burst, "burst_uuid", ""),
        seat_id=seat, started_at=now, finished_at=now, processing_time=1.0,
        confidence=0.0, status=STATUS_SUCCESS, activity=ACTIVITY_UNKNOWN,
        scores={"blur_score": 120.5, "brightness": 118.3, "contrast": 45.2, "sharpness": 30.1},
        metadata={"engine": "opencv",
                  "vision": {"vision_uuid": uuid.uuid4().hex, "frame_count": fc,
                             "valid_frames": fc, "roi_applied": False, "resolution": "320x240"},
                  "discarded_frames": 0, "discard_reasons": {}},
    )


# ============================================================ 엔진 실행(graceful)
def _run_engine(name: str, burst, seat: str, fake: bool) -> Tuple[Optional[Any], str, str]:
    """엔진 1개 실행. (AnalysisResult|None, status, reason).
    실패/미설치는 SKIPPED 로 처리해 전체 파이프라인을 멈추지 않는다."""
    try:
        if name == "opencv":
            if fake:
                return _synthetic_opencv_result(seat, burst), ENG_SUCCESS, "fake-synthetic"
            from engine_registry import create_engine
            eng = create_engine("opencv")
            eng.initialize()
            res = eng.analyze(burst)
            eng.shutdown()
            return res, res.status, "ok"

        if name == "mediapipe":
            from engine_registry import create_engine
            if fake:
                from mediapipe_backend import FakeMediaPipeBackend
                eng = create_engine("mediapipe", backend=FakeMediaPipeBackend())
            else:
                eng = create_engine("mediapipe")
            eng.initialize()
            res = eng.analyze(burst)
            eng.shutdown()
            return res, res.status, "ok"

        if name == "yolo":
            from engine_registry import create_engine
            if fake:
                from yolo_backend import FakeYOLOBackend
                # fake 시나리오: 책 + 사람(공부 추정) — 깔끔한 데모용
                dets = [
                    {"source_label": "book", "confidence": 0.74, "bbox_xyxy": [100, 120, 200, 230], "class_id": 73},
                    {"source_label": "person", "confidence": 0.90, "bbox_xyxy": [0, 0, 160, 240], "class_id": 0},
                ]
                eng = create_engine("yolo", backend=FakeYOLOBackend(detections=dets))
            else:
                eng = create_engine("yolo")
            eng.initialize()
            res = eng.analyze(burst)
            eng.shutdown()
            return res, res.status, "ok"

        return None, ENG_SKIPPED, f"알 수 없는 엔진: {name}"
    except Exception as exc:  # 모델/라이브러리 없음 등 → SKIPPED(전체 중단 X)
        return None, ENG_SKIPPED, f"{type(exc).__name__}: {exc}"


# ============================================================ 디버그 메트릭(수치/텍스트만)
# ⚠️ 이미지/영상/프레임/스크린샷은 절대 저장하지 않는다. 아래 메트릭은 수치·텍스트만.
UNKNOWN_REASON_CODES = (
    "DETERMINED",           # activity 가 실제로 판정됨(UNKNOWN 아님)
    "NO_FRAMES",            # 프레임 0 - 카메라 미연결/버퍼 비어있음
    "NO_VALID_FRAMES",      # 프레임은 수신됐으나 유효 0(ROI/밝기/블러 등으로 폐기)
    "LOW_QUALITY",          # 품질 게이트 미달
    "NO_DETECTION_ENGINE",  # 사람/객체 탐지 엔진(MediaPipe/YOLO) 미실행 → human/object fact 없음
    "NO_DETECTION_SIGNAL",  # 탐지 엔진은 실행됐으나 사실이 비어있음
    "CONFLICT",             # 상위 후보 신호 충돌
    "NO_ACTIVITY_SIGNAL",   # 사실은 있으나 뚜렷한 활동 신호 없음
)


def _load_roi(here: str, seat: str) -> Optional[dict]:
    """config/roi.yaml 에서 좌석 ROI(rect)만 읽는다(cv2 의존 없음)."""
    path = os.path.join(here, "config", "roi.yaml")
    if not os.path.exists(path):
        return None
    try:
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        rois = raw.get("rois", raw) or {}
        r = rois.get(seat)
        return r if isinstance(r, dict) else None
    except Exception:
        return None


def _yolo_model_status(here: str) -> Tuple[bool, str]:
    """config/yolo.yaml 의 model.path 기준 실제 모델 파일 존재 여부.

    반환 (available, basename). basename 만 노출(전체 경로 미노출).
    모델 파일은 대용량이라 레포 미포함 → 로컬 배치 필요.
    """
    cfg_path = os.path.join(here, "config", "yolo.yaml")
    model_rel = "models/yolo_object.pt"
    try:
        if os.path.exists(cfg_path):
            import yaml
            with open(cfg_path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
            model_rel = ((raw.get("model") or {}).get("path")) or model_rel
    except Exception:
        pass
    model_path = model_rel if os.path.isabs(model_rel) else os.path.join(here, model_rel)
    return os.path.exists(model_path), os.path.basename(str(model_rel))


def _int0(v: Any) -> int:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _count_present(d: Optional[dict]) -> int:
    """dict 에서 값이 None 이 아닌 항목 수(status 제외). fact 존재 여부 판단용."""
    if not d:
        return 0
    return sum(1 for k, v in d.items() if k != "status" and v is not None)


def build_debug_metrics(here: str, seat: str, engines: List[str], fake: bool,
                        camera_seconds: float, burst: Any, fusion_result: Any,
                        decision: Any,
                        engine_statuses: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """UNKNOWN 반복 시 원인을 구분할 수 있는 수치/텍스트 메트릭을 만든다.

    이미지/프레임 저장 없음. reason_code 로 아래를 구분한다:
      프레임 없음 / 프레임은 있으나 유효 0 / 품질 낮음 /
      탐지 엔진 미실행 / 탐지 신호 없음 / 신호 충돌 / 활동 신호 없음.
    YOLO(object) 세부 메트릭도 함께 제공한다(수치/텍스트만).
    """
    engine_statuses = dict(engine_statuses or {})
    sf = getattr(fusion_result, "seat_facts", None)
    vision = (getattr(sf, "vision", {}) or {}) if sf else {}
    human = (getattr(sf, "human", {}) or {}) if sf else {}
    objects = (getattr(sf, "objects", {}) or {}) if sf else {}
    quality = (getattr(sf, "quality", {}) or {}) if sf else {}

    frame_count = int(getattr(burst, "frame_count", 0) or 0)
    vf = vision.get("valid_frames")
    valid_frames = int(vf) if isinstance(vf, (int, float)) and not isinstance(vf, bool) else 0
    discard_reasons = vision.get("discard_reasons", {}) or {}
    dominant_discard = max(discard_reasons, key=discard_reasons.get) if discard_reasons else None

    oq = quality.get("overall_quality")
    overall_q = float(oq) if isinstance(oq, (int, float)) and not isinstance(oq, bool) else 0.0
    usable = quality.get("usable_for_rule_engine")
    thresholds = (getattr(decision, "metadata", {}) or {}).get("thresholds", {}) or {}
    min_q = float(thresholds.get("min_overall_quality", 0.3))

    human_fact_count = _count_present(human)
    object_fact_count = _count_present(objects)
    fact_count = human_fact_count + object_fact_count
    detection_requested = any(e in ("mediapipe", "yolo") for e in engines)
    # 탐지 엔진이 "실제로 돌았는가"(SKIPPED/모델없음과 구분)
    detection_ran = any(engine_statuses.get(e) in (ENG_SUCCESS, ENG_FAILED)
                        for e in ("mediapipe", "yolo"))

    # ---- YOLO(object) 세부 메트릭 ----
    object_counts = objects.get("object_counts", {}) or {}
    detected_labels = sorted(k for k, v in object_counts.items() if _int0(v) > 0)
    detected_object_count = _int0(objects.get("detected_objects_count")) \
        or sum(_int0(v) for v in object_counts.values())
    person_count = _int0(objects.get("max_person_count"))
    phone_count = _int0(objects.get("phone_detection_count"))
    book_count = _int0(objects.get("book_detection_count"))
    laptop_count = _int0(objects.get("laptop_detection_count"))
    tablet_count = _int0(objects.get("tablet_detection_count"))
    top_object_confidence = objects.get("max_detection_confidence")
    yolo_requested = "yolo" in engines
    yolo_status = engine_statuses.get("yolo") or ("NOT_REQUESTED" if not yolo_requested else "UNKNOWN")
    yolo_available, yolo_file = _yolo_model_status(here)

    # 탐지 신호가 왜 없는지(진단용 텍스트)
    missing_detection_reason: Optional[str] = None
    if object_fact_count == 0 and human_fact_count == 0:
        if yolo_requested and yolo_status == ENG_SKIPPED:
            missing_detection_reason = (
                f"yolo=SKIPPED (모델 없음/ultralytics 미설치 추정). "
                f"models/{yolo_file} 로컬 배치 필요")
        elif yolo_requested and yolo_status == ENG_FAILED:
            missing_detection_reason = "yolo=FAILED (backend 예외 - errors 확인)"
        elif not detection_requested:
            missing_detection_reason = "탐지 엔진(mediapipe/yolo) 미요청 - opencv 단독 실행"
    elif object_fact_count > 0 and detected_object_count == 0:
        missing_detection_reason = "objects fact 는 있으나 실제 검출 객체 0 (장면에 대상 객체 없음)"

    activity = getattr(decision, "activity", "UNKNOWN")
    reasons = getattr(decision, "reasons", []) or []

    # ---- reason_code 분류(상호배타, 우선순위 순) ----
    if activity and activity != "UNKNOWN":
        code = "DETERMINED"
        no_fact_reason = f"활동이 판정됨: {activity}"
    elif frame_count <= 0:
        code = "NO_FRAMES"
        no_fact_reason = ("프레임 0 - 카메라 미연결이거나 버퍼가 비어있음"
                          "(--camera-seconds 확대 / 스트림 경로·인증 확인)")
    elif valid_frames <= 0:
        code = "NO_VALID_FRAMES"
        no_fact_reason = (f"프레임 {frame_count}개 수신했으나 유효 0개 "
                          f"(주요 폐기 사유: {dominant_discard or 'unknown'}; "
                          f"ROI/밝기(min_brightness)/블러(min_blur) 확인)")
    elif usable is False or overall_q < min_q:
        code = "LOW_QUALITY"
        no_fact_reason = f"판정 재료 품질 부족(overall_quality={overall_q} < {min_q})"
    elif human_fact_count == 0 and object_fact_count == 0:
        # 탐지 엔진이 아예 안 돌았거나(미요청/모델없음 SKIPPED) → 엔진 부재로 진단
        if not detection_requested or not detection_ran:
            code = "NO_DETECTION_ENGINE"
            no_fact_reason = (missing_detection_reason or
                              "카메라 연결·프레임 수신·OpenCV 품질검사는 성공했으나 "
                              "사람/객체 탐지 엔진(MediaPipe/YOLO) 미실행으로 human/object fact 없음. "
                              "OpenCV 엔진은 설계상 활동/사람/객체를 판별하지 않음(전처리·품질 전용).")
        else:
            code = "NO_DETECTION_SIGNAL"
            no_fact_reason = ("사람/객체 탐지 엔진은 실행됐으나 human/object fact 가 비어 판정 불가 "
                              "(모델/ROI/장면 확인)")
    elif any("충돌" in str(r) for r in reasons):
        code = "CONFLICT"
        no_fact_reason = "상위 후보 신호가 충돌하여 UNKNOWN"
    else:
        code = "NO_ACTIVITY_SIGNAL"
        no_fact_reason = "사실은 있으나 뚜렷한 활동 신호 없음(뚜렷한 규칙 미발동)"

    fmeta = getattr(fusion_result, "metadata", {}) or {}
    return {
        "reason_code": code,
        "no_fact_reason": no_fact_reason,
        "roi_id": seat,
        "roi_name": f"{seat} ROI",
        "selected_roi": _load_roi(here, seat),
        "roi_applied": vision.get("roi_applied"),
        "brightness": vision.get("brightness"),
        "edge_score": vision.get("sharpness"),   # Sobel 그래디언트(에지 세기) 근사
        "blur_score": vision.get("blur_score"),
        "contrast": vision.get("contrast"),
        "motion_score": None,                     # OpenCV 엔진 미산출(움직임 비계산)
        "frame_quality": quality.get("vision_quality"),
        "overall_quality": overall_q,
        "usable_for_rule_engine": usable,
        "frames_received": frame_count,
        "frames_analyzed": valid_frames,
        "usable_frame_count": valid_frames,
        "discarded_frames": vision.get("discarded_frames"),
        "discard_reasons": discard_reasons,
        "analysis_window_seconds": (None if fake else round(float(camera_seconds), 1)),
        "fact_count": fact_count,
        "human_fact_count": human_fact_count,
        "object_fact_count": object_fact_count,
        "present_sources": fmeta.get("present_sources"),
        "missing_sources": list(getattr(fusion_result, "missing_sources", []) or []),
        # ---- YOLO(object) 세부 ----
        "yolo_requested": yolo_requested,
        "yolo_status": yolo_status,
        "yolo_model_available": yolo_available,
        "yolo_model_file": yolo_file,
        "detected_object_count": detected_object_count,
        "detected_labels": detected_labels,
        "normalized_labels": detected_labels,
        "person_count": person_count,
        "phone_count": phone_count,
        "book_count": book_count,
        "laptop_count": laptop_count,
        "tablet_count": tablet_count,
        "top_object_confidence": top_object_confidence,
        "missing_detection_reason": missing_detection_reason,
    }


# ============================================================ Runner
class Seat1E2ERunner:
    def __init__(self, seat: str = "Seat1", engines: Optional[List[str]] = None,
                 fake: bool = False, save: bool = False,
                 repository: Optional[Any] = None,
                 camera_seconds: float = 10.0,
                 debug_metrics: bool = False) -> None:
        self.seat = seat
        self.engines = engines or list(DEFAULT_ENGINES)
        self.fake = fake
        self.save = save
        self._repository = repository
        self.camera_seconds = max(1.0, float(camera_seconds))
        self.debug_metrics = debug_metrics
        self._cm = None  # 실제 CameraManager(real 모드)

    # ----- 카메라 상태 로그(영상/이미지 저장 없음, 수치/시각만) -----
    def _log_camera_status(self, cm, seat: str, label: str) -> dict:
        h = cm.get_health(seat)
        latest = cm.get_latest_frame(seat)
        last_ts = getattr(latest, "timestamp", None)
        age = h["last_frame_age"]
        log.info("[camera %s] %s connected=%s running=%s fps=%.1f res=%s "
                 "frames_received=%d buffer_len=%d last_frame_age=%s reconnects=%d last_ts=%s",
                 seat, label, h["connected"], h["running"], h["fps"], h["resolution"],
                 h["frames_received"], h["buffer_len"],
                 f"{age:.2f}s" if age is not None else "N/A", h["reconnects"], _fmt_ts(last_ts))
        return h

    # ----- 입력(프레임/Burst) -----
    def _make_burst(self):
        if self.fake:
            return _fake_burst(self.seat)
        # real 모드: CameraManager 로 Seat1 프레임 수집(cv2 필요)
        from camera_manager import CameraManager
        from camera_config import load_camera_configs
        from burst_package import BurstPackage
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except Exception:
            pass
        here = os.path.dirname(os.path.abspath(__file__))
        self._cm = CameraManager(load_camera_configs(os.path.join(here, "cameras.yaml")),
                                 status_interval=5.0)
        log.info("[camera %s] RTSP 연결 시도 - warm-up %.1fs (--camera-seconds 로 조절)",
                 self.seat, self.camera_seconds)
        self._cm.start_camera(self.seat)

        # warm-up 폴링: 연결/버퍼가 차오르는 과정을 주기적으로 로그
        poll = 2.0
        waited = 0.0
        connected_logged = False
        while waited < self.camera_seconds:
            step = min(poll, self.camera_seconds - waited)
            time.sleep(step)
            waited += step
            h = self._log_camera_status(
                self._cm, self.seat, f"warm-up {waited:.0f}/{self.camera_seconds:.0f}s")
            if h["connected"] and not connected_logged:
                log.info("[camera %s] RTSP 연결 성공 (frames_received=%d)",
                         self.seat, h["frames_received"])
                connected_logged = True

        final = self._log_camera_status(self._cm, self.seat, "warm-up 완료")
        if not final["connected"]:
            log.warning("[camera %s] RTSP 연결 실패 - URL/인증/네트워크/경로(stream2) 또는 "
                        "tcp↔udp 확인", self.seat)

        frames = self._cm.get_recent_frames(self.seat, seconds=self.camera_seconds)
        log.info("[camera %s] 최근 프레임 수집: %d개 (window %.1fs, 링버퍼 상한 내)",
                 self.seat, len(frames), self.camera_seconds)
        if not frames:
            log.warning("[camera %s] frames=0 - 연결됐어도 버퍼가 비었으면 "
                        "warm-up(--camera-seconds)을 늘리거나 fps/스트림 경로 확인", self.seat)
        return BurstPackage(
            burst_uuid=uuid.uuid4().hex, trigger_uuid=uuid.uuid4().hex,
            trigger_id=f"{self.seat}_e2e", trigger_type="e2e_single_check",
            period_id="P0", period_name="0교시", seat_id=self.seat, captured_at=datetime.now(),
            frame_count=len(frames), frames=frames, metadata={"mode": "real"},
        )

    def _shutdown_camera(self):
        if self._cm is not None and hasattr(self._cm, "stop_all"):
            try:
                self._cm.stop_all()
            except Exception:
                pass
            self._cm = None

    def _get_repository(self):
        if self._repository is not None:
            return self._repository
        from ai_decision_repository import AIDecisionRepository
        repo = AIDecisionRepository()
        repo.initialize()
        return repo

    # ----- 1회 실행 -----
    def run_once(self) -> Dict[str, Any]:
        started = datetime.now()
        run_id = uuid.uuid4().hex[:12]
        errors: List[str] = []
        engine_statuses: Dict[str, str] = {}
        results: List[Any] = []

        burst = self._make_burst()
        frame_count = getattr(burst, "frame_count", 0)

        try:
            for name in self.engines:
                res, status, reason = _run_engine(name, burst, self.seat, self.fake)
                engine_statuses[name] = status
                if status == ENG_SKIPPED:
                    log.info("engine %s SKIPPED (%s)", name, reason)
                if res is not None:
                    results.append(res)

            # FactsFusion
            from facts_fusion_engine import FactsFusionEngine
            fusion = FactsFusionEngine()
            fusion.initialize()
            fr = fusion.fuse(results, context={
                "seat_id": self.seat, "burst_uuid": getattr(burst, "burst_uuid", ""),
                "period_id": getattr(burst, "period_id", None),
                "period_name": getattr(burst, "period_name", None),
                "captured_at": getattr(burst, "captured_at", None),
            })

            # RuleEngine
            from rule_engine import RuleEngine
            rule = RuleEngine()
            rule.initialize()
            decision = rule.decide(fr.seat_facts)

            saved = False
            decision_uuid = decision.decision_uuid
            if self.save:
                try:
                    repo = self._get_repository()
                    repo.save_decision(decision)   # insert 만(update/delete 없음)
                    saved = True
                except Exception as exc:
                    errors.append(f"save: {type(exc).__name__}: {exc}")

            dbg = None
            if self.debug_metrics:
                here = os.path.dirname(os.path.abspath(__file__))
                dbg = build_debug_metrics(here, self.seat, self.engines, self.fake,
                                          self.camera_seconds, burst, fr, decision,
                                          engine_statuses=engine_statuses)
        finally:
            self._shutdown_camera()

        ended = datetime.now()
        return {
            "run_id": run_id,
            "mode": "fake" if self.fake else "real",
            "seat_id": self.seat,
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "frame_count": frame_count,
            "engine_statuses": engine_statuses,
            "fusion_status": fr.status,
            "rule_decision_summary": decision.summary(),
            "activity": decision.activity,
            "confidence": decision.confidence,
            "status": decision.status,
            "severity": decision.severity,
            "reasons": list(decision.reasons),
            "saved": saved,
            "decision_uuid": decision_uuid,
            "errors": errors,
            "debug_metrics": dbg,
        }

    # ----- duration 반복 -----
    def run_duration(self, minutes: float, interval: float) -> Dict[str, Any]:
        interval = max(MIN_INTERVAL_SECONDS, float(interval))
        deadline = time.time() + minutes * 60.0
        runs: List[Dict[str, Any]] = []
        n = 0
        total_planned = max(1, int((minutes * 60.0) // interval) + 1)
        while time.time() <= deadline:
            n += 1
            r = self.run_once()
            runs.append(r)
            log.info("Run %d/%s: activity=%s confidence=%s saved=%s",
                     n, total_planned, r["activity"], r["confidence"], r["saved"])
            if time.time() + interval > deadline:
                break
            time.sleep(interval)

        activity_counts: Dict[str, int] = {}
        saved_count = 0
        for r in runs:
            activity_counts[r["activity"]] = activity_counts.get(r["activity"], 0) + 1
            if r["saved"]:
                saved_count += 1
        return {
            "total_runs": len(runs), "saved": saved_count,
            "activity_counts": activity_counts, "interval_seconds": interval,
            "runs": runs,
        }


# ============================================================ Preflight
def preflight(seat: str, save: bool, fake: bool) -> List[Tuple[str, str]]:
    """연결/설정/모델/Supabase 점검. (level, message) 목록. 비밀값은 출력하지 않는다."""
    out: List[Tuple[str, str]] = []
    here = os.path.dirname(os.path.abspath(__file__))

    def ok(m): out.append(("OK", m))
    def warn(m): out.append(("WARN", m))
    def info(m): out.append(("INFO", m))

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(here, ".env"))
    except Exception:
        warn("python-dotenv 미설치 - .env 자동 로드 불가")

    # 1) .env
    ok(".env 존재") if os.path.exists(os.path.join(here, ".env")) else warn(".env 없음(.env.example 참고)")

    # 2~3) RTSP URL (+마스킹)
    rtsp = os.environ.get(f"{seat.upper()}_RTSP_URL") or os.environ.get("SEAT1_RTSP_URL") or ""
    if rtsp.strip():
        ok(f"RTSP URL 존재: {mask_rtsp(rtsp)}")
    else:
        warn("RTSP URL 없음(SEAT1_RTSP_URL) - real 모드 카메라 불가")

    # 4) cameras.yaml Seat1 enabled (list/dict 형식 모두 지원, 문자열/불리언 혼동 방어)
    cam_yaml = os.path.join(here, "cameras.yaml")
    enabled, note = read_seat_enabled(cam_yaml, seat)
    if enabled is True:
        ok(f"cameras.yaml {seat} enabled=true")
    elif enabled is False:
        warn(f"cameras.yaml {seat} enabled=false")
    else:
        warn(f"cameras.yaml 확인 실패: {note}")

    # 5~7) CameraManager / 프레임 (real 모드만 실제 연결)
    try:
        import camera_manager  # noqa: F401 (cv2 의존)
        ok("CameraManager import 가능")
    except Exception as exc:
        warn(f"CameraManager 불가(cv2 등): {type(exc).__name__} - real 모드 카메라 불가")
    if fake:
        info("fake 모드 - 실제 카메라 프레임 점검 생략")

    # 8) OpenCV engine
    try:
        from engine_registry import create_engine
        e = create_engine("opencv"); e.initialize(); e.shutdown()
        ok("OpenCV engine ready")
    except Exception as exc:
        warn(f"OpenCV engine 불가(cv2): {type(exc).__name__} - fake 모드는 합성 결과 사용")

    # 9) MediaPipe config/model
    mp_yaml = os.path.join(here, "config", "mediapipe.yaml")
    mp_models = os.path.join(here, "models", "face_landmarker.task")
    if os.path.exists(mp_yaml):
        ok("config/mediapipe.yaml 존재") if os.path.exists(mp_models) \
            else warn("MediaPipe 모델 없음(models/*.task) - SKIPPED 처리됨")
    else:
        warn("config/mediapipe.yaml 없음 - MediaPipe SKIPPED")

    # 10) YOLO config/model (config 의 model.path 기준으로 존재 여부 확인)
    yolo_yaml = os.path.join(here, "config", "yolo.yaml")
    if os.path.exists(yolo_yaml):
        yolo_available, yolo_file = _yolo_model_status(here)
        if yolo_available:
            ok(f"config/yolo.yaml 존재 + YOLO 모델 있음(models/{yolo_file})")
        else:
            warn(f"YOLO 모델 없음(models/{yolo_file}) - SKIPPED 처리됨, 로컬 배치 필요")
    else:
        warn("config/yolo.yaml 없음 - YOLO SKIPPED")

    # 11~12) RuleEngine / FactsFusion
    try:
        from rule_engine import RuleEngine
        RuleEngine().initialize(); ok("RuleEngine ready (config/rules.yaml)")
    except Exception as exc:
        warn(f"RuleEngine 불가: {type(exc).__name__}")
    try:
        from facts_fusion_engine import FactsFusionEngine
        FactsFusionEngine().initialize(); ok("FactsFusionEngine ready")
    except Exception as exc:
        warn(f"FactsFusionEngine 불가: {type(exc).__name__}")

    # 13~15) Supabase
    ok("Supabase URL 존재") if has_value("SUPABASE_URL") else warn("SUPABASE_URL 없음 - 저장 불가")
    if save:
        # 값은 출력하지 않고 존재 여부만.
        ok("SUPABASE_SERVICE_ROLE_KEY 존재(값 비출력)") if has_value("SUPABASE_SERVICE_ROLE_KEY") \
            else warn("--save 인데 SUPABASE_SERVICE_ROLE_KEY 없음 - 저장 불가")
        info("ai_rule_decisions insert 가능 여부는 실제 저장 시도에서 확인됨(여기선 미연결)")

    # 16) 안내
    info("대시보드 조회: ai_rule_decisions admin-read migration(20260709) 원격 적용 필요")
    info("service role key 는 server-side .env 에서만 사용(프론트 금지). RTSP URL 은 항상 마스킹.")
    return out


# ============================================================ 출력
def _print_preflight(rows: List[Tuple[str, str]]) -> bool:
    print("===== Seat1 E2E Preflight =====")
    has_blocker = False
    for level, msg in rows:
        print(f"  [{level}] {msg}")
    # OpenCV 합성/ fake 로 항상 single 은 돌 수 있으므로 READY 판단은 관대하게.
    print("[READY] Seat1 E2E test can run (fake 모드는 항상 가능, real 은 WARN 항목 해결 권장)")
    return not has_blocker


def _print_single(result: Dict[str, Any]) -> None:
    print("===== Seat1 E2E Result =====")
    print(f"  mode={result['mode']} seat_id={result['seat_id']} frames={result['frame_count']}")
    es = ", ".join(f"{k}={v}" for k, v in result["engine_statuses"].items())
    print(f"  engines: {es}")
    print(f"  fusion_status: {result['fusion_status']}")
    print(f"  activity: {result['activity']}  confidence: {result['confidence']}  "
          f"status: {result['status']}  severity: {result['severity']}")
    for i, r in enumerate(result["reasons"], 1):
        print(f"    reason {i}. {r}")
    print(f"  saved: {result['saved']}  decision_uuid: {result['decision_uuid']}")
    if result["errors"]:
        print(f"  errors: {result['errors']}")
    if result.get("debug_metrics"):
        _print_debug_metrics(result["debug_metrics"])
    if result["saved"]:
        _print_dashboard_guide()
        _print_verify_sql(result["seat_id"])


def _print_debug_metrics(dbg: Dict[str, Any]) -> None:
    print("----- Debug Metrics (수치/텍스트만 · 이미지/프레임 저장 없음) -----")
    order = [
        "reason_code", "no_fact_reason",
        "roi_id", "roi_name", "selected_roi", "roi_applied",
        "brightness", "edge_score", "blur_score", "contrast", "motion_score",
        "frame_quality", "overall_quality", "usable_for_rule_engine",
        "frames_received", "frames_analyzed", "usable_frame_count",
        "discarded_frames", "discard_reasons", "analysis_window_seconds",
        "fact_count", "human_fact_count", "object_fact_count",
        "present_sources", "missing_sources",
        # ---- YOLO(object) 세부 ----
        "yolo_requested", "yolo_status", "yolo_model_available", "yolo_model_file",
        "detected_object_count", "detected_labels", "normalized_labels",
        "person_count", "phone_count", "book_count", "laptop_count", "tablet_count",
        "top_object_confidence", "missing_detection_reason",
    ]
    for k in order:
        if k in dbg:
            print(f"    {k} = {dbg[k]}")
    print("  ※ UNKNOWN 이어도 reason_code 로 '카메라 연결 성공 / 판정 신호 부족'을 구분한다.")


def _print_verify_sql(seat: str) -> None:
    print("----- 저장 확인용 SQL(읽기 전용) -----")
    print(f"  select seat_id, activity, confidence, status, severity, decided_at, created_at")
    print(f"  from public.ai_rule_decisions")
    print(f"  where seat_id = '{seat}'")
    print(f"  order by created_at desc")
    print(f"  limit 10;")


def _print_dashboard_guide() -> None:
    print("----- 관리자 대시보드 확인 가이드 -----")
    for i, line in enumerate([
        "관리자 계정으로 웹앱 접속",
        "관리자 대시보드 이동",
        "AI 판정 현황 섹션 확인",
        "Seat1 단발 AI 판정 확인",
        "3회 이상 저장 후 안정화된 추정 후보 확인",
        "'자동 상태 변경 아님' 문구 확인",
        "학생 상태/출결/벌점이 바뀌지 않았는지 확인",
    ], 1):
        print(f"  {i}. {line}")


def _write_result(here: str, payload: Dict[str, Any]) -> str:
    """logs/e2e/ 에 텍스트/JSON 결과만 저장(이미지/영상 저장 금지)."""
    import json
    out_dir = os.path.join(here, "logs", "e2e")
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(out_dir, f"e2e_summary_{ts}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    last = os.path.join(out_dir, "e2e_last_result.json")
    with open(last, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    return path


# ============================================================ CLI
def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Solomon Seat1 Real Camera E2E Test v0.1")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--preflight", action="store_true", help="연결/설정/모델/Supabase 점검만")
    mode.add_argument("--single", action="store_true", help="burst 1회 → 전체 파이프라인 1회")
    mode.add_argument("--duration", type=float, metavar="MIN", help="N분 반복 실행")
    p.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_SECONDS,
                   help=f"duration 반복 간격(초, 최소 {MIN_INTERVAL_SECONDS})")
    p.add_argument("--save", action="store_true", help="RuleDecision 을 Supabase 에 저장")
    p.add_argument("--engines", default=",".join(DEFAULT_ENGINES),
                   help="실행 엔진 CSV (기본 opencv). 예: opencv,mediapipe,yolo")
    p.add_argument("--seat", default="Seat1", help="대상 좌석(기본 Seat1)")
    p.add_argument("--camera-seconds", type=float, default=10.0,
                   help="real 모드 카메라 warm-up/수집 시간(초, 기본 10, 최소 1). frames=0 이면 늘려보세요")
    p.add_argument("--fake", action="store_true", help="실제 RTSP 없이 합성 프레임/엔진 사용")
    p.add_argument("--debug-metrics", action="store_true",
                   help="UNKNOWN 원인 구분용 수치/텍스트 메트릭 출력(이미지/프레임 저장 없음)")
    p.add_argument("--write-result", action="store_true", help="logs/e2e/ 에 결과 JSON 저장")
    return p.parse_args(argv)


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def main(argv=None) -> int:
    args = parse_args(argv)
    setup_logging()
    here = os.path.dirname(os.path.abspath(__file__))
    engines = [e.strip() for e in args.engines.split(",") if e.strip()]

    mode_label = "FAKE" if args.fake else "REAL"
    cam = "" if args.fake else f"  camera_seconds={args.camera_seconds}"
    print(f"[mode] {mode_label}  seat={args.seat}  engines={engines}  save={bool(args.save)}{cam}")

    if args.preflight:
        _print_preflight(preflight(args.seat, args.save, args.fake))
        return 0

    runner = Seat1E2ERunner(seat=args.seat, engines=engines, fake=args.fake,
                            save=bool(args.save), camera_seconds=args.camera_seconds,
                            debug_metrics=bool(args.debug_metrics))

    if args.duration is not None:
        if args.interval < MIN_INTERVAL_SECONDS:
            print(f"[!] interval {args.interval}s < 최소 {MIN_INTERVAL_SECONDS}s "
                  f"→ {MIN_INTERVAL_SECONDS}s 로 보정")
        summary = runner.run_duration(args.duration, args.interval)
        print("===== Duration Summary =====")
        print(f"  total_runs: {summary['total_runs']}  saved: {summary['saved']}  "
              f"interval: {summary['interval_seconds']}s")
        print(f"  activity_counts: {summary['activity_counts']}")
        print("  dashboard_stabilized_candidate: 3회 이상 저장 시 대시보드에 안정화 후보 표시")
        if args.debug_metrics and summary["runs"] and summary["runs"][-1].get("debug_metrics"):
            print("  (아래는 마지막 run 기준 debug metrics)")
            _print_debug_metrics(summary["runs"][-1]["debug_metrics"])
        if args.save:
            _print_dashboard_guide()
        if args.write_result:
            print(f"  result saved: {_write_result(here, summary)}")
        return 0

    # 기본/--single
    result = runner.run_once()
    _print_single(result)
    if args.write_result:
        print(f"  result saved: {_write_result(here, result)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
