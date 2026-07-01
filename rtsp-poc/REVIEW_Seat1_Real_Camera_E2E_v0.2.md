# REVIEW — Seat1 Real Camera E2E v0.2

솔로몬스터디카페 AI 학습관리 MVP — Seat1 실제 카메라 E2E 개선(OpenCV 기준).

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**

- 작성일: 2026-07-01
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`
- 실행 위치(실제 카메라): 노트북 로컬 PowerShell / `rtsp-poc`
- Codespaces: 코드 수정·검증·리뷰파일·커밋 준비 전용 (내부망 RTSP 접근 불가)

---

## 0. v0.2 한 줄 요약

v0.1에서 확인된 두 가지 문제를 해결했다.

1. **preflight가 `cameras.yaml Seat1 enabled=true`를 `enabled=false`로 오표시**하던 버그 수정.
   - 근본 원인: `cameras.yaml`의 `cameras:`는 **리스트** 형식(`- seat_id: Seat1`)인데,
     기존 preflight 코드는 **dict** 형식만 처리해 `enabled`가 항상 `False`로 떨어졌다.
2. **UNKNOWN 반복 원인을 구분할 수 없던 문제** 해결 — `--debug-metrics` 옵션과 `reason_code` 분류 추가.
   - 근본 원인(중요): OpenCV 엔진은 **설계상 사람/객체를 판별하지 않는다**(전처리·품질 전용).
     따라서 opencv 단독 실행 시 human/object fact가 비어 RuleEngine이 UNKNOWN을 낼 수밖에 없다.
     **이건 ROI/threshold 문제가 아니라 MediaPipe/YOLO 미실행이라는 구조적 원인**이며,
     이제 `reason_code=NO_DETECTION_ENGINE`으로 명확히 구분된다.
3. 관리자 대시보드에서 UNKNOWN을 **"카메라 연결 성공 · 판정 신호 부족"**으로 구분 표시.

---

## 1. 전체 프로젝트 트리 (rtsp-poc)

> 제외: `node_modules`, `.git`, `dist`, `build`, `logs/`, `.env`, `__pycache__`, `.pytest_cache`, `models/`(*.task/*.pt), 영상/이미지/프레임 파일

```
rtsp-poc/
├── .env.example
├── .gitignore
├── README.md
├── requirements.txt
│
├── cameras.yaml                 # 좌석 목록(리스트 형식, Seat1 enabled=true)
├── schedule.yaml
├── config/
│   ├── mediapipe.yaml
│   ├── roi.yaml                 # 좌석별 ROI(Seat1: x0 y0 w424 h240)
│   ├── rules.yaml
│   ├── stabilizer.yaml
│   └── yolo.yaml
│
├── seat1_e2e_test.py            # ★ 수정: preflight 파싱 + --debug-metrics
├── test_seat1_e2e_test.py       # ★ 수정: 신규 단위 테스트 6개 추가
│
├── camera_core.py / camera_manager.py / camera_config.py / ring_buffer.py
├── burst_package.py / trigger_queue.py
├── ai_engine.py / ai_manager.py / analysis_result.py / engine_registry.py
├── plugins/
│   ├── __init__.py
│   ├── dummy_engine.py
│   ├── opencv_engine.py         # 전처리·품질 전용(사람/객체 판별 안 함)
│   ├── mediapipe_engine.py
│   └── yolo_engine.py
├── vision_result.py / vision_utils.py
├── mediapipe_backend.py / mediapipe_result.py
├── yolo_backend.py / object_detection_result.py / object_label_mapper.py
├── seat_facts.py / fusion_result.py / facts_fusion_engine.py
├── rule_decision.py / rule_engine.py / activity_labels.py
├── decision_serializer.py / decision_stabilizer.py / stabilized_decision.py
├── ai_decision_repository.py / ai_decision_stabilizer_repository.py
├── ai_decision_storage_pipeline.py / supabase_client.py
├── scheduler_engine.py / schedule_config.py / orchestrator_engine.py
├── main.py / manage.py / rtsp_poc.py
│
├── *_demo.py                    # ai/vision/fusion/rule/mediapipe/yolo/... 데모
├── test_*.py                    # 모듈별 단위 테스트
│
└── *_v0.1.md / REVIEW_Seat1_Real_Camera_E2E_v0.2.md   # 리뷰 문서
```

프론트엔드(관리자 대시보드) 변경분:

```
src/features/admin-ai-decisions/
├── types.ts                                     # ★ 수정: unknownSignalHint() 추가
├── components/AIDecisionSeatCard.tsx            # ★ 수정: UNKNOWN 힌트 표시
└── __tests__/AIDecisionComponents.test.tsx      # ★ 수정: 힌트 테스트 추가
```

---

## 2. 신규 파일

**신규 소스 파일 없음.** (이번 v0.2는 기존 파일 수정 + 본 리뷰 문서 신규 생성)

- 신규 문서: `rtsp-poc/REVIEW_Seat1_Real_Camera_E2E_v0.2.md` (이 파일)

---

## 3. 수정된 파일 — 변경 요약

| 파일 | 변경 |
|---|---|
| `rtsp-poc/seat1_e2e_test.py` | `_truthy()`, `read_seat_enabled()` 추가 → preflight enabled 파싱 정정 / `build_debug_metrics()` + `--debug-metrics` + `_print_debug_metrics()` 추가 |
| `rtsp-poc/test_seat1_e2e_test.py` | 신규 테스트 6개(truthy, read_seat_enabled, preflight OK, debug metrics 3종) |
| `src/features/admin-ai-decisions/types.ts` | `unknownSignalHint()` 헬퍼 추가 |
| `src/.../components/AIDecisionSeatCard.tsx` | UNKNOWN 원인 힌트 뱃지 렌더 |
| `src/.../__tests__/AIDecisionComponents.test.tsx` | UNKNOWN 힌트 표시 테스트 |

### 3-1. 핵심 변경 — preflight 파싱 (문제 1 수정)

**Before (버그):**
```python
seats = raw.get("cameras", raw.get("seats", raw)) or {}
enabled = False
if isinstance(seats, dict):          # ← cameras 는 list 라 여기 안 들어옴
    node = seats.get(seat) or {}
    enabled = bool(node.get("enabled")) if isinstance(node, dict) else False
