# REVIEW — YOLO Object Engine v0.3

솔로몬스터디카페 AI 학습관리 MVP — Seat1 실제 프레임 → OpenCV 품질 fact → **YOLO object fact** → FactsFusion → RuleEngine 후보 생성 기반 정비.

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**

- 작성일: 2026-07-01
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`
- 작업 위치: Codespaces (코드 수정/검증/문서화 전용 — 내부망 RTSP 미접근)
- 실제 카메라 real 검증: 스터디카페 Wi-Fi 로컬 노트북 PowerShell 전용

---

## 0. v0.3 한 줄 요약

v0.2에서 UNKNOWN의 근본 원인이 **"OpenCV 단독은 사람/객체 fact를 만들 수 없다(구조적)"**로 확정됐다.
v0.3은 그 다음 고리인 **YOLO Object Engine**이 실제 모델을 받을 준비가 되어 있는지 점검하고,
`person / cell phone / book / laptop` object fact가 **FactsFusion → RuleEngine**까지 흘러가
UNKNOWN이 아니라 **STUDYING / PHONE / ABSENT 후보**를 낼 수 있는 구조를 정비·검증했다.

핵심 결과(Codespaces fake 검증, 실제 모델 불필요):
- `opencv,yolo`(fake) → objects fact 생성 → RuleEngine **STUDYING** 후보 성공.
- 시나리오 A(person+book)→STUDYING, B(person+phone)→PHONE, C(사람없음)→ABSENT, D(opencv단독)→UNKNOWN 모두 검증.
- `--debug-metrics`에 **object 세부 메트릭**(yolo_status/detected_labels/person·phone·book·laptop_count/top_object_confidence/missing_detection_reason 등) 추가.
- preflight가 config 기준으로 YOLO 모델 존재 여부를 명확히 SKIPPED 표기.

**중요:** 실제 YOLO 모델(`.pt`) + `ultralytics`는 이 Codespaces에 없다 → **real YOLO 검증은 로컬 재검증 필요**.

---

## 1. 전체 프로젝트 트리 (rtsp-poc)

> 제외: `node_modules`, `.git`, `dist`, `build`, `logs/`, `.env`, `__pycache__`, `.pytest_cache`, `models/`(*.pt/*.task/*.onnx), 영상/이미지/프레임 파일

```
rtsp-poc/
├── .env.example / .gitignore / README.md / requirements.txt
├── cameras.yaml / schedule.yaml
├── config/
│   ├── mediapipe.yaml
│   ├── roi.yaml
│   ├── rules.yaml
│   ├── stabilizer.yaml
│   └── yolo.yaml                       # YOLO model.path / thresholds / target_objects
│
├── seat1_e2e_test.py                   # ★ 수정: YOLO 모델 상태 + object debug metrics
├── test_seat1_e2e_test.py              # ★ 수정: object debug metrics 테스트 2개
├── test_yolo_e2e_flow.py               # ★ 신규: 시나리오 A/B/C/D (YOLO→Fusion→Rule)
│
├── plugins/
│   ├── __init__.py
│   ├── dummy_engine.py
│   ├── opencv_engine.py                # 전처리·품질 전용(사람/객체 판별 X)
│   ├── mediapipe_engine.py
│   └── yolo_engine.py                  # YOLOEngine — 객체 fact 추출(cv2/ultralytics 비의존)
│
├── yolo_backend.py                     # YOLOBackend(실제 Ultralytics) + FakeYOLOBackend
├── object_detection_result.py          # ObjectDetectionResult(객체 원자 fact)
├── object_label_mapper.py              # 원본→표준 라벨(phone/book/laptop/tablet/person)
│
├── camera_core.py / camera_manager.py / camera_config.py / ring_buffer.py
├── burst_package.py / trigger_queue.py
├── ai_engine.py / ai_manager.py / analysis_result.py / engine_registry.py
├── vision_result.py / vision_utils.py
├── mediapipe_backend.py / mediapipe_result.py
├── seat_facts.py / fusion_result.py / facts_fusion_engine.py
├── rule_decision.py / rule_engine.py / activity_labels.py
├── decision_serializer.py / decision_stabilizer.py / stabilized_decision.py
├── ai_decision_repository.py / ai_decision_stabilizer_repository.py
├── ai_decision_storage_pipeline.py / supabase_client.py
├── scheduler_engine.py / schedule_config.py / orchestrator_engine.py
├── main.py / manage.py / rtsp_poc.py
│
├── *_demo.py / test_*.py               # 데모 · 모듈별 단위 테스트
└── *_v0.1.md / REVIEW_Seat1_Real_Camera_E2E_v0.2.md / REVIEW_YOLO_Object_Engine_v0.3.md
```

프론트엔드(관리자 대시보드): **v0.3 변경 없음**(백엔드/E2E 전용 단계).

---

## 2. YOLO 관련 기존 구조 분석 (v0.1에서 이미 구축됨)

| 파일 | 역할 | v0.3 관점 |
|---|---|---|
| `plugins/yolo_engine.py` | BurstPackage → 프레임 샘플링/검증/ROI → backend → `ObjectDetectionResult` → `AnalysisResult`. **activity 항상 UNKNOWN**, cv2/ultralytics 비의존(numpy만). | 그대로 재사용 |
| `yolo_backend.py` | `YOLOBackend`(실제 Ultralytics, `initialize()`에서만 lazy import, 모델 없으면 `FileNotFoundError`) + `FakeYOLOBackend`(모델/라이브러리 없이 결정적 검출). | 그대로 재사용 |
| `object_detection_result.py` | phone/book/laptop/tablet/person `*_detected`/`*_detection_count`, `object_counts`, `max_person_count`, `avg/max_detection_confidence`, `quality_score`. | 그대로 재사용 |
| `object_label_mapper.py` | 원본 라벨(예: `cell phone`)→표준(`phone/book/laptop/tablet/person`), 미매핑=`unknown_object`. config `target_objects` 우선. | 그대로 재사용 |
| `config/yolo.yaml` | `model.path=models/yolo_object.pt`, conf/iou threshold, `target_objects` 라벨 매핑. | 그대로 |
| `facts_fusion_engine.py` | YOLO `AnalysisResult`(`metadata.engine="yolo"`) → `SeatFacts.objects`(`_extract_objects`). | 그대로 — objects fact가 여기로 전달됨 |
| `rule_engine.py` | objects fact 기반 `_rule_studying`/`_rule_phone`/`_rule_absent`/`_rule_sleeping`. | 그대로 — 후보 생성 가능 |
| `test_yolo_engine.py` | 엔진 단위 10개(init/metadata/bbox/skipped/failed/sampling/label_mapper/unknown/registry/intact). | 유지 |

**결론:** YOLO 엔진·backend·매핑·fusion·rule은 이미 완성돼 있고, `opencv,yolo`(fake)로 **STUDYING 후보가 이미 나온다.**
v0.3의 실제 작업은 **① 진단 가시성(object debug metrics) ② YOLO 모델 부재 시 명확한 SKIPPED 진단 ③ 시나리오 A/B/C/D 통합 테스트 ④ 문서화**다.

### 모델 없음 흐름(안전) — 확인 결과
- 실제 backend `YOLOBackend.initialize()`는 모델 파일 없으면 `FileNotFoundError`.
- `_run_engine("yolo", ...)`가 이를 잡아 **SKIPPED**로 처리 → 전체 파이프라인 중단 없음.
- FactsFusion은 yolo 누락을 `missing_sources`에 기록하고 PARTIAL로 계속.
- RuleEngine은 objects 비어 UNKNOWN → `--debug-metrics`의 `reason_code=NO_DETECTION_ENGINE` + `missing_detection_reason`으로 진단.

---

## 3. 신규 파일 전체 코드

### 3-1. `rtsp-poc/test_yolo_e2e_flow.py` (신규)

```python
"""
YOLO Object → FactsFusion → RuleEngine 흐름 테스트 (v0.3).

**실제 YOLO 모델 / ultralytics 없이** FakeYOLOBackend 로 통과한다(합성 프레임).
목표: YOLO object fact 가 FactsFusionEngine 을 거쳐 SeatFacts.objects 로 들어가고,
RuleEngine 이 UNKNOWN 이 아니라 STUDYING / PHONE / ABSENT **후보**를 낼 수 있는지 검증.

⚠️ 이 테스트는 판정 후보 생성까지만 확인한다.
   학생 상태/출결/벌점/알림 자동 변경은 절대 하지 않는다(그런 코드 자체가 없음).

시나리오:
  A. person + book       → STUDYING 후보
  B. person + cell phone  → PHONE 후보
  C. 검출 없음(사람 없음)   → ABSENT 후보
  D. opencv 단독(YOLO 없음) → objects 비어 UNKNOWN (구조적, NO_DETECTION_ENGINE)
"""
from datetime import datetime

