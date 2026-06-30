# Solomon Seat1 Real Camera E2E Test v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: 실제 Seat1 RTSP(또는 `--fake`)로 **MVP 전체 흐름**을 한 번에 검증하는 도구.
> `CameraManager → BurstPackage → OpenCV/MediaPipe/YOLO → FactsFusion → RuleEngine → (선택)ai_rule_decisions 저장 → 대시보드 확인`.
> **검증 도구일 뿐 운영 자동화 아님** — 학생 상태 변경/출결/벌점/알림/영상·이미지 저장 절대 없음, service role key 비노출, RTSP 마스킹.
> 엔진 일부 미설치는 **SKIPPED**(전체 중단 X). fake 기반 **11 테스트 PASS**.
> (보강) `--camera-seconds` 로 warm-up/수집 시간 조절(기본 10초), real 모드에서 RTSP **연결 성공/실패·buffer_len·frames_received·마지막 프레임 시각** 을 2초마다 자세히 로그.

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── camera_*.py / ring_buffer.py / scheduler_*.py / orchestrator_*.py   # (기존) 카메라/트리거
├── plugins/ (opencv/mediapipe/yolo/dummy) + engine_registry.py         # (기존) 엔진
├── facts_fusion_engine.py / seat_facts.py / fusion_result.py           # (기존) Fusion
├── rule_engine.py / rule_decision.py / activity_labels.py              # (기존) Rule
├── decision_serializer.py / supabase_client.py
├── ai_decision_repository.py / ai_decision_storage_pipeline.py         # (기존) Storage
├── decision_stabilizer.py / stabilized_decision.py                     # (기존) Stabilizer
│
├── seat1_e2e_test.py            # ★신규 Seat1 E2E runner(preflight/single/duration/fake/save)
├── test_seat1_e2e_test.py       # ★신규 fake 기반 테스트 (10개)
│
├── logs/e2e/                    # (gitignore) --write-result JSON 산출물(이미지/영상 없음)
├── config/ (roi/mediapipe/yolo/rules/stabilizer.yaml)                  # (기존)
├── .gitignore                   # ✎수정 logs/ 추가
└── README.md                    # ✎수정 Seat1 Real Camera E2E Test v0.1 절 추가
```

★ = 신규, ✎ = 수정. (DB migration/프론트 무관 — 순수 파이썬 검증 도구. ai_rule_decisions 는 insert 만.)

---

## 2. 신규 파일 전체 코드

### 2-1. `seat1_e2e_test.py`

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

ENG_SUCCESS = "SUCCESS"
ENG_SKIPPED = "SKIPPED"
ENG_FAILED = "FAILED"


# ============================================================ 보안/마스킹
def mask_rtsp(url: Optional[str]) -> str:
    """RTSP URL 의 비밀번호(및 사용자)를 마스킹. 없으면 '(none)'."""
    if not url:
        return "(none)"
    masked = re.sub(r"://([^:/@]+):([^@]+)@", r"://\1:****@", url)
    return masked


def has_value(name: str) -> bool:
    return bool((os.environ.get(name) or "").strip())


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
            eng = create_engine("opencv"); eng.initialize()
            res = eng.analyze(burst); eng.shutdown()
            return res, res.status, "ok"

        if name == "mediapipe":
            from engine_registry import create_engine
            if fake:
                from mediapipe_backend import FakeMediaPipeBackend
                eng = create_engine("mediapipe", backend=FakeMediaPipeBackend())
            else:
                eng = create_engine("mediapipe")
            eng.initialize(); res = eng.analyze(burst); eng.shutdown()
            return res, res.status, "ok"

        if name == "yolo":
            from engine_registry import create_engine
            if fake:
                from yolo_backend import FakeYOLOBackend
                dets = [
                    {"source_label": "book", "confidence": 0.74, "bbox_xyxy": [100, 120, 200, 230], "class_id": 73},
                    {"source_label": "person", "confidence": 0.90, "bbox_xyxy": [0, 0, 160, 240], "class_id": 0},
                ]
                eng = create_engine("yolo", backend=FakeYOLOBackend(detections=dets))
            else:
                eng = create_engine("yolo")
            eng.initialize(); res = eng.analyze(burst); eng.shutdown()
            return res, res.status, "ok"

        return None, ENG_SKIPPED, f"알 수 없는 엔진: {name}"
    except Exception as exc:  # 모델/라이브러리 없음 등 → SKIPPED(전체 중단 X)
        return None, ENG_SKIPPED, f"{type(exc).__name__}: {exc}"


# ============================================================ Runner
class Seat1E2ERunner:
    def __init__(self, seat: str = "Seat1", engines: Optional[List[str]] = None,
                 fake: bool = False, save: bool = False,
                 repository: Optional[Any] = None, camera_seconds: float = 3.0) -> None:
        self.seat = seat
        self.engines = engines or list(DEFAULT_ENGINES)
        self.fake = fake
        self.save = save
        self._repository = repository
        self.camera_seconds = camera_seconds
        self._cm = None

    def _make_burst(self):
        if self.fake:
            return _fake_burst(self.seat)
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
        self._cm.start_camera(self.seat)
        time.sleep(self.camera_seconds)
        frames = self._cm.get_recent_frames(self.seat, seconds=int(self.camera_seconds))
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
        repo = AIDecisionRepository(); repo.initialize()
        return repo

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

            from facts_fusion_engine import FactsFusionEngine
            fusion = FactsFusionEngine(); fusion.initialize()
            fr = fusion.fuse(results, context={
                "seat_id": self.seat, "burst_uuid": getattr(burst, "burst_uuid", ""),
                "period_id": getattr(burst, "period_id", None),
                "period_name": getattr(burst, "period_name", None),
                "captured_at": getattr(burst, "captured_at", None),
            })

            from rule_engine import RuleEngine
            rule = RuleEngine(); rule.initialize()
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
        finally:
            self._shutdown_camera()

        ended = datetime.now()
        return {
            "run_id": run_id, "mode": "fake" if self.fake else "real", "seat_id": self.seat,
            "started_at": started.isoformat(), "ended_at": ended.isoformat(),
            "frame_count": frame_count, "engine_statuses": engine_statuses,
            "fusion_status": fr.status, "rule_decision_summary": decision.summary(),
            "activity": decision.activity, "confidence": decision.confidence,
            "status": decision.status, "severity": decision.severity,
            "reasons": list(decision.reasons), "saved": saved,
            "decision_uuid": decision_uuid, "errors": errors,
        }

    def run_duration(self, minutes: float, interval: float) -> Dict[str, Any]:
        interval = max(MIN_INTERVAL_SECONDS, float(interval))
        deadline = time.time() + minutes * 60.0
        runs: List[Dict[str, Any]] = []
        n = 0
        total_planned = max(1, int((minutes * 60.0) // interval) + 1)
        while time.time() <= deadline:
            n += 1
            r = self.run_once(); runs.append(r)
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
        return {"total_runs": len(runs), "saved": saved_count,
                "activity_counts": activity_counts, "interval_seconds": interval, "runs": runs}


# ============================================================ Preflight
def preflight(seat: str, save: bool, fake: bool) -> List[Tuple[str, str]]:
    """연결/설정/모델/Supabase 점검. (level, message). 비밀값은 출력하지 않는다."""
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

    ok(".env 존재") if os.path.exists(os.path.join(here, ".env")) else warn(".env 없음(.env.example 참고)")

    rtsp = os.environ.get(f"{seat.upper()}_RTSP_URL") or os.environ.get("SEAT1_RTSP_URL") or ""
    ok(f"RTSP URL 존재: {mask_rtsp(rtsp)}") if rtsp.strip() else warn("RTSP URL 없음(SEAT1_RTSP_URL)")

    # cameras.yaml Seat1 enabled / CameraManager / OpenCV / MediaPipe / YOLO / RuleEngine /
    # FactsFusion / Supabase URL / (--save 시)SERVICE_ROLE_KEY 존재만 / 안내 ...
    #   (전체 코드는 src 참고 — 모델/라이브러리 없으면 WARN, 값은 절대 출력 안 함)
    ok("Supabase URL 존재") if has_value("SUPABASE_URL") else warn("SUPABASE_URL 없음 - 저장 불가")
    if save:
        ok("SUPABASE_SERVICE_ROLE_KEY 존재(값 비출력)") if has_value("SUPABASE_SERVICE_ROLE_KEY") \
            else warn("--save 인데 SUPABASE_SERVICE_ROLE_KEY 없음 - 저장 불가")
    info("대시보드 조회: ai_rule_decisions admin-read migration(20260709) 원격 적용 필요")
    info("service role key 는 server-side .env 에서만 사용(프론트 금지). RTSP URL 은 항상 마스킹.")
    return out

# (출력 헬퍼 _print_preflight/_print_single/_print_verify_sql/_print_dashboard_guide/_write_result
#  + CLI parse_args/main 은 실제 파일 참고. --save 후 저장확인 SQL + 대시보드 가이드 출력,
#  --write-result 시 logs/e2e/*.json 만 저장(이미지/영상 없음).)
```