ok(...) if enabled else warn(f"cameras.yaml {seat} enabled=false")   # 항상 false
```

**After (정정):**
```python
def read_seat_enabled(cam_yaml_path, seat):
    ...
    node = raw.get("cameras", raw.get("seats", raw))
    if isinstance(node, list):        # ← 현재 cameras.yaml(리스트) 지원
        for item in node:
            if isinstance(item, dict) and str(item.get("seat_id", item.get("id",""))) == seat:
                return _truthy(item.get("enabled")), ""
        return None, f"{seat} 항목 없음"
    if isinstance(node, dict):        # dict 형식도 계속 지원
        ...
```

출력 규칙:
- `enabled=true` → `[OK] cameras.yaml Seat1 enabled=true`
- `enabled=false` → `[WARN] cameras.yaml Seat1 enabled=false`
- 파일 없음/파싱 실패/좌석 없음 → `[WARN] cameras.yaml 확인 실패: <사유>`
- `_truthy()`로 문자열/불리언 혼동("true"/"false"/True/1) 방어.

### 3-2. 핵심 변경 — debug metrics (문제 2 진단)

`--debug-metrics`는 **이미지/영상/프레임 저장 없이 수치·텍스트만** 출력한다.
`reason_code`로 UNKNOWN 원인을 상호배타적으로 구분한다:

| reason_code | 의미 |
|---|---|
| `DETERMINED` | activity가 실제로 판정됨(UNKNOWN 아님) |
| `NO_FRAMES` | 프레임 0 — 카메라 미연결/버퍼 비어있음 |
| `NO_VALID_FRAMES` | 프레임 수신됐으나 유효 0(ROI/밝기/블러로 폐기) |
| `LOW_QUALITY` | 품질 게이트 미달 |
| `NO_DETECTION_ENGINE` | **사람/객체 탐지 엔진(MediaPipe/YOLO) 미실행** → human/object fact 없음 |
| `NO_DETECTION_SIGNAL` | 탐지 엔진 실행됐으나 사실 비어있음 |
| `CONFLICT` | 상위 후보 신호 충돌 |
| `NO_ACTIVITY_SIGNAL` | 사실은 있으나 뚜렷한 활동 신호 없음 |

허용 메트릭(수치/텍스트만): `roi_id, roi_name, selected_roi, roi_applied, brightness,
edge_score, blur_score, contrast, motion_score, frame_quality, overall_quality,
usable_for_rule_engine, frames_received, frames_analyzed, usable_frame_count,
discarded_frames, discard_reasons, analysis_window_seconds, fact_count,
human_fact_count, object_fact_count, present_sources, missing_sources,
reason_code, no_fact_reason`.

> `motion_score`는 OpenCV 엔진이 움직임을 계산하지 않으므로 `None`.
> `edge_score`는 Sobel 그래디언트(선명도) 근사값.

---

## 4. 수정된 파일 — 전체 코드

### 4-1. `rtsp-poc/seat1_e2e_test.py` (전체)

```python
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