import numpy as np

from analysis_result import AnalysisResult, ACTIVITY_UNKNOWN, STATUS_SUCCESS
from burst_package import BurstPackage
from yolo_backend import FakeYOLOBackend
from plugins.yolo_engine import YOLOEngine
from facts_fusion_engine import FactsFusionEngine
from rule_engine import RuleEngine


# ---- 합성 입력 도우미 -----------------------------------------------------
def _frame(seed=1):
    return np.random.RandomState(seed).randint(40, 220, (240, 320, 3), dtype=np.uint8)


def _item(img, ts=0.0):
    class _It:
        pass
    it = _It(); it.frame = img; it.timestamp = ts; it.frame_index = 0
    return it


def _burst(seat="Seat1"):
    frames = [_item(_frame(1))]
    return BurstPackage(
        burst_uuid="b1", trigger_uuid="t1", trigger_id="e2e", trigger_type="e2e_single_check",
        period_id="P0", period_name="0교시", seat_id=seat, captured_at=datetime.now(),
        frame_count=len(frames), frames=frames, metadata={},
    )


def _opencv_result(burst):
    """opencv 품질 fact(성공) 합성 — 프레임/품질은 정상."""
    now = datetime.now()
    return AnalysisResult(
        analysis_uuid="a-opencv", burst_uuid=burst.burst_uuid, seat_id=burst.seat_id,
        started_at=now, finished_at=now, processing_time=1.0, confidence=0.0,
        status=STATUS_SUCCESS, activity=ACTIVITY_UNKNOWN,
        scores={"blur_score": 120.0, "brightness": 118.0, "contrast": 45.0, "sharpness": 30.0},
        metadata={"engine": "opencv",
                  "vision": {"vision_uuid": "v", "frame_count": 1, "valid_frames": 1,
                             "roi_applied": True, "resolution": "320x240"},
                  "discarded_frames": 0, "discard_reasons": {}},
    )