> 위는 핵심 발췌. 전체 코드(`preflight` 16개 점검 + 출력 헬퍼 + CLI)는 실제 `seat1_e2e_test.py` 참고.

### 2-2. `test_seat1_e2e_test.py` (요지)
fake 기반 11 테스트: mask/preflight(비밀값 비노출)/single(파이프라인 순서)/skipped_engine/no_save/save/
save_fail/duration/camera_seconds(옵션·최소1초)/no_side_effects/intact. 핵심:
mask/preflight(비밀값 비노출)/single/skipped_engine/no_save/save/
save_fail/duration(interval 30초 보정)/no_side_effects(소스 스캔)/intact. §11 참고.

---

## 3. 수정된 파일 (변경 부분)

### 3-1. `.gitignore` — E2E 산출물 무시
```gitignore
# Seat1 E2E 결과(JSON)는 로컬 산출물 — 레포에 포함하지 않는다.
logs/
```

### 3-2. `README.md`
- 헤더 목록에 **Seat1 Real Camera E2E Test v0.1** 추가.
- **"## Seat1 Real Camera E2E Test v0.1"** 절 신규: 준비/실행 명령/대시보드 확인/저장 범위/테스트/문제 해결/다음 단계.

> 기존 파이프라인 모듈은 **무수정** — E2E runner 가 기존 엔진/Fusion/Rule/Storage 를 **재사용**만 한다.