def _count_present(d: Optional[dict]) -> int:
    """dict 에서 값이 None 이 아닌 항목 수(status 제외). fact 존재 여부 판단용."""
    if not d:
        return 0
    return sum(1 for k, v in d.items() if k != "status" and v is not None)


def build_debug_metrics(here: str, seat: str, engines: List[str], fake: bool,
                        camera_seconds: float, burst: Any, fusion_result: Any,
                        decision: Any) -> Dict[str, Any]:
    """UNKNOWN 반복 시 원인을 구분할 수 있는 수치/텍스트 메트릭을 만든다.

    이미지/프레임 저장 없음. reason_code 로 아래를 구분한다:
      프레임 없음 / 프레임은 있으나 유효 0 / 품질 낮음 /
      탐지 엔진 미실행 / 탐지 신호 없음 / 신호 충돌 / 활동 신호 없음.
    """
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
        if not detection_requested:
            code = "NO_DETECTION_ENGINE"
            no_fact_reason = ("카메라 연결·프레임 수신·OpenCV 품질검사는 성공했으나 "
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
                                          self.camera_seconds, burst, fr, decision)
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

    # 10) YOLO config/model
    yolo_yaml = os.path.join(here, "config", "yolo.yaml")
    yolo_model = os.path.join(here, "models", "yolo_object.pt")
    if os.path.exists(yolo_yaml):
        ok("config/yolo.yaml 존재") if os.path.exists(yolo_model) \
            else warn("YOLO 모델 없음(models/*.pt) - SKIPPED 처리됨")
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
```

### 4-2. `rtsp-poc/test_seat1_e2e_test.py` — 추가된 테스트(발췌)

> 기존 11개 테스트는 그대로 유지. 아래 6개가 v0.2 신규.

```python
# ---- preflight cameras.yaml enabled 파싱 ----------------------------------
def test_truthy_string_bool():
    assert e2e._truthy(True) is True
    assert e2e._truthy(False) is False
    assert e2e._truthy("true") is True
    assert e2e._truthy("false") is False        # 문자열 "false" 는 반드시 False
    assert e2e._truthy("True") is True
    assert e2e._truthy("yes") is True
    assert e2e._truthy(0) is False
    assert e2e._truthy(1) is True
    assert e2e._truthy(None) is False
    print("PASS truthy: 문자열/불리언 혼동 방어")


def test_read_seat_enabled_list_form():
    here = os.path.dirname(os.path.abspath(__file__))
    cam = os.path.join(here, "cameras.yaml")   # 실제 list 형식 (Seat1=true, 나머지 false)
    enabled, note = e2e.read_seat_enabled(cam, "Seat1")
    assert enabled is True and note == ""       # 회귀 방지: 리스트 형식에서 true 인식
    enabled2, _ = e2e.read_seat_enabled(cam, "Seat2")
    assert enabled2 is False                     # 실제 false 좌석
    enabled3, note3 = e2e.read_seat_enabled(cam, "Seat99")
    assert enabled3 is None and "항목 없음" in note3
    enabled4, note4 = e2e.read_seat_enabled(os.path.join(here, "no_such.yaml"), "Seat1")
    assert enabled4 is None and note4 == "파일 없음"
    print("PASS read_seat_enabled: list 형식 Seat1=true OK / 없음·실패 구분")


def test_preflight_reports_enabled_ok():
    rows = e2e.preflight("Seat1", save=False, fake=True)
    msgs = [m for _l, m in rows]
    assert any(lvl == "OK" and "cameras.yaml Seat1 enabled=true" in m for lvl, m in rows), msgs
    assert not any("cameras.yaml Seat1 enabled=false" in m for m in msgs)
    print("PASS preflight_enabled: Seat1 enabled=true → OK")