def _yolo_result(burst, detections):
    eng = YOLOEngine(backend=FakeYOLOBackend(detections=detections),
                     config={"runtime": {"sample_every_n_frames": 1, "max_analyzed_frames": 100}})
    eng.initialize()
    res = eng.analyze(burst)
    eng.shutdown()
    return res


def _decide(detections=None, with_yolo=True):
    """opencv(+옵션 yolo) → fusion → rule. RuleDecision 과 SeatFacts 반환."""
    b = _burst()
    results = [_opencv_result(b)]
    if with_yolo:
        results.append(_yolo_result(b, detections or []))
    fusion = FactsFusionEngine(); fusion.initialize()
    fr = fusion.fuse(results, context={"seat_id": "Seat1", "burst_uuid": "b1"})
    rule = RuleEngine(); rule.initialize()
    return rule.decide(fr.seat_facts), fr.seat_facts


_PERSON = {"source_label": "person", "confidence": 0.90, "bbox_xyxy": [0, 0, 160, 240], "class_id": 0}
_BOOK = {"source_label": "book", "confidence": 0.74, "bbox_xyxy": [100, 120, 200, 230], "class_id": 73}
_PHONE = {"source_label": "cell phone", "confidence": 0.87, "bbox_xyxy": [10, 10, 80, 160], "class_id": 67}
_LAPTOP = {"source_label": "laptop", "confidence": 0.66, "bbox_xyxy": [40, 30, 300, 220], "class_id": 63}