---

## 4. Seat1 Real Camera E2E 구조도

```
   ┌──────────────────────────── seat1_e2e_test.py ────────────────────────────┐
   │  --preflight : env/RTSP(마스킹)/cameras.yaml/엔진/모델/RuleEngine/Fusion/   │
   │                Supabase 점검 (service role key 값 비출력)                   │
   │                                                                            │
   │  --single / --duration:                                                    │
   │    _make_burst()                                                           │
   │      ├ real: CameraManager.start_camera(Seat1) → warm-up → get_recent_frames│
   │      └ fake: 합성 numpy 프레임                                              │
   │            ▼ BurstPackage                                                   │
   │    for engine in [opencv, mediapipe, yolo]:  _run_engine() (graceful)       │
   │      · 미설치/모델없음 → SKIPPED (전체 중단 X)                              │
   │      · opencv fake → 동일 스키마 합성 AnalysisResult                        │
   │            ▼ [AnalysisResult ...]                                           │
   │    FactsFusionEngine.fuse(results, context) → SeatFacts (SUCCESS/PARTIAL)   │
   │            ▼                                                                │
   │    RuleEngine.decide(seat_facts) → RuleDecision                             │
   │            ▼ (--save 일 때만)                                               │
   │    AIDecisionRepository.save_decision()  → public.ai_rule_decisions (insert)│
   │            ▼                                                                │
   │    결과 요약 출력 + 저장확인 SQL + 대시보드 확인 가이드                     │
   └────────────────────────────────────────────────────────────────────────────┘
              ▼ (관리자가 직접) 웹앱 → 대시보드 → AI 판정 현황 → Seat1 확인
   ── 어떤 경로도 학생 상태 변경/출결/벌점/알림/영상 저장 으로 가지 않음 ──
```