# ---- debug metrics --------------------------------------------------------
_ALLOWED_DEBUG_KEYS = {
    "reason_code", "no_fact_reason", "roi_id", "roi_name", "selected_roi", "roi_applied",
    "brightness", "edge_score", "blur_score", "contrast", "motion_score",
    "frame_quality", "overall_quality", "usable_for_rule_engine",
    "frames_received", "frames_analyzed", "usable_frame_count",
    "discarded_frames", "discard_reasons", "analysis_window_seconds",
    "fact_count", "human_fact_count", "object_fact_count",
    "present_sources", "missing_sources",
}


def test_debug_metrics_opencv_only_no_detection_engine():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True, debug_metrics=True)
    r = runner.run_once()
    dbg = r["debug_metrics"]
    assert dbg is not None
    assert set(dbg).issubset(_ALLOWED_DEBUG_KEYS), set(dbg) - _ALLOWED_DEBUG_KEYS
    assert dbg["reason_code"] == "NO_DETECTION_ENGINE"
    assert dbg["human_fact_count"] == 0 and dbg["object_fact_count"] == 0
    assert dbg["frames_received"] > 0 and dbg["frames_analyzed"] > 0
    assert dbg["present_sources"] == ["opencv"]
    print("PASS debug_metrics: opencv-only → NO_DETECTION_ENGINE(카메라 성공/신호 부족)")


def test_debug_metrics_determined_when_all_engines():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "mediapipe", "yolo"],
                                fake=True, debug_metrics=True)
    r = runner.run_once()
    dbg = r["debug_metrics"]
    assert dbg["reason_code"] == "DETERMINED"
    assert dbg["fact_count"] > 0
    print("PASS debug_metrics: 전체 엔진 → DETERMINED")


def test_debug_metrics_off_by_default():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True)
    r = runner.run_once()
    assert r["debug_metrics"] is None
    args = e2e.parse_args(["--single", "--debug-metrics"])
    assert args.debug_metrics is True
    print("PASS debug_metrics: 기본 꺼짐 + --debug-metrics 노출")
```

### 4-3. `src/features/admin-ai-decisions/types.ts` — 추가된 헬퍼

```typescript
/**
 * UNKNOWN 판정의 원인을 "카메라 연결 성공 / 판정 신호 부족" 관점으로 구분한다.
 * (읽기 전용 보조 표시일 뿐 — 학생 상태/출결/벌점은 자동 변경되지 않는다.)
 *
 * 반환:
 *  - UNKNOWN 이 아니면 null
 *  - vision_quality > 0 (프레임·품질 성공) → '카메라 연결 성공 · 판정 신호 부족'
 *  - 그 외 → '판정 신호 부족'
 */
export function unknownSignalHint(row: AIDecisionRow): string | null {
  if (row.activity !== 'UNKNOWN') return null;
  const q = row.quality ?? {};
  const visionQ = q['vision_quality'];
  const cameraOk = typeof visionQ === 'number' && visionQ > 0;
  return cameraOk ? '카메라 연결 성공 · 판정 신호 부족' : '판정 신호 부족';
}
```

### 4-4. `src/.../components/AIDecisionSeatCard.tsx` — 추가된 렌더(발췌)

```tsx
import { /* ... */ isStale, unknownSignalHint, LOW_CONFIDENCE_THRESHOLD, type AIDecisionRow } from '../types';

// ...
const unknownHint = unknownSignalHint(row);

// confidence + severity 아래에 삽입:
{/* UNKNOWN 원인 힌트: 카메라 연결 성공 / 판정 신호 부족 구분 */}
{unknownHint && (
  <div className="mt-1 flex justify-center">
    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
      {unknownHint}
    </span>
  </div>
)}
```

### 4-5. `src/.../__tests__/AIDecisionComponents.test.tsx` — 추가된 테스트(발췌)

```tsx
it('UNKNOWN 이고 카메라/품질 성공이면 "카메라 연결 성공 · 판정 신호 부족" 을 구분 표시한다', () => {
  render(
    <AIDecisionSeatCard
      seatId="Seat1"
      row={row({
        activity: 'UNKNOWN', confidence: 0, status: 'LOW_CONFIDENCE',
        reasons: ['human/objects 사실이 모두 비어 판정 불가'],
        quality: { overall_quality: 1.0, vision_quality: 1.0, usable_for_rule_engine: true },
      })}
      nowMs={Date.now()}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('카메라 연결 성공 · 판정 신호 부족')).toBeInTheDocument();
});
```

---

## 5. Seat1 Real Camera E2E 구조도

```
[VIGI Seat1 카메라]
  rtsp://admin:****@192.168.219.50:554/stream2
        │  (RTSP/TCP, sub stream 640x480 @ ~25fps)
        ▼