# ---- 시나리오 A: person + book → STUDYING --------------------------------
def test_scenario_A_person_book_studying():
    d, sf = _decide([_PERSON, _BOOK])
    assert sf.objects.get("book_detected") is True         # objects fact 로 흘러감
    assert sf.objects.get("person_detected") is True
    assert d.activity == "STUDYING"
    assert d.status == "SUCCESS" and d.confidence > 0
    print("PASS 시나리오 A: person+book → STUDYING 후보")


def test_scenario_A_person_laptop_studying():
    d, sf = _decide([_PERSON, _LAPTOP])
    assert sf.objects.get("laptop_detected") is True
    assert d.activity == "STUDYING"
    print("PASS 시나리오 A': person+laptop → STUDYING 후보")


# ---- 시나리오 B: person + cell phone → PHONE ------------------------------
def test_scenario_B_person_phone_phone():
    d, sf = _decide([_PERSON, _PHONE])
    assert sf.objects.get("phone_detected") is True        # cell phone → phone 정규화
    assert d.activity == "PHONE"
    assert d.status == "SUCCESS" and d.confidence > 0
    print("PASS 시나리오 B: person+cell phone → PHONE 후보")


# ---- 시나리오 C: 검출 없음(사람 없음) → ABSENT ----------------------------
def test_scenario_C_no_person_absent():
    d, sf = _decide([])                                    # YOLO 실행됐으나 검출 0
    assert sf.objects.get("person_detected") is False
    assert d.activity == "ABSENT"
    assert d.status == "SUCCESS"
    print("PASS 시나리오 C: 사람 없음 → ABSENT 후보")


# ---- 시나리오 D: opencv 단독(YOLO 없음) → UNKNOWN -------------------------
def test_scenario_D_opencv_only_unknown():
    d, sf = _decide(with_yolo=False)
    assert not sf.objects                                  # objects fact 자체가 비어있음
    assert d.activity == "UNKNOWN"
    assert any("human/objects" in r for r in d.reasons)
    print("PASS 시나리오 D: opencv 단독 → UNKNOWN(구조적, 탐지 엔진 부재)")


# ---- objects fact 가 fusion 을 통해 실제로 전달되는지(회귀 방지) ----------
def test_objects_fact_reaches_seatfacts():
    d, sf = _decide([_PERSON, _BOOK, _PHONE])
    obj = sf.objects
    assert obj and obj.get("status") == "SUCCESS"
    # object_counts 에 표준 라벨이 정규화되어 담긴다
    assert obj["object_counts"].get("person", 0) >= 1
    assert obj["object_counts"].get("book", 0) >= 1
    assert obj["object_counts"].get("phone", 0) >= 1
    assert obj.get("max_detection_confidence", 0) > 0
    print("PASS 전달: YOLO objects fact → FactsFusion → SeatFacts.objects")


def main():
    test_scenario_A_person_book_studying()
    test_scenario_A_person_laptop_studying()
    test_scenario_B_person_phone_phone()
    test_scenario_C_no_person_absent()
    test_scenario_D_opencv_only_unknown()
    test_objects_fact_reaches_seatfacts()
    print("\nALL PASS: 시나리오 A / A' / B / C / D + objects fact 전달")


if __name__ == "__main__":
    main()
```

---

## 4. 수정된 파일 — 변경/추가 부분 전체 코드

> `seat1_e2e_test.py`는 v0.2 리뷰(REVIEW_Seat1_Real_Camera_E2E_v0.2.md)에 전체가 실려 있다.
> 아래는 **v0.3에서 추가/교체된 함수·블록 전체**다(그 외 라인은 v0.2와 동일).

### 4-1. `seat1_e2e_test.py` — 신규 헬퍼 `_yolo_model_status` / `_int0`

```python
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
```

### 4-2. `seat1_e2e_test.py` — `build_debug_metrics`(전체 교체, object 메트릭 추가)

```python
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
```

### 4-3. `seat1_e2e_test.py` — `run_once` 호출부(engine_statuses 전달)

```python
            dbg = None
            if self.debug_metrics:
                here = os.path.dirname(os.path.abspath(__file__))
                dbg = build_debug_metrics(here, self.seat, self.engines, self.fake,
                                          self.camera_seconds, burst, fr, decision,
                                          engine_statuses=engine_statuses)