**핵심 설계 원칙**
- **검증 도구**: 기존 모듈 재사용만(무수정). 한 번 실행 → 한 번의 판정/저장.
- **graceful degradation**: 엔진 일부 실패 = SKIPPED, FactsFusion 이 PARTIAL 로 흡수 → 전체 중단 없음.
- **fake/real 명확 구분**: 출력 `[mode] FAKE|REAL`, fake 는 CI/테스트.
- **프라이버시/보안**: 영상·이미지 저장 0, RTSP 마스킹, service role key 비출력·프론트 미사용, insert 만.

---

## 5. 실행 명령어

```bash
python seat1_e2e_test.py --preflight                         # 점검만
python seat1_e2e_test.py --single                            # 1회(기본 opencv)
python seat1_e2e_test.py --single --engines opencv,mediapipe,yolo
python seat1_e2e_test.py --single --save                    # + Supabase 저장
python seat1_e2e_test.py --single --camera-seconds 15       # warm-up/수집 15초(frames=0 대응)
python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo   # 카메라 없이
python seat1_e2e_test.py --duration 5 --interval 60 --save  # 5분 반복(최소 30초)
python seat1_e2e_test.py --single --fake --write-result      # logs/e2e/*.json 저장
```
`--camera-seconds`(real, 기본 10, 최소 1): RTSP warm-up + 프레임 수집 시간. warm-up 동안 2초마다
`[camera Seat1] ... connected=.. buffer_len=.. frames_received=.. last_frame_age=.. last_ts=..` 를 로그하고,
연결 성공/실패와 최종 수집 프레임 수를 출력한다(영상/이미지 저장 없음).

---

## 6. Preflight 결과 예시

```
[mode] FAKE  seat=Seat1  engines=['opencv']  save=False
===== Seat1 E2E Preflight =====
  [OK] .env 존재
  [OK] RTSP URL 존재: rtsp://admin:****@192.168.219.50:554/stream2
  [WARN] cameras.yaml Seat1 enabled=false
  [WARN] CameraManager 불가(cv2 등): ModuleNotFoundError - real 모드 카메라 불가
  [INFO] fake 모드 - 실제 카메라 프레임 점검 생략
  [WARN] OpenCV engine 불가(cv2): ModuleNotFoundError - fake 모드는 합성 결과 사용
  [WARN] MediaPipe 모델 없음(models/*.task) - SKIPPED 처리됨
  [WARN] YOLO 모델 없음(models/*.pt) - SKIPPED 처리됨
  [OK] RuleEngine ready (config/rules.yaml)
  [OK] FactsFusionEngine ready
  [OK] Supabase URL 존재
  [INFO] 대시보드 조회: ai_rule_decisions admin-read migration(20260709) 원격 적용 필요
  [INFO] service role key 는 server-side .env 에서만 사용(프론트 금지). RTSP URL 은 항상 마스킹.
[READY] Seat1 E2E test can run (fake 모드는 항상 가능, real 은 WARN 항목 해결 권장)
```
> RTSP 비밀번호는 `****`, service role key 는 값 없이 "존재" 만 표시.

---

## 7. Single run 결과 예시 (fake, 3엔진)

```
[mode] FAKE  seat=Seat1  engines=['opencv', 'mediapipe', 'yolo']  save=False
===== Seat1 E2E Result =====
  mode=fake seat_id=Seat1 frames=8
  engines: opencv=SUCCESS, mediapipe=SUCCESS, yolo=SUCCESS
  fusion_status: SUCCESS
  activity: STUDYING  confidence: 1.0  status: SUCCESS  severity: INFO
    reason 1. 책 또는 학습 도구가 검출됨
    reason 2. 손 특징이 함께 검출됨
    reason 3. 사람/자세 특징이 함께 검출됨
    reason 4. 휴대폰 객체 신호가 약함
  saved: False  decision_uuid: 485da6...
```
> `--save` 면 `saved: True` + 저장확인 SQL + 대시보드 확인 가이드가 추가 출력된다.
> real 모드에서 모델이 없으면 `mediapipe=SKIPPED, yolo=SKIPPED`, fusion_status=PARTIAL 로 나오고도 정상 동작.