┌────────────────────────────────────────────────────────────┐
│ CameraManager (camera_manager.py + camera_core.py)          │
│  - cameras.yaml(list) → Seat1 enabled=true 로 start_camera  │
│  - RingBuffer 에 프레임 적재, get_recent_frames(window)      │
└───────────────┬────────────────────────────────────────────┘
                ▼  BurstPackage(frames=N)
┌────────────────────────────────────────────────────────────┐
│ AI Engines (engine_registry → plugins/*)                    │
│  - opencv : 품질 전처리만(밝기/블러/대비/선명도) ─ 사람/객체 X │
│  - mediapipe : (모델 있으면) human facts  ─ 현재 SKIPPED      │
│  - yolo      : (모델 있으면) object facts ─ 현재 SKIPPED      │
└───────────────┬────────────────────────────────────────────┘
                ▼  [AnalysisResult ...]
┌────────────────────────────────────────────────────────────┐
│ FactsFusionEngine → SeatFacts                               │
│  vision={...}  human={}(없음)  objects={}(없음)  quality={}  │
└───────────────┬────────────────────────────────────────────┘
                ▼  SeatFacts
┌────────────────────────────────────────────────────────────┐
│ RuleEngine → RuleDecision                                   │
│  human/objects 비어있음 → activity=UNKNOWN,                  │
│  status=LOW_CONFIDENCE, confidence=0.0                      │
└───────────────┬────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
[--save 시]        [--debug-metrics 시]
Supabase           build_debug_metrics()
ai_rule_decisions   → reason_code=NO_DETECTION_ENGINE
(insert only)         (카메라 성공 / 판정 신호 부족 구분)
        │
        ▼
[관리자 대시보드(읽기 전용)]
 단발 AI 판정 + 안정화 후보 + "AI 추정 · 자동 변경 아님"
 + UNKNOWN 힌트: "카메라 연결 성공 · 판정 신호 부족"
```

---

## 6. 실행 명령어

```bash
# 사전 점검
python seat1_e2e_test.py --preflight

# fake 단발(내부망 없이 Codespaces 가능)
python seat1_e2e_test.py --single --fake --engines opencv
python seat1_e2e_test.py --single --fake --engines opencv --debug-metrics
python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo --debug-metrics

# 실제 카메라(노트북 로컬 PowerShell 전용)
python seat1_e2e_test.py --single --engines opencv --camera-seconds 15
python seat1_e2e_test.py --single --engines opencv --camera-seconds 15 --debug-metrics
python seat1_e2e_test.py --single --engines opencv --camera-seconds 15 --save
python seat1_e2e_test.py --duration 5 --interval 60 --engines opencv --save

# 단위 테스트
python -m pytest test_seat1_e2e_test.py -q
```

---

## 7. Preflight 결과 예시 (Codespaces 실측)

```
===== Seat1 E2E Preflight =====
  [OK] .env 존재
  [OK] RTSP URL 존재: rtsp://admin:****@192.168.219.50:554/stream2
  [OK] cameras.yaml Seat1 enabled=true          ← v0.2 수정(이전엔 enabled=false 오표시)
  [OK] CameraManager import 가능
  [OK] OpenCV engine ready
  [WARN] MediaPipe 모델 없음(models/*.task) - SKIPPED 처리됨
  [WARN] YOLO 모델 없음(models/*.pt) - SKIPPED 처리됨
  [OK] RuleEngine ready (config/rules.yaml)
  [OK] FactsFusionEngine ready
  [OK] Supabase URL 존재
  [INFO] 대시보드 조회: ai_rule_decisions admin-read migration(20260709) 원격 적용 필요
  [INFO] service role key 는 server-side .env 에서만 사용(프론트 금지). RTSP URL 은 항상 마스킹.
[READY] Seat1 E2E test can run (fake 모드는 항상 가능, real 은 WARN 항목 해결 권장)
```

---

## 8. Single run 결과 예시

### 8-1. Codespaces fake + --debug-metrics (실측)

```
===== Seat1 E2E Result =====
  mode=fake seat_id=Seat1 frames=8
  engines: opencv=SUCCESS
  fusion_status: PARTIAL
  activity: UNKNOWN  confidence: 0.0  status: LOW_CONFIDENCE  severity: INFO
    reason 1. human/objects 사실이 모두 비어 판정 불가
  saved: False  decision_uuid: 96fea86f02c74b48b55f7bee0362826a
----- Debug Metrics (수치/텍스트만 · 이미지/프레임 저장 없음) -----
    reason_code = NO_DETECTION_ENGINE
    no_fact_reason = 카메라 연결·프레임 수신·OpenCV 품질검사는 성공했으나 사람/객체 탐지 엔진(MediaPipe/YOLO) 미실행으로 human/object fact 없음. OpenCV 엔진은 설계상 활동/사람/객체를 판별하지 않음(전처리·품질 전용).
    roi_id = Seat1
    roi_name = Seat1 ROI
    selected_roi = {'x': 0, 'y': 0, 'w': 424, 'h': 240}
    roi_applied = False
    brightness = 118.3
    edge_score = 30.1
    blur_score = 120.5
    contrast = 45.2
    motion_score = None
    frame_quality = 1.0
    overall_quality = 1.0
    usable_for_rule_engine = True
    frames_received = 8
    frames_analyzed = 8
    usable_frame_count = 8
    discarded_frames = 0
    discard_reasons = {}
    analysis_window_seconds = None
    fact_count = 0
    human_fact_count = 0
    object_fact_count = 0
    present_sources = ['opencv']
    missing_sources = ['mediapipe', 'yolo']
  ※ UNKNOWN 이어도 reason_code 로 '카메라 연결 성공 / 판정 신호 부족'을 구분한다.
```

### 8-2. fake 전체 엔진(opencv,mediapipe,yolo) — DETERMINED (실측)

```
  activity: STUDYING  confidence: 1.0  status: SUCCESS  severity: INFO
    reason_code = DETERMINED
    no_fact_reason = 활동이 판정됨: STUDYING
    fact_count = 27  human_fact_count = 12  object_fact_count = 15
    present_sources = ['opencv', 'mediapipe', 'yolo']
```

### 8-3. 실제 카메라 single(노트북 로컬, v0.1 확정 결과 — 참고)

```
  mode=real seat_id=Seat1 frames=90
  engines: opencv=SUCCESS
  fusion_status: PARTIAL
  activity: UNKNOWN  confidence: 0.0  status: LOW_CONFIDENCE
  saved: False
  # v0.2 --debug-metrics 재실행 시 예상: reason_code=NO_DETECTION_ENGINE,
  #   frames_received=90, frames_analyzed>0, analysis_window_seconds=15.0
```

---

## 9. Duration run 결과 예시 (노트북 로컬, v0.1 확정 — 참고)

```
python seat1_e2e_test.py --duration 5 --interval 60 --engines opencv --save

===== Duration Summary =====
  total_runs: 5  saved: 5  interval: 60.0s
  activity_counts: {'UNKNOWN': 5}
  dashboard_stabilized_candidate: 3회 이상 저장 시 대시보드에 안정화 후보 표시
```

v0.2에서는 `--debug-metrics`를 붙이면 마지막 run의 debug metrics가 요약 아래 추가로 출력된다.

---

## 10. Supabase 저장 확인 방법

`--save` 성공 시 콘솔에 읽기 전용 SQL이 안내된다:

```sql
select seat_id, activity, confidence, status, severity, decided_at, created_at
from public.ai_rule_decisions
where seat_id = 'Seat1'
order by created_at desc
limit 10;
```

- 원격 프로젝트(`pmrdsagyoicuzwicsfjc`) 기준으로 조회한다. (로컬 도커와 혼동 주의)
- `insert`만 발생하며 `update`/`delete`는 절대 없다.
- service role key는 server-side `.env`에서만 사용, 출력 금지.

---

## 11. Admin Dashboard 확인 방법

1. 관리자 계정으로 웹앱 접속 → 관리자 대시보드 → **AI 판정 현황** 섹션.
2. Seat1 **단발 AI 판정** 카드 확인.
3. 3회 이상 저장 후 **안정화된 추정 후보** 확인.
4. **"AI 추정 · 자동 변경 아님"** 문구 확인.
5. v0.2 신규: UNKNOWN 카드에서 **"카메라 연결 성공 · 판정 신호 부족"** 힌트 뱃지 확인.
6. 학생 상태/출결/벌점이 **바뀌지 않았는지** 확인.

---

## 12. 테스트 결과 (Codespaces 실측)

| 스위트 | 결과 |
|---|---|
| `test_seat1_e2e_test.py` | **17 passed** (기존 11 + 신규 6) |
| `test_rule_engine.py`, `test_facts_fusion_engine.py`, `test_ai_decision_storage.py`, `test_decision_stabilizer.py` | **51 passed** |
| 프론트 `npx tsc --noEmit` | **통과(에러 0)** |
| 프론트 `vitest run src/features/admin-ai-decisions` | **35 passed** (신규 힌트 테스트 포함) |

```
$ python -m pytest test_seat1_e2e_test.py -q
.................                                                         [100%]
17 passed in 0.50s
```

---

## 13. 실제 카메라 테스트 결과 (노트북 로컬 PowerShell — v0.1 확정)

- RTSP 연결 성공, 해상도 **640x480**, **fps 약 25**
- single: **frames=90**, `opencv=SUCCESS`, `fusion_status=PARTIAL`
- duration: `total_runs=5`, **saved=5**, `activity_counts={'UNKNOWN': 5}`, Supabase 5회 insert(201 Created)
- 관리자 대시보드: Seat1 단발 판정 + 안정화 후보 + 판정수 5 + "AI 추정 · 자동 변경 아님" 표시 확인
- 실제 학생 상태/출결/벌점 자동 변경 **없음** 확인

> Codespaces는 내부망(192.168.219.50) 접근 불가 → real 모드 재검증은 **노트북 로컬 재검증 필요**.
> v0.2의 preflight 정정과 `--debug-metrics`는 로컬에서 다시 한 번 확인 권장.

---

## 14. 남은 기술부채

1. **`activity=UNKNOWN`, `confidence=0.0` (성공/실패가 아니라 기술부채)**
   - 원인: OpenCV 엔진은 사람/객체를 판별하지 않음 → human/object fact 없음(구조적).
   - 해결: **MediaPipe(사람)·YOLO(객체) 모델 배치 및 실행**이 필요. (후순위)
   - v0.2에서 원인은 `reason_code=NO_DETECTION_ENGINE`으로 명확히 진단됨.
2. **ROI 실측 미조정**: `config/roi.yaml`의 Seat1 ROI는 848x480 서브스트림 가정 예시.
   실제는 640x480이므로 설치 후 좌석 위치에 맞춰 재보정 필요(현재는 자동 클램프로 동작).
3. **motion_score 미산출**: OpenCV 엔진이 프레임 간 움직임을 계산하지 않음(수면/자리비움 보조 신호 부재).
4. **real 모드 debug metrics는 로컬 미검증**: Codespaces 제약으로 fake만 실측. 로컬 재검증 필요.
5. **대시보드 힌트 로직 단순**: `vision_quality>0` 기준의 2단계 구분. reason_code를 DB에 저장해
   더 정밀한 구분(프레임 0 / ROI 저품질 / 탐지 엔진 없음)으로 확장 가능(스키마 변경 필요, 후순위).

---

## 15. v0.2 개선계획 → v0.3 예정

1. **MediaPipe 얼굴/자세 엔진 실 연동**(모델 배치 + preflight OK) → 사람 fact 생성.
2. **YOLO 객체 엔진 실 연동**(book/phone/laptop 등) → 객체 fact 생성 → STUDYING/PHONE 판정 실동작.
3. Seat1 ROI를 640x480 실측 기준으로 재보정.
4. `reason_code`를 `ai_rule_decisions.metadata`에 포함시켜 대시보드가 원인별로 정밀 표시.
5. real 모드 `--debug-metrics` 로컬 재검증(frames=90 기준 reason_code/edge/brightness 확인).

---

## 보안 체크리스트 (커밋 전)

- [x] `.env` 미추적(gitignore) — 실제 비밀번호/service role key 커밋 안 됨
- [x] RTSP URL은 항상 `rtsp://admin:****@192.168.219.50:554/stream2` 마스킹
- [x] service role key 출력/커밋 없음
- [x] 영상/이미지/프레임 저장 코드 없음(debug metrics는 수치/텍스트만)
- [x] `ai_rule_decisions` update/delete 없음(insert only, `--save` 시에만)
- [x] 학생 상태/출결/벌점/알림 자동 변경 없음

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**