```

### 4-4. `seat1_e2e_test.py` — preflight YOLO 블록(config 기준)

```python
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
```

### 4-5. `seat1_e2e_test.py` — `_print_debug_metrics` 출력 순서(object 추가)

```python
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
```

### 4-6. `test_seat1_e2e_test.py` — 추가 테스트(발췌)

```python
_ALLOWED_DEBUG_KEYS = {
    # ... (v0.2 키) ...
    # v0.3 YOLO(object) 세부
    "yolo_requested", "yolo_status", "yolo_model_available", "yolo_model_file",
    "detected_object_count", "detected_labels", "normalized_labels",
    "person_count", "phone_count", "book_count", "laptop_count", "tablet_count",
    "top_object_confidence", "missing_detection_reason",
}


def test_debug_metrics_object_fields_with_yolo():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv", "yolo"],
                                fake=True, debug_metrics=True)
    r = runner.run_once()
    dbg = r["debug_metrics"]
    assert set(dbg).issubset(_ALLOWED_DEBUG_KEYS), set(dbg) - _ALLOWED_DEBUG_KEYS
    assert r["activity"] == "STUDYING"
    assert dbg["reason_code"] == "DETERMINED"
    assert dbg["yolo_requested"] is True and dbg["yolo_status"] == "SUCCESS"
    assert dbg["object_fact_count"] > 0
    assert dbg["book_count"] >= 1 and dbg["person_count"] >= 1
    assert "book" in dbg["detected_labels"] and "person" in dbg["detected_labels"]
    assert dbg["top_object_confidence"] and dbg["top_object_confidence"] > 0
    assert dbg["missing_detection_reason"] is None
    print("PASS debug_metrics(object): yolo 세부 메트릭 + STUDYING")


def test_debug_metrics_yolo_status_notrequested_opencv_only():
    runner = e2e.Seat1E2ERunner(seat="Seat1", engines=["opencv"], fake=True, debug_metrics=True)
    dbg = runner.run_once()["debug_metrics"]
    assert dbg["yolo_requested"] is False
    assert dbg["yolo_status"] == "NOT_REQUESTED"
    assert dbg["detected_object_count"] == 0
    assert isinstance(dbg["yolo_model_available"], bool)
    assert dbg["missing_detection_reason"]
    print("PASS debug_metrics(object): opencv 단독 → yolo NOT_REQUESTED")
```

---

## 5. YOLO Object Engine 구조도

```
BurstPackage(frames)
      │  _select_frames(sample_every_n_frames, max_analyzed_frames)
      ▼
 프레임 검증(_prepare_frame: empty/corrupt/too_dark) + (선택)ROI crop  ── numpy only
      ▼
 YOLO Backend.analyze_frame(BGR ndarray)         ── 실제: Ultralytics lazy import
      │    실제 YOLOBackend: 모델 없으면 initialize()에서 FileNotFoundError
      │    FakeYOLOBackend: 결정적 검출(모델·라이브러리 불필요)
      ▼  raw dets [{source_label, confidence, bbox_xyxy, class_id}, ...]
 ObjectLabelMapper.normalize(source_label)        ── cell phone→phone, ipad→tablet, 미매핑→unknown_object
      ▼
 ObjectDetectionResult (phone/book/laptop/tablet/person *_detected/_count,
                        object_counts, max_person_count, avg/max_conf, quality_score)
      ▼
 AnalysisResult(engine="yolo", activity=UNKNOWN, confidence=검출품질)