**real 모드 warm-up 로그 예시(보강)** — `--camera-seconds 15` (영상/이미지 없이 수치/시각만):
```
[mode] REAL  seat=Seat1  engines=['opencv']  save=False  camera_seconds=15.0
[camera Seat1] RTSP 연결 시도 - warm-up 15.0s (--camera-seconds 로 조절)
[camera Seat1] warm-up 2/15s connected=False running=True fps=0.0 res=0x0 frames_received=0 buffer_len=0 last_frame_age=N/A reconnects=0 last_ts=N/A
[camera Seat1] warm-up 4/15s connected=True  running=True fps=14.8 res=848x480 frames_received=31 buffer_len=28 last_frame_age=0.07s reconnects=0 last_ts=09:31:04.512
[camera Seat1] RTSP 연결 성공 (frames_received=31)
[camera Seat1] warm-up 완료 connected=True running=True fps=15.0 frames_received=210 buffer_len=45 last_frame_age=0.05s last_ts=09:31:15.880
[camera Seat1] 최근 프레임 수집: 45개 (window 15.0s, 링버퍼 상한 내)
```
연결 실패/프레임 0 이면: `connected=False` 지속 또는 `buffer_len=0` → URL/인증/경로/네트워크 점검,
`--camera-seconds` 를 더 늘려 재시도.

---

## 8. Duration run 결과 예시

```
[mode] FAKE  ... engines=['opencv','mediapipe','yolo']  save=True
[!] interval 5.0s < 최소 30s → 30s 로 보정       # 너무 짧으면 자동 보정
Run 1/5: activity=STUDYING confidence=1.0 saved=True
Run 2/5: activity=STUDYING confidence=1.0 saved=True
Run 3/5: activity=STUDYING confidence=1.0 saved=True
===== Duration Summary =====
  total_runs: 5  saved: 5  interval: 60s
  activity_counts: {'STUDYING': 5}
  dashboard_stabilized_candidate: 3회 이상 저장 시 대시보드에 안정화 후보 표시
```

---

## 9. Supabase 저장 확인 방법

`--save` 후 터미널에 **읽기 전용 SQL** 이 출력된다(insert 만 했고 update/delete 없음):
```sql
select seat_id, activity, confidence, status, severity, decided_at, created_at
from public.ai_rule_decisions
where seat_id = 'Seat1'
order by created_at desc
limit 10;
```
- 저장 대상: `public.ai_rule_decisions` (기존 AI Decision Storage v0.1 serializer/repository 재사용).
- service role key 는 server-side `.env` 에서만. 프론트 미사용.

---

## 10. Admin Dashboard 확인 방법

`--save` 후 출력되는 가이드:
1. 관리자 계정으로 웹앱 접속
2. 관리자 대시보드 이동
3. AI 판정 현황 섹션 확인
4. Seat1 **단발 AI 판정** 확인
5. **3회 이상 저장** 후 **안정화된 추정 후보** 확인
6. "자동 상태 변경 아님" 문구 확인
7. 학생 상태/출결/벌점이 **바뀌지 않았는지** 확인

> 대시보드 조회가 안 되면 `20260709_ai_rule_decisions_admin_read` migration 적용 + 관리자(is_admin) 계정인지 확인.

---

## 11. 테스트 결과

`python test_seat1_e2e_test.py` (실제 RTSP **없이** fake 기반):
```
PASS mask_rtsp: 비밀번호 마스킹
PASS preflight: 안전 점검 + service role key 값 비노출
PASS single: engines→fusion→rule 순서 + 요약 생성
PASS skipped_engine: 일부 SKIPPED 여도 파이프라인 계속
PASS no_save: --save 없으면 저장 안 함
PASS save: --save 있을 때만 repository.save_decision 호출
PASS save_fail: 저장 실패 → saved False + errors
PASS duration: interval 최소 30초 보정 + summary 생성
PASS camera_seconds: --camera-seconds 옵션 전달 + 최소 1초 보정
PASS no_side_effects: update/delete/이미지저장/학생도메인 코드 없음
PASS intact: RuleEngine/Fusion/Storage 동작 유지

ALL PASS: mask / preflight / single / skipped_engine / no_save / save / save_fail / duration / camera_seconds / no_side_effects / intact
```
**회귀**: `test_decision_stabilizer.py` / `test_rule_engine.py` / `test_ai_decision_storage.py` /
`test_facts_fusion_engine.py` PASS 유지.

---

## 12. 실제 카메라 테스트 결과

- cv2 가 설치된 환경에서는 real 모드가 **CameraCore 를 실제로 시작**한다(URL 은 camera_core 로그에서도 마스킹됨).
  카메라가 네트워크에서 도달 불가하면 warm-up 동안 `connected=False`/`frames=0` 으로 명확히 로그된다 →
  **현장(같은 네트워크)에서 `--camera-seconds` 를 충분히(10~20초) 주고 수행**해야 실제 프레임을 받는다.
- frames=0 진단이 이번 보강의 핵심: warm-up 2초 폴링 로그(connected/buffer_len/frames_received/last_ts)로
  "연결 실패" vs "연결됐지만 버퍼 비었음(시간 부족)" 을 구분할 수 있다.
- fake 모드로 **파이프라인 연결성**(엔진→Fusion→Rule→저장 흐름, graceful skip, 저장 게이팅, 마스킹)은 전부 검증됨.
- **현장 체크리스트(real)**: `pip install opencv-python-headless numpy python-dotenv PyYAML` (+저장 `supabase`,
  +엔진 `mediapipe`/`ultralytics` 및 `models/`), `.env` SEAT1_RTSP_URL/SUPABASE_*, `cameras.yaml` Seat1 enabled →
  `--preflight` 로 [READY] 확인 → `--single` → `--single --save` → `--duration 5 --save` → 대시보드 확인.

---

## 13. 남은 기술부채

1. **real 모드 현장 미검증**: 개발 환경 의존성 부재로 실제 RTSP 경로는 코드 리뷰까지만. 현장 1회 실측 필요.
2. **migration 미적용**: ai_rule_decisions(테이블/admin-read RLS) 원격 미적용이면 `--save`/대시보드 조회 불가.
3. **단순 트리거**: 수동 1회/고정 interval. Scheduler(교시 기반) 연동·실제 트리거 타이밍 미반영.
4. **좌석 고정**: Seat1 위주. 다좌석 동시 E2E 미지원(`--seat` 로 1좌석씩만).
5. **품질/지연 측정 부족**: frame_count 정도만. FPS/지연/엔진별 처리시간 상세 메트릭 없음.
6. **fusion 일관성**: real 에서 opencv SKIPPED(드묾) 시 vision 결측 → PARTIAL. 필수 엔진 정책 강제는 안 함.
7. **결과 보존**: logs/e2e JSON 만(선택). 추세/대시보드 연동 없음(의도).

---

## 14. v0.2 개선계획

1. **현장 real E2E 수행 + 기록**: Seat1 실카메라로 preflight→single→save→duration→대시보드까지 1회 통과 로그 확보.
2. **migration 원격 적용**: ai_rule_decisions 2종 반영 후 저장/조회/안정화 표시 실연동 확인.
3. **Scheduler 연동 트리거**: 교시 기반 트리거(SchedulerEngine)로 자동 burst → 더 현실적인 E2E.
4. **메트릭 강화**: 엔진별 처리시간/FPS/프레임 폐기율/지연을 summary 에 추가.
5. **다좌석 E2E**: Seat1~N 순회 또는 병렬(부하 관리) 옵션.
6. **헬스 대시보드(읽기)**: E2E summary(JSON)를 관리자 화면에 read-only 로 노출(상태 변경 없음).
7. **다음 단계: Seat1 실사용 1일 관찰 로그 v0.1** — 하루치 안정화 후보 변화를 관찰·기록(자동 상태 변경은 여전히 분리).

> v0.1 범위 재확인: **Seat1 실제 카메라로 MVP 전체 파이프라인 연결 검증까지.**
> 학생 상태 변경 / 출결 / 벌점 / 알림 / 보호자 연락 / 관리자 승인·상태반영 / RuleDecision 수정·삭제 /
> 영상·이미지 저장 / 학생 앱 공개 / 프론트 service role 사용은 절대 미구현.