```

---

## 6. OpenCV + YOLO + FactsFusion + RuleEngine 흐름도

```
[Seat1 실제 프레임]
   ├─ OpenCVEngine  → AnalysisResult(engine=opencv) : 밝기/블러/대비/선명도(품질 fact)
   └─ YOLOEngine    → AnalysisResult(engine=yolo)   : person/phone/book/laptop object fact
                                │
                                ▼
                 FactsFusionEngine.fuse([...])
                   → SeatFacts.vision(품질)  + SeatFacts.objects(객체)  + quality
                                │
                                ▼
                 RuleEngine.decide(SeatFacts)
       ┌────────────────────────┴─────────────────────────┐
       │ person + book/laptop + phone 없음 → STUDYING 후보  │
       │ person + phone                    → PHONE 후보     │
       │ person/얼굴/자세/손 전부 없음      → ABSENT 후보    │
       │ objects 비어있음(YOLO 없음)        → UNKNOWN(구조적)│
       │ 상위 후보 신호 충돌                → UNKNOWN(보수적) │
       └──────────────────────────────────────────────────┘
                                │
                     ┌──────────┴───────────┐
                     ▼                       ▼
             [--save 시] Supabase       [--debug-metrics 시]
             ai_rule_decisions(insert)   reason_code + object 세부 메트릭
                     │
                     ▼
           [관리자 대시보드(읽기 전용)] 단발/안정화 후보 · "AI 추정 · 자동 변경 아님"
```

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
> **STABLE 도 확정이 아닙니다.**

---

## 7. 실행 명령어

```bash
# 사전 점검(YOLO 모델 존재 여부 명확히 표기)
python seat1_e2e_test.py --preflight

# fake — opencv + yolo (Codespaces 가능, 모델 불필요)
python seat1_e2e_test.py --single --fake --engines opencv,yolo --debug-metrics

# fake — 전체 엔진
python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo --debug-metrics

# 실제 카메라(로컬 노트북 전용, 모델 배치 후)
python seat1_e2e_test.py --single --engines opencv,yolo --camera-seconds 15 --debug-metrics
python seat1_e2e_test.py --single --engines opencv,yolo --camera-seconds 15 --save

# 테스트
python -m pytest test_yolo_e2e_flow.py test_seat1_e2e_test.py test_yolo_engine.py -q
python -m pytest test_facts_fusion_engine.py test_rule_engine.py -q
```

---

## 8. Preflight 결과 예시 (Codespaces 실측 — 모델 없음)

```
===== Seat1 E2E Preflight =====
  [OK] .env 존재
  [OK] RTSP URL 존재: rtsp://admin:****@192.168.219.50:554/stream2
  [OK] cameras.yaml Seat1 enabled=true
  [OK] CameraManager import 가능
  [OK] OpenCV engine ready
  [WARN] MediaPipe 모델 없음(models/*.task) - SKIPPED 처리됨
  [WARN] YOLO 모델 없음(models/yolo_object.pt) - SKIPPED 처리됨, 로컬 배치 필요
  [OK] RuleEngine ready (config/rules.yaml)
  [OK] FactsFusionEngine ready
  [OK] Supabase URL 존재
  ...
[READY] Seat1 E2E test can run (fake 모드는 항상 가능, real 은 WARN 항목 해결 권장)
```

모델 배치 후 로컬에서는:
```
  [OK] config/yolo.yaml 존재 + YOLO 모델 있음(models/yolo_object.pt)
```

---

## 9. fake YOLO 테스트 결과 예시 (Codespaces 실측)

### 9-1. `opencv,yolo` fake + `--debug-metrics` → STUDYING

```
  mode=fake seat_id=Seat1 frames=8
  engines: opencv=SUCCESS, yolo=SUCCESS
  fusion_status: PARTIAL
  activity: STUDYING  confidence: 0.8  status: SUCCESS  severity: INFO
----- Debug Metrics (수치/텍스트만 · 이미지/프레임 저장 없음) -----
    reason_code = DETERMINED
    no_fact_reason = 활동이 판정됨: STUDYING
    overall_quality = 0.91
    object_fact_count = 15
    present_sources = ['opencv', 'yolo']
    missing_sources = ['mediapipe']
    yolo_requested = True
    yolo_status = SUCCESS
    yolo_model_available = False
    yolo_model_file = yolo_object.pt
    detected_object_count = 8
    detected_labels = ['book', 'person']
    normalized_labels = ['book', 'person']
    person_count = 1
    phone_count = 0
    book_count = 4
    laptop_count = 0
    tablet_count = 0
    top_object_confidence = 0.9
    missing_detection_reason = None
```

### 9-2. `opencv` 단독 + `--debug-metrics` → YOLO 부재 진단

```
    reason_code = NO_DETECTION_ENGINE
    yolo_requested = False
    yolo_status = NOT_REQUESTED
    yolo_model_available = False
    detected_object_count = 0
    missing_detection_reason = 탐지 엔진(mediapipe/yolo) 미요청 - opencv 단독 실행
```

### 9-3. 시나리오 테스트(YOLO→Fusion→Rule)

```
PASS 시나리오 A: person+book → STUDYING 후보
PASS 시나리오 A': person+laptop → STUDYING 후보
PASS 시나리오 B: person+cell phone → PHONE 후보
PASS 시나리오 C: 사람 없음 → ABSENT 후보
PASS 시나리오 D: opencv 단독 → UNKNOWN(구조적, 탐지 엔진 부재)
PASS 전달: YOLO objects fact → FactsFusion → SeatFacts.objects
```

---

## 10. 실제 모델 배치 방법 (로컬, 사용자 직접)

모델 파일(`.pt`)은 **용량/라이선스** 때문에 레포에 넣지 않는다(`models/`, `*.pt` 는 `.gitignore`).
실제(`--engines ...,yolo` real) 실행 전, 로컬 노트북에서 직접 내려받아 `rtsp-poc/models/` 에 배치한다.

```powershell
# rtsp-poc 폴더에서
mkdir models
# Ultralytics 사전학습(COCO) 또는 커스텀 학습 모델을 배치:
#   예) yolov8n.pt / yolov8s.pt — github.com/ultralytics/ultralytics
#   config/yolo.yaml 의 model.path 기본값은 models/yolo_object.pt
copy <다운로드경로>\yolov8n.pt models\yolo_object.pt
pip install ultralytics        # 실제 backend 사용 시에만 필요
```

- 파일명이 다르면 `config/yolo.yaml` 의 `model.path` 를 맞춰 수정한다.
- COCO 기본 라벨엔 `person / cell phone / book / laptop` 이 있으나 **tablet 은 없다**(후순위).
- 모델·이미지·프레임은 **절대 커밋하지 않는다**(gitignore로 강제).

---

## 11. 실제 카메라 v0.3 재검증 방법 (스터디카페 로컬 노트북)

1. 스터디카페 Wi-Fi 연결(같은 내부망, `192.168.219.50` 도달 가능).
2. `models/yolo_object.pt` 배치 + `pip install ultralytics`.
3. `python seat1_e2e_test.py --preflight` → `YOLO 모델 있음` OK 확인.
4. `python seat1_e2e_test.py --single --engines opencv,yolo --camera-seconds 15 --debug-metrics`
   - 기대: `yolo_status=SUCCESS`, `detected_labels` 에 person 등, `reason_code=DETERMINED` 또는 후보.
5. `... --save` 로 Supabase 저장 후 대시보드 확인.

> **아직 미실행 → 로컬 real YOLO 재검증 필요.** (Codespaces는 모델·ultralytics·내부망 모두 없음)

---

## 12. Supabase 저장 확인 방법

`--save` 성공 시 콘솔에 읽기 전용 SQL이 안내된다(원격 `pmrdsagyoicuzwicsfjc` 기준):

```sql
select seat_id, activity, confidence, status, severity, decided_at, created_at
from public.ai_rule_decisions
where seat_id = 'Seat1'
order by created_at desc
limit 10;
```

- `insert` 만 발생(update/delete 없음), service role key 는 server-side `.env` 전용·출력 금지.

---

## 13. Admin Dashboard 확인 방법

1. 관리자 계정 접속 → 관리자 대시보드 → **AI 판정 현황**.
2. YOLO 연동 후에는 Seat1 단발 카드에 **공부 추정 / 휴대폰 추정 / 자리비움 추정** 등이 나타날 수 있음.
3. **"AI 추정 · 자동 변경 아님"** 문구 확인.
4. objects fact가 없으면 v0.2에서 추가한 **"카메라 연결 성공 · 판정 신호 부족"** 힌트 유지.
5. 학생 상태/출결/벌점이 **바뀌지 않았는지** 확인.

---

## 14. 테스트 결과 (Codespaces 실측)

| 스위트 | 결과 |
|---|---|
| `test_yolo_e2e_flow.py` (신규) | **6 passed** (시나리오 A/A'/B/C/D + objects 전달) |
| `test_seat1_e2e_test.py` | **19 passed** (v0.2 17 + v0.3 object 2) |
| `test_yolo_engine.py` | **10 passed** |
| `test_facts_fusion_engine.py` + `test_rule_engine.py` | **28 passed** |
| 합계(위 4스위트) | **63 passed** |

```
$ python -m pytest test_yolo_e2e_flow.py -q
......                                                                   [100%]
6 passed
```

프론트엔드: **v0.3 변경 없음** → type-check/vitest 재실행 불필요(직전 v0.2에서 tsc 클린 · vitest 35 passed).

---

## 15. 남은 기술부채

1. **실제 YOLO real 검증 미실행** — Codespaces에 모델·ultralytics·내부망 없음 → **로컬 재검증 필요**.
   fake로 흐름·후보 생성은 검증됐으나 실제 프레임에서의 검출 성능(조명/각도/천장 카메라)은 미확인.
2. **tablet 라벨 부재** — COCO 기본 모델엔 tablet이 없음. 커스텀 학습 전까지 tablet은 후순위.
3. **천장 카메라 각도** — person/book 검출률이 측면 대비 낮을 수 있음. ROI(현재 apply_roi=false)·confidence_threshold 실측 재보정 필요.
4. **시나리오 C 경계** — book만 있고 사람 없음(책상 위 책 + 자리비움)은 ABSENT vs STUDYING 충돌로 UNKNOWN(보수적). 실데이터로 규칙 가중치 재검토 여지.
5. **MediaPipe 미연동** — 손/자세 fact 부재로 SLEEPING·정밀 PHONE 판정은 제한적(다음 단계).
6. **object debug metrics는 fake만 실측** — real에서의 detected_labels/top_object_confidence 로컬 재확인 필요.

---

## 16. v0.4 개선계획

1. **로컬 real YOLO 검증**: `models/yolo_object.pt`(yolov8n) 배치 → Seat1 실제 프레임에서 person/phone/book/laptop 검출 확인, `--save` → 대시보드 표시.
2. **MediaPipe 연동**: 손/자세 human fact 추가 → SLEEPING·PHONE 정밀도 향상, `_rule_phone` hands_visible 가중치 실동작.
3. **confidence_threshold·ROI 실측 재보정**(천장 카메라 기준).
4. **duration 관찰로그**: `--duration`으로 Seat1 1일 관찰 → 안정화 후보(STABLE) 흐름 실검증.
5. **reason_code/object 메트릭을 metadata에 저장**해 대시보드가 원인·검출 라벨을 정밀 표시(스키마 변경, 후순위).

---

## 보안 체크리스트 (커밋 전)

- [x] `.env` 미추적(gitignore) — 실제 비밀번호/service role key 커밋 안 됨
- [x] RTSP URL은 항상 `rtsp://admin:****@192.168.219.50:554/stream2` 마스킹
- [x] service role key 출력/커밋 없음
- [x] 모델 파일(`*.pt`/`*.task`/`*.onnx`), `models/` gitignore — 커밋 대상 아님
- [x] 영상/이미지/프레임/스크린샷 저장 코드 없음(debug metrics는 수치/텍스트만)
- [x] `ai_rule_decisions` update/delete 없음(insert only, `--save` 시에만)
- [x] 학생 상태/출결/벌점/알림 자동 변경 없음

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**
