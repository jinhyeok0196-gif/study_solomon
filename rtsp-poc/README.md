# Solomon Camera / Scheduler / Orchestrator / AI Engine Core v0.1

TP-Link **VIGI C420I** 카메라의 RTSP 스트림을 수신·관리하고, 교시 기반 트리거로 프레임 묶음
(BurstPackage)을 만들어 **교체 가능한 AI Engine** 인터페이스로 전달하는 모듈군.

- **Camera Core v0.1** — 카메라 1대 RTSP 수신 코어 (`CameraCore`)
- **CameraManager v0.1** — Seat1~Seat8 **8대 관리 구조** (`CameraManager`)
- **Scheduler Engine v0.1** — 교시 기반 **Burst 트리거 생성** (`SchedulerEngine`)
- **Orchestrator Engine v0.1** — 트리거→큐→워커→**BurstPackage 생성** (`OrchestratorEngine`)
- **AI Engine Core v0.1** — **교체 가능한 AI 인터페이스** + Dummy (`AIEngine`/`AIManager`)
- **OpenCV Vision Engine v0.1** — 프레임 **전처리·품질검사·ROI** (`OpenCVEngine`)
- **MediaPipe Engine v0.1** — 얼굴/손/자세 **원자적 특징(Facts) 추출** (`MediaPipeEngine`)
- **YOLO Object Engine v0.1** — 휴대폰/책/노트북/태블릿/사람 **객체 Facts 추출** (`YOLOEngine`)
- **Facts Fusion Engine v0.1** — 세 엔진 결과를 **SeatFacts 로 통합** (`FactsFusionEngine`)
- **Rule Engine v0.1** — SeatFacts 로 **학생 상태 1차 판정** (`RuleEngine` → `RuleDecision`)
- **AI Decision Storage v0.1** — RuleDecision 을 **Supabase 에 저장** (`ai_rule_decisions` 테이블)
- **Admin AI Dashboard Read-only v0.1** — 저장된 판정을 **관리자 대시보드에서 읽기 전용 표시** (`src/features/admin-ai-decisions/`)
- **AI Decision Stabilizer v0.1** — 최근 3~5개 판정을 묶어 **좌석별 안정화 후보** 생성 (`DecisionStabilizer`)
- **Admin Dashboard Stabilized Candidate v0.1** — 대시보드에 **안정화 후보 read-only 표시**(프론트 read-derived 계산)
- **Seat1 Real Camera E2E Test v0.1** — 실제 Seat1 카메라로 **MVP 전체 흐름 검증 도구** (`seat1_e2e_test.py`)

> ⚠️ **범위: ... 안정화 후보 표시 + Seat1 E2E 검증까지만.** (운영 자동화 아님)
> **학생 상태 자동 변경 / 알림 / 벌점 / 출결 / 이용권 / 보호자 연락 / 영상·이미지 저장·표시는 구현하지 않습니다.**
> 관리자 대시보드는 RuleDecision 을 **보기만** 합니다 — AI 판정은 **보조 지표**이며 학생 상태를 자동으로 바꾸지 않습니다.

## 파일 구조

| 파일 | 역할 |
|------|------|
| `ring_buffer.py` | `FrameItem` + `RingBuffer` (deque, 스레드세이프, OpenCV 비의존) |
| `camera_core.py` | `CameraCore` — 카메라 1대 수신(Capture/Monitor 스레드 + 재연결) |
| `camera_config.py` | `CameraConfig` + cameras.yaml/json 로더(env 치환, OpenCV 비의존) |
| `camera_manager.py` | `CameraManager` — Seat1~Seat8 ↔ CameraCore 관리 |
| `schedule_config.py` | `ScheduleConfig`/`TriggerEvent` + schedule.yaml 로더(OpenCV 비의존) |
| `scheduler_engine.py` | `SchedulerEngine` — 교시 기반 Burst 트리거 생성 |
| `burst_package.py` | `BurstPackage`/`ErrorItem` (OpenCV/AI 비의존) |
| `trigger_queue.py` | `TriggerQueue` — 스레드세이프 메모리 큐(overflow 방지) |
| `orchestrator_engine.py` | `OrchestratorEngine` — 트리거→큐→워커→BurstPackage |
| `analysis_result.py` | `AnalysisResult` (AI 분석 결과 구조) |
| `ai_engine.py` | `AIEngine` 추상 인터페이스(initialize/analyze/shutdown/health) |
| `plugins/dummy_engine.py` | `DummyAIEngine` — 인터페이스 자리표시자(UNKNOWN/0) |
| `engine_registry.py` | 이름→엔진 생성 레지스트리 |
| `ai_manager.py` | `AIManager` — 엔진 로드/언로드/리로드/분석/상태 |
| `ai_demo.py` | **AI Engine Core 데모**(`--dummy --burst-count N`) |
| `vision_result.py` | `VisionResult` (전처리/품질 결과) |
| `vision_utils.py` | OpenCV 품질·전처리 함수(blur/brightness/contrast/sharpness/crop_roi/validate) |
| `plugins/opencv_engine.py` | `OpenCVEngine` — 전처리·품질검사·ROI(AIEngine 구현) |
| `config/roi.yaml` | 좌석별 ROI(Seat1~8 rectangle) |
| `vision_demo.py` | **Vision Engine 데모**(`--dummy`/`--real`) |
| `mediapipe_result.py` | `MediaPipeResult` (얼굴/손/자세 원자적 특징 묶음) |
| `mediapipe_backend.py` | `MediaPipeBackend`(실제 Tasks API) + `FakeMediaPipeBackend`(테스트) |
| `plugins/mediapipe_engine.py` | `MediaPipeEngine` — 특징 추출(AIEngine 구현, cv2/mediapipe 비의존) |
| `config/mediapipe.yaml` | MediaPipe detector/모델경로/런타임 설정 |
| `mediapipe_demo.py` | **MediaPipe Engine 데모**(`--fake`/`--dummy-frames`/`--real`) |
| `test_mediapipe_engine.py` | MediaPipe 엔진 테스트(모델 파일 없이 Fake backend) |
| `object_detection_result.py` | `ObjectDetectionResult` (객체 원자적 특징 묶음) |
| `object_label_mapper.py` | `ObjectLabelMapper` — YOLO 원본 라벨 → 표준 라벨 정규화 |
| `yolo_backend.py` | `YOLOBackend`(실제 Ultralytics) + `FakeYOLOBackend`(테스트) |
| `plugins/yolo_engine.py` | `YOLOEngine` — 객체 추출(AIEngine 구현, cv2/ultralytics 비의존) |
| `config/yolo.yaml` | YOLO 모델/런타임/target_objects 라벨 매핑 설정 |
| `yolo_demo.py` | **YOLO Engine 데모**(`--fake`/`--dummy-frames`/`--real`) |
| `test_yolo_engine.py` | YOLO 엔진 테스트(모델 파일 없이 Fake backend) |
| `seat_facts.py` | `SeatFacts` — 좌석 단위 관측 사실 모음(Rule Engine 표준 입력) |
| `fusion_result.py` | `FusionResult` — 통합 결과/상태(SUCCESS/PARTIAL/FAILED/SKIPPED) |
| `facts_fusion_engine.py` | `FactsFusionEngine` — OpenCV/MediaPipe/YOLO 결과 → SeatFacts |
| `fusion_demo.py` | **Fusion 데모**(`--all`/`--missing-yolo`/`--failed-mediapipe`) |
| `test_facts_fusion_engine.py` | Fusion 엔진 테스트(합성 AnalysisResult) |
| `activity_labels.py` | 표준 activity(STUDYING/PHONE/SLEEPING/ABSENT/UNKNOWN) + status/severity |
| `rule_decision.py` | `RuleDecision` — 1차 판정 결과(activity/confidence/severity/reasons/evidence) |
| `config/rules.yaml` | Rule Engine 임계값/가중치/규칙 토글 |
| `rule_engine.py` | `RuleEngine` — SeatFacts → RuleDecision 판정 |
| `rule_demo.py` | **Rule Engine 데모**(`--studying/--phone/--absent/--sleeping/--unknown`) |
| `test_rule_engine.py` | Rule 엔진 테스트(합성 SeatFacts) |
| `decision_serializer.py` | `RuleDecision` → 저장용 dict 직렬화/검증 |
| `supabase_client.py` | service-role Supabase 클라이언트(lazy, 키는 env 에서만) |
| `ai_decision_repository.py` | `AIDecisionRepository`(Supabase) + `FakeAIDecisionRepository`(테스트) |
| `ai_decision_storage_pipeline.py` | `AIDecisionStoragePipeline` — SeatFacts→판정→저장 |
| `decision_storage_demo.py` | **저장 데모**(`--fake --save-disabled` / `--fake --save`) |
| `test_ai_decision_storage.py` | 저장 파이프라인 테스트(Fake repo, Supabase 불필요) |
| `../supabase/migrations/20260708000000_ai_rule_decisions.sql` | `ai_rule_decisions` 테이블 migration |
| `main.py` | Camera Core 실행(단일 카메라, `RTSP_URL`) |
| `manage.py` | **CameraManager 실행**(다중 좌석, cameras.yaml) |
| `scheduler_demo.py` | **SchedulerEngine 데모**(교시/트리거 확인) |
| `orchestrator_demo.py` | **OrchestratorEngine 데모**(`--once --fake` 등) |
| `cameras.yaml` | Seat1~Seat8 설정 예시 |
| `schedule.yaml` | 0~8교시 시간표 |
| `test_camera_core.py` / `test_camera_manager.py` / `test_scheduler_engine.py` | 통합 테스트(카메라 없이) |
| `.env.example` | 민감정보(RTSP URL) 템플릿 |
| `CODE_REVIEW_v0.1.md` / `CAMERA_MANAGER_v0.1.md` / `SCHEDULER_ENGINE_v0.1.md` | 단계별 리뷰 문서 |
| `rtsp_poc.py` | (레거시) 초기 단일파일 PoC |

## Scheduler Engine v0.1

교시 시간표(`schedule.yaml`)를 기반으로 **언제 Burst Analysis 를 요청할지** TriggerEvent 를 생성한다.
**AI 를 호출하지 않고, CameraManager 에 강하게 의존하지 않는다**(느슨한 연결).

### 트리거 규칙 (study_period 기준)
| 시점 | trigger_type |
|------|--------------|
| 교시 시작 5분 후 | `start_attendance_check` |
| 교시 종료 5분 전 | `end_attendance_check` |
| 교시 중 15~20분 간격 | `mid_study_check` |
| 교시 중 랜덤 1~2회(시드 고정) | `random_study_check` |
| 수동 | `manual_check` |
| break / meal / attendance_check 교시 | (트리거 없음) |

- 같은 `trigger_id` 는 **하루 한 번만** 실행(메모리 dedup). `trigger_id = 날짜_교시_타입[_시각]`.
- `target_seats` 기본 `["all"]` — 실제 좌석 매핑은 향후 Orchestrator 가 수행.

### 설정 (`schedule.yaml`)
```yaml
periods:
  - period_id: P0
    name: "0교시"
    start_time: "09:00"
    end_time: "09:50"
    type: study_period        # attendance_check | study_period | meal | break
    enabled: true
```

### 실행 (`scheduler_demo.py`)
```bash
python scheduler_demo.py --now 09:05     # 현재/다음 교시 + 트리거 여부
python scheduler_demo.py --now 12:00     # 점심(트리거 없음) 확인
python scheduler_demo.py --timeline      # 오늘 교시 + 계획된 트리거 전체
```

### 다음 단계 (CameraManager 연결, 이번 범위 아님)
향후 **Orchestrator** 가 주기적으로 `SchedulerEngine.get_due_triggers(now)` 를 폴링 →
각 `TriggerEvent.target_seats` 에 대해 `CameraManager.get_recent_frames(seat_id, 3)` 호출 →
(그 다음 단계에서) AI Burst Analysis. SchedulerEngine 자체는 카메라/AI 를 모른다.

### 테스트
```bash
python test_scheduler_engine.py
# 09:05 start / dedup / 09:45 end / meal무트리거 / current_period / timeline / 필드
```

## Orchestrator Engine v0.1

Scheduler ↔ CameraManager ↔ (향후 AI Engine)을 잇는 **중앙 제어 엔진**.
트리거를 받아 큐에 넣고, 워커가 CameraManager에서 프레임을 가져와 **BurstPackage**를 만든다.
**AI는 호출하지 않는다.**

### 전체 흐름
```
SchedulerEngine.get_due_triggers(now)
      ↓
  Trigger Queue (enqueue, overflow 방지)
      ↓
  Worker Thread (dequeue)
      ↓
  target_seats 해석 (["all"] → 현재 running 카메라)
      ↓
  CameraManager.get_recent_frames(seat_id, 3)   ← 실패 시 Retry 2회 → Error Queue
      ↓
  BurstPackage 생성  → burst_consumer 콜백(기본 sink)
      ↓
  (향후 AI Engine)   ← Orchestrator 수정 없이 consumer 교체
```

### 핵심 설계 (느슨한 연결)
- `scheduler`/`camera_manager`는 **덕타이핑**(메서드 시그니처)만 의존 → Fake로 대체 가능.
- `burst_consumer`는 **콜백**(기본은 로그+메모리 보관, AI 아님) → 향후 AI Engine으로 교체해도
  **OrchestratorEngine 코드는 수정하지 않는다.**
- 기존 CameraCore/CameraManager/SchedulerEngine은 **수정 없이 재사용**.

### BurstPackage
`burst_uuid / trigger_uuid / trigger_id / trigger_type / period_id / period_name /
seat_id / captured_at / frame_count / frames / metadata`
(`frames`는 CameraManager가 준 최근 N초 FrameItem 리스트, `metadata`는 queue_delay/processing/attempts 등.)

### 실행 (`orchestrator_demo.py`)
```bash
# 하드웨어 없이 흐름 확인(가짜 Scheduler/CameraManager → 즉시 BurstPackage)
python orchestrator_demo.py --once --fake

# 실제 모듈 연결(cameras.yaml + schedule.yaml)
python orchestrator_demo.py --run --duration 600 --headless
python orchestrator_demo.py --once --now 09:05
```
| 옵션 | 설명 |
|------|------|
| `--run` | 폴링/워커 스레드 모드로 계속 실행 |
| `--once` | 1회 폴링 + 큐 처리 후 종료 |
| `--fake` | 가짜 Scheduler/CameraManager로 흐름만 확인 |
| `--duration N` | `--run` N초 후 종료 |
| `--now HH:MM` | `--once` 기준 시각 |
| `--headless` | 영상 창 없이(오케스트레이터는 본래 창 없음) |

### 다음 단계 (이번 범위 아님)
`burst_consumer` 자리에 **AI Engine**(MediaPipe/YOLO 등)을 끼워 BurstPackage를 분석.
그 다음 Rule Engine → Supabase 저장 → 대시보드. **이번 단계는 BurstPackage 생성까지만.**

### 테스트
```bash
python test_orchestrator_engine.py
# queue / burst / multiseat / retry / overflow / worker / shutdown
```

## AI Engine Core v0.1

**교체 가능한 AI 인터페이스**만 구축한다. 실제 분석은 없다(Dummy만).

### 파이프라인
```
BurstPackage → AIManager.analyze() → AIEngine.analyze() → AnalysisResult → (향후 Rule Engine)
```
OrchestratorEngine 의 `burst_consumer` 에 `AIManager.analyze` 를 그대로 연결한다
(**Orchestrator 코드 수정 0**):
```python
ai = AIManager(engine_name="dummy")
orch = OrchestratorEngine(scheduler, camera_manager, burst_consumer=ai.analyze)
```

### Plugin / Registry (엔진 교체 구조)
```
engine_registry:  "dummy" → DummyAIEngine
                  (향후) "mediapipe" → MediaPipeEngine   # lazy register
                         "yolo"      → YOLOEngine
모든 엔진은 AIEngine(initialize/analyze/shutdown/health) 인터페이스를 구현.
AIManager.load_engine("dummy") / unload_engine() / reload() 로 교체.
```

### AnalysisResult
`analysis_uuid / burst_uuid / seat_id / started_at / finished_at / processing_time(ms) /
confidence / status(SUCCESS|FAILED|SKIPPED) / activity(현재 "UNKNOWN") / scores / metadata`

### 실행 (`ai_demo.py`)
```bash
python ai_demo.py --dummy --burst-count 5
# Dummy BurstPackage 5개 → AnalysisResult(activity=UNKNOWN, conf=0, status=SUCCESS)
```

### 향후 확장 (이번 범위 아님)
`plugins/` 에 `MediaPipeEngine` / `YOLOEngine` / `OpenCVEngine` / `VisionTransformerEngine` 를
**같은 AIEngine 인터페이스**로 추가하고 registry 에 등록 → `AIManager.load_engine(name)` 로 교체.
**AIManager/Orchestrator 코드는 수정하지 않는다.** 실제 판별·Rule Engine·Supabase·대시보드는 다음 단계.

### 테스트
```bash
python test_ai_engine.py
# registry / dummy / manager+swap / failed(SKIPPED·FAILED)
```

## OpenCV Vision Engine v0.1

`OpenCVEngine` 은 AIEngine 인터페이스를 구현하지만 **판별은 하지 않는다.**
프레임을 **검증·ROI crop·품질계산** 해서 향후 MediaPipe/YOLO 가 쓸 표준 입력을 만든다.

### 파이프라인
```
BurstPackage → OpenCVEngine.analyze() → (프레임별 검증/ROI/품질) → VisionResult → AnalysisResult → (향후 MediaPipe/YOLO)
```
`AnalysisResult.activity` 는 항상 **"UNKNOWN"** (OpenCV 는 활동 판별 안 함).
품질 지표는 `scores`(blur/brightness/contrast/sharpness)와 `metadata.vision` 에 담긴다.

### Frame Validation (자동 제외)
| 사유 | 기준 |
|------|------|
| `empty` | None / size 0 |
| `corrupt` | ndarray 아님 / 잘못된 형상 |
| `too_dark` | 밝기 < `min_brightness`(기본 25) |
| `too_blurry` | Laplacian 분산 < `min_blur`(기본 12) |
제외된 프레임 수는 `AnalysisResult.metadata.discarded_frames` 와 사유별 `discard_reasons` 에 기록.

### ROI (`config/roi.yaml`)
좌석별 사각형(`x,y,w,h`, 픽셀). 좌석에 ROI 가 있으면 그 영역만 분석(`roi_applied=True`),
없으면 전체 프레임. 경계 초과 시 자동 클램프.
```yaml
rois:
  Seat1: { x: 0, y: 0, w: 424, h: 240 }
```

### VisionResult
`vision_uuid / frame_count / valid_frames / blur_score / brightness / contrast /
sharpness / roi_applied / metadata(resolution·discard_reasons·timestamps)`

### 실행 (`vision_demo.py`)
```bash
python vision_demo.py --dummy --frames 6     # 합성 프레임 품질 출력
python vision_demo.py --real --seat 1        # 실제 카메라(cameras.yaml + .env)
```

### 엔진 교체 / 다음 단계
`AIManager.load_engine("opencv")` 로 dummy↔opencv 교체(코드 무수정).
향후 MediaPipe/YOLO 엔진은 OpenCVEngine 이 만든 **검증 통과 프레임/ROI** 를 입력으로 받는다.
이번 단계는 **전처리·품질검사까지만** — 행동/사람/휴대폰 판별, Rule Engine, Supabase, 대시보드는 미구현.

### 테스트
```bash
python test_vision_engine.py
# utils / validate / crop_roi / engine / roi
```

## MediaPipe Engine v0.1

`MediaPipeEngine` 은 AIEngine 인터페이스를 구현하지만 **최종 행동 판별을 절대 하지 않는다.**
MediaPipe **Face / Pose / Hands Landmarker** 로 BurstPackage 프레임에서 **원자적 특징(Facts)** 만 뽑는다.

> **왜 판별을 안 하나?** MediaPipe 는 "고개가 숙여졌다/손이 보인다" 같은 **관측값**만 제공한다.
> "공부 중 / 휴대폰 사용 / 졸음 / 자리비움" 같은 **해석·판단**은 여러 특징을 조합해야 하므로
> 나중에 **Rule Engine** 이 담당한다. 엔진을 추출기와 판단자로 분리해야 교체·검증이 쉽다.

### 파이프라인
```
BurstPackage → 프레임 샘플링 → 프레임 검증 → (BGR→RGB)
            → MediaPipe Face/Pose/Hands → MediaPipeResult → AnalysisResult
```
- `AnalysisResult.activity` 는 항상 **"UNKNOWN"**.
- `AnalysisResult.confidence` 는 행동 신뢰도가 아니라 **landmark 추출 품질 점수**다.
- `scores` = `quality_score / face_visible_ratio / hands_visible_ratio / pose_visible_ratio`.

### Landmarker 역할 (관측만, 해석 X)
| Detector | 추출하는 원자적 특징 |
|----------|----------------------|
| **Face** | 얼굴 검출 여부, 랜드마크 수, 대략적 머리 중심(`approximate_head_center`), presence |
| **Pose** | 자세 검출 여부, 랜드마크 수, 어깨 가시성, 상체 가시성 |
| **Hands** | 손 검출 여부, 손 개수, 좌/우 라벨, 랜드마크 수 |

> 고개 숙임/졸음/공부/휴대폰 같은 해석은 하지 않는다. 각도도 원시 특징 수준으로만 본다.

### `MediaPipeResult`
`mediapipe_uuid / frame_count / analyzed_frames / valid_frames /
face_detected·face_detection_count / pose_detected·pose_detection_count /
hands_detected·hand_detection_count·max_hands /
avg_face|pose|hand_landmarks / head_features / hand_features / pose_features /
quality_score / metadata`

### Backend 구조 (실제 ↔ Fake 분리)
- `MediaPipeBackend` — Google **MediaPipe Tasks API** 기반. `mediapipe` 는 `initialize()` 에서만 **lazy import**.
  모델 파일이 없으면 해당 detector 만 자동 비활성화(전체 크래시 없음).
- `FakeMediaPipeBackend` — `mediapipe`/모델 파일 **없이** 결정적 Facts 반환. 테스트·데모용.
- 엔진은 cv2/mediapipe 를 import 하지 않는다(BGR→RGB·ROI crop 은 numpy 슬라이싱).

### 설정 (`config/mediapipe.yaml`)
```yaml
enabled_detectors: { face: true, pose: true, hands: true }
model_paths:
  face_landmarker: "models/face_landmarker.task"
  pose_landmarker: "models/pose_landmarker.task"
  hand_landmarker: "models/hand_landmarker.task"
runtime:
  delegate: "CPU"
  max_faces: 1
  max_hands: 2
  min_detection_confidence: 0.5
  min_tracking_confidence: 0.5
  sample_every_n_frames: 2      # N프레임마다 1장 분석
  max_analyzed_frames: 10       # Burst 당 분석 상한
```

### MediaPipe 모델 파일 (레포 미포함)
모델(`.task`)은 **용량/라이선스** 때문에 레포에 넣지 않는다(`models/`, `*.task` 는 `.gitignore`).
실제(`--real`) 실행 전 직접 내려받아 `rtsp-poc/models/` 에 배치한다:
```bash
mkdir -p models
# Google 공식 모델(google.github.io/mediapipe → MediaPipe Solutions/Models):
#   face_landmarker.task / pose_landmarker.task(또는 _lite/_full/_heavy) / hand_landmarker.task
curl -L -o models/face_landmarker.task <FACE_LANDMARKER_TASK_URL>
curl -L -o models/pose_landmarker.task <POSE_LANDMARKER_TASK_URL>
curl -L -o models/hand_landmarker.task <HAND_LANDMARKER_TASK_URL>
pip install mediapipe              # 실제 backend 사용 시에만 필요
```
파일명이 다르면 `config/mediapipe.yaml` 의 `model_paths` 를 맞춰 수정한다.

### 실행 (`mediapipe_demo.py`)
```bash
python mediapipe_demo.py --fake               # Fake backend(모델 파일 불필요)
python mediapipe_demo.py --dummy-frames 5     # 합성 프레임 5장
python mediapipe_demo.py --real --seat 1      # 실제 카메라 + 모델 파일 필요
```

### 테스트 (모델 파일 없이)
```bash
python test_mediapipe_engine.py
# init / metadata / skipped / failed / sampling / disabled / registry / intact
```
`FakeMediaPipeBackend` 덕분에 **실제 mediapipe·모델 파일 없이** 전부 통과한다.

### 엔진 교체 / 다음 단계
`AIManager.load_engine("mediapipe")` 로 교체(코드 무수정). MediaPipe 가 만든 특징은
향후 **YOLO**(휴대폰 등 객체)와 함께 **Rule Engine** 의 입력이 되어 최종 행동을 판별한다.
이번 단계는 **특징 추출까지만** — 행동 판별/YOLO/Rule Engine/Supabase/대시보드는 미구현.

## YOLO Object Engine v0.1

`YOLOEngine` 은 AIEngine 인터페이스를 구현하지만 **최종 행동 판별을 절대 하지 않는다.**
YOLO Object Detection 으로 BurstPackage 프레임에서 **객체 관련 원자적 특징(Facts)** 만 뽑는다.

> **왜 행동 판별을 안 하나?** YOLO 는 "휴대폰 객체가 보였다 / 사람이 2명 있다" 같은 **관측값**만 준다.
> "휴대폰 사용 중 / 자리비움" 같은 **판단**은 MediaPipe(자세·손) 특징과 조합해야 하므로
> 나중에 **Rule Engine** 이 담당한다. 추출기와 판단자를 분리해야 교체·검증이 쉽다.

### 파이프라인
```
BurstPackage → 프레임 샘플링 → 프레임 검증 → (선택)ROI crop
            → YOLO Backend → ObjectDetectionResult → AnalysisResult
```
- `AnalysisResult.activity` 는 항상 **"UNKNOWN"**.
- `AnalysisResult.confidence` 는 행동 신뢰도가 아니라 **객체 검출 품질 점수**(평균 신뢰도)다.
- `scores` = `quality_score / phone_score / book_score / laptop_score / tablet_score / person_score`.

### 객체 Facts (관측만, 해석 X)
| 표준 라벨 | 추출하는 원자적 특징 |
|-----------|----------------------|
| **phone** | 검출 여부 / 검출 프레임 수 / 최대 신뢰도 |
| **book** | 검출 여부 / 검출 프레임 수 |
| **laptop** | 검출 여부 / 검출 프레임 수 |
| **tablet** | 검출 여부 / 검출 프레임 수 |
| **person** | 검출 여부 / 검출 프레임 수 / **max_person_count**(한 프레임 최대 인원) |

> "휴대폰 객체가 보였다" 까지만. "휴대폰을 사용 중" 이라고 판단하지 않는다.

### `ObjectLabelMapper` (라벨 정규화)
YOLO 원본 라벨(예: COCO `cell phone`)을 **Solomon 표준 라벨**(`phone/book/laptop/tablet/person`)로 변환.
매핑 안 되는 라벨은 `unknown_object`. 매핑 규칙은 `config/yolo.yaml` 의 `target_objects` 를 우선 사용.
```
"cell phone" / "mobile phone" → phone     "ipad" → tablet     "traffic light" → unknown_object
```

### bbox 좌표
각 검출(`detected_objects` 항목)은 **원본 픽셀**과 **정규화(0~1)** 좌표를 모두 보관한다.
```python
{"frame_index": 0, "label": "phone", "source_label": "cell phone", "confidence": 0.87,
 "bbox_xyxy": [10, 10, 80, 160], "bbox_normalized": [0.0312, 0.0417, 0.25, 0.6667], "class_id": 67}
```

### `ObjectDetectionResult`
`object_uuid / frame_count / analyzed_frames / valid_frames / detected_objects / object_counts /
max_person_count / {phone,book,laptop,tablet,person}_detected·_detection_count /
avg_detection_confidence / max_detection_confidence / quality_score / metadata`

### Backend 구조 (실제 ↔ Fake 분리)
- `YOLOBackend` — **Ultralytics YOLO** 기반. `ultralytics` 는 `initialize()` 에서만 **lazy import**.
  모델 파일이 없으면 `initialize()` 에서 명확히 실패(FileNotFoundError).
- `FakeYOLOBackend` — `ultralytics`/모델 파일 **없이** 결정적 검출 목록 반환. 테스트·데모용.
- 엔진은 cv2/ultralytics 를 import 하지 않는다(검증·ROI crop 은 numpy, YOLO 는 BGR 그대로).

### 설정 (`config/yolo.yaml`)
```yaml
model:
  path: "models/yolo_object.pt"
  device: "cpu"
  image_size: 640
  confidence_threshold: 0.35
  iou_threshold: 0.45
runtime:
  sample_every_n_frames: 2
  max_analyzed_frames: 10
  apply_roi: false
target_objects:
  phone:  { labels: ["cell phone", "phone", "mobile phone"] }
  book:   { labels: ["book"] }
  laptop: { labels: ["laptop"] }
  tablet: { labels: ["tablet", "ipad"] }
  person: { labels: ["person"] }
```

### YOLO 모델 파일 (레포 미포함)
모델(`.pt`)은 **용량/라이선스** 때문에 레포에 넣지 않는다(`models/`, `*.pt` 는 `.gitignore`).
실제(`--real`) 실행 전 직접 내려받아 `rtsp-poc/models/` 에 배치한다:
```bash
mkdir -p models
# Ultralytics 사전학습(COCO) 또는 커스텀 학습 모델:
#   예) yolov8n.pt / yolov8s.pt — github.com/ultralytics/ultralytics
curl -L -o models/yolo_object.pt <YOLO_WEIGHTS_URL>
pip install ultralytics            # 실제 backend 사용 시에만 필요
```
파일명이 다르면 `config/yolo.yaml` 의 `model.path` 를 맞춰 수정한다.

### 실행 (`yolo_demo.py`)
```bash
python yolo_demo.py --fake               # Fake backend(모델 파일 불필요)
python yolo_demo.py --dummy-frames 5     # 합성 프레임 5장
python yolo_demo.py --real --seat 1      # 실제 카메라 + 모델 파일 필요
```

### 테스트 (모델 파일 없이)
```bash
python test_yolo_engine.py
# init / metadata / bbox / skipped / failed / sampling / label_mapper / unknown / registry / intact
```
`FakeYOLOBackend` 덕분에 **실제 ultralytics·모델 파일 없이** 전부 통과한다.

### 엔진 교체 / 다음 단계 (MediaPipe + YOLO + Rule Engine)
`AIManager.load_engine("yolo")` 로 교체(코드 무수정).
앞으로 **Rule Engine** 이 **MediaPipe Facts**(얼굴·손·자세)와 **YOLO Facts**(휴대폰·책·노트북·사람)를
조합해 최종 행동(공부/휴대폰 사용/수면/자리비움)을 판별한다.
이번 단계는 **객체 추출까지만** — 행동 판별/Rule Engine/Supabase/대시보드/학생 상태 변경은 미구현.

## Facts Fusion Engine v0.1

`FactsFusionEngine` 은 OpenCV/MediaPipe/YOLO 의 `AnalysisResult` 세 개를 받아 **하나의 `SeatFacts`** 로 합친다.
**AI 분석기가 아니라 결과 통합기**라서 `AIEngine` 을 상속하지 않는다.

> **왜 Fusion 이 필요한가?** 세 엔진은 각자 다른 사실을 본다 — OpenCV(프레임 품질),
> MediaPipe(얼굴·손·자세), YOLO(객체). Rule Engine 이 행동을 판단하려면 이 흩어진 사실을
> **좌석·교시 단위로 모은 표준 입력** 이 필요하다. 그 표준 입력이 `SeatFacts` 다.
> Fusion 단계는 **여전히 어떤 판단도 하지 않는다** — 사실을 모으기만 한다.

### 파이프라인 / 역할 정리
```
OpenCV AnalysisResult  ─┐
MediaPipe AnalysisResult ─┼─▶ FactsFusionEngine.fuse() ─▶ FusionResult(SeatFacts)
YOLO AnalysisResult     ─┘
```
- source 구분: `AnalysisResult.metadata["engine"]` → `opencv`=vision / `mediapipe`=human / `yolo`=objects.
- 알 수 없는 engine → `metadata.unknown_sources` 기록.

### `SeatFacts` 구조 (관측된 사실 모음, 판단 아님)
| 섹션 | 내용(요약) |
|------|-----------|
| `vision` | blur/brightness/contrast/sharpness, valid/discarded_frames, discard_reasons, roi_applied, resolution |
| `human` | face/hands/pose_detected, *_visible_ratio, approximate_head_center, left/right_hand, shoulder/upper_body_visible |
| `objects` | phone/book/laptop/tablet/person_detected·_count, max_person_count, object_counts, avg/max_confidence |
| `quality` | vision/human/object/overall_quality, **usable_for_rule_engine** |
| `source_results` | 입력으로 쓴 AnalysisResult UUID 목록 |
| `metadata` | present/missing/unknown sources, engine_status, errors |

식별자: `facts_uuid / burst_uuid / seat_id / period_id / period_name / captured_at / generated_at`.
(교시·시각 정보는 `fuse(results, context=...)` 로 보강 — AnalysisResult 에 없는 값이라 선택 주입.)

### `FusionResult` 상태
| status | 의미 |
|--------|------|
| **SUCCESS** | OpenCV·MediaPipe·YOLO 가 **모두 present + 모두 SUCCESS** |
| **PARTIAL** | 일부 누락/실패했지만 SeatFacts 생성 가능(누락→`missing_sources`, 실패→`errors`) |
| **FAILED** | present 한 source 가 **전부 FAILED**, **또는 seat_id/burst_uuid 불일치**(서로 다른 좌석·Burst 혼입), 또는 통합 중 예외 → SeatFacts None |
| **SKIPPED** | 입력에 **알려진 source 가 하나도 없음**(빈 입력 또는 unknown engine 만) → SeatFacts None |

`metadata` 추적 필드: `source_statuses`(opencv/mediapipe/yolo 각 상태, 누락은 `MISSING`),
`present_sources` / `missing_sources` / `unknown_sources` / `duplicate_sources`(같은 engine 이 2번 오면
**최신 1개만 사용**하고 여기에 기록), 불일치 시 `consistency_error: true`.

### Quality Score 의미 (행동 신뢰도 아님 = "판정 재료의 품질")
```
vision_quality = OpenCV SUCCESS면 1.0, 아니면 0.0
human_quality  = MediaPipe scores.quality_score (FAILED면 0.0)
object_quality = YOLO scores.quality_score (FAILED면 0.0)
overall_quality = 위 중 "present 한 것들" 의 평균   (누락 source 는 제외)
usable_for_rule_engine = overall_quality >= 0.3
```

### 실행 (`fusion_demo.py`)
```bash
python fusion_demo.py --all                # 세 엔진 → SUCCESS
python fusion_demo.py --missing-yolo       # YOLO 누락 → PARTIAL
python fusion_demo.py --failed-mediapipe   # MediaPipe FAILED → PARTIAL
```

### 테스트
```bash
python test_facts_fusion_engine.py
# all_success / quality / threshold / missing_yolo / failed_mediapipe / all_failed / empty / unknown / no_activity / intact
```

### 향후 Rule Engine 연결
`SeatFacts` 는 **Rule Engine v0.1 의 표준 입력**이다. Rule Engine 이 `vision/human/objects` 사실과
`quality.usable_for_rule_engine` 를 보고 비로소 **행동(공부/휴대폰 사용/수면/자리비움)** 을 판별한다.
**이때 처음으로 `activity` 가 UNKNOWN 이 아니게 된다.** 이번 단계는 **사실 통합까지만**.

## Rule Engine v0.1

`RuleEngine` 은 `SeatFacts` 를 받아 학생 상태를 **1차 판정**해 `RuleDecision` 을 만든다.
**AI 분석기가 아니라 규칙 판정기**라서 `AIEngine` 을 상속하지 않는다.
**이 단계에서 처음으로 `activity` 가 UNKNOWN 이 아닌 값**(STUDYING/PHONE/SLEEPING/ABSENT)이 나온다.

> ⚠️ **판정 결과 생성까지만.** Supabase 저장 / Dashboard 표시 / 학생 상태 변경 / 알림(보호자·관리자) /
> 벌점·출결·이용권 처리는 **하지 않는다.** RuleDecision 은 아직 화면에 보이지 않는 데이터다.

### 흐름
```
SeatFacts → RuleEngine.decide() → RuleDecision(activity, confidence, severity, reasons, evidence, rule_hits)
```

### activity 종류 / severity
| activity | 의미 | severity(기본) |
|----------|------|----------------|
| `STUDYING` | 학습 도구 + 사람/손/자세, 휴대폰 약함 | INFO |
| `PHONE` | 휴대폰 객체 + 손/사람, 책·노트북 없음 | WARNING |
| `SLEEPING` | 자세는 있으나 손·얼굴 가시성 매우 낮음(매우 보수) | WATCH |
| `ABSENT` | 사람/얼굴/자세/손 모두 미검출(보수) | WARNING |
| `UNKNOWN` | 품질 부족/근거 부족/신호 충돌/애매 | INFO |

- **confidence**(0~1): 해당 규칙의 가중치 합산 점수. 임계값 이상일 때만 그 activity 로 확정.
- **severity**: INFO < WATCH < WARNING < CRITICAL. 신뢰 못하는 판정(SKIPPED/FAILED/LOW_CONFIDENCE)은 INFO.
- **status**: SUCCESS / SKIPPED(입력 None) / FAILED(예외) / LOW_CONFIDENCE(품질·근거 부족).

### 판정 우선순위 (v0.1)
```
1) 입력 불가 / 품질 낮음        → UNKNOWN (SKIPPED/LOW_CONFIDENCE)
2) ABSENT(자리비움) 후보
3) PHONE(휴대폰) 후보
4) SLEEPING(수면) 후보
5) STUDYING(공부) 후보
6) 애매 / 신호 충돌            → UNKNOWN
```
- **휴대폰 객체가 보였다고 무조건 PHONE 이 아니다** — 손/책/노트북/사람/품질을 함께 본다(가중치).
- **책이 보였다고 무조건 STUDYING 이 아니다** — 사람/손/자세와 휴대폰 약함을 함께 본다.
- 상위 두 후보 confidence 차가 `conflict_margin` 미만이면 **충돌 → UNKNOWN**.

### 왜 v0.1 은 보수적인가 (천장 카메라 한계)
현재 카메라는 **천장 설치**라 사람/얼굴 검출이 자주 실패한다. 그래서:
- ABSENT/SLEEPING 의 confidence 를 **무리하게 높이지 않는다**(SLEEPING 은 상한까지 둠).
- 수면은 **motion score 가 없어** 강하게 판정하지 않고, 애매하면 UNKNOWN.
- **측면 카메라 실데이터 확보 후** 임계값/규칙을 재보정해야 한다.
파워냅은 AI activity 가 아니라 **학생이 직접 누르는 수동 상태**로 유지한다(Rule Engine 이 판정 안 함).

### 설정 (`config/rules.yaml`)
`thresholds`(min_overall_quality / phone·studying·absent·sleeping_confidence / conflict_margin),
`weights`(phone_object/hands_visible/no_book/no_laptop/person_present), `rules`(규칙 on/off).
**임계값은 코드 하드코딩 없이 전부 여기서 읽는다.**

### 실행 (`rule_demo.py`)
```bash
python rule_demo.py --studying     # → STUDYING
python rule_demo.py --phone        # → PHONE
python rule_demo.py --absent       # → ABSENT
python rule_demo.py --sleeping     # → SLEEPING(보수)
python rule_demo.py --unknown      # → UNKNOWN(LOW_CONFIDENCE)
```

### 테스트
```bash
python test_rule_engine.py
# studying / phone / absent / sleeping / low_quality / none / conflict / fields / no_powernap / config / intact
```

### 다음 단계 연결
RuleDecision 은 다음 단계에서 **저장/표시 파이프라인**(예: 영속화 → 대시보드)에 연결된다.
그때 비로소 화면에 보이고, **그 이후** 단계에서야 학생 상태 변경/알림 등을 신중히 검토한다.
이번 단계는 **판정 결과 생성까지만**.

## AI Decision Storage v0.1

`AIDecisionStoragePipeline` 은 `SeatFacts → RuleEngine.decide() → RuleDecision → Supabase 저장`
까지를 묶는다. **저장까지만** 하고 그 이후(표시/상태 변경/알림)는 하지 않는다.

> **왜 저장 단계가 필요한가?** 판정 결과를 남겨야 나중에 관리자 화면에서 **읽기 전용**으로 보여주고,
> 오탐을 디버깅·튜닝할 근거가 생긴다. 단, **저장은 학생 상태를 바꾸지 않는다** — 출결/벌점/이용권은
> 사람·정책이 별도로 결정할 일이지 AI 저장이 자동으로 건드리지 않는다(안전 분리).

### 흐름
```
SeatFacts → RuleDecision → decision_serializer(검증+ISO/JSON) → AIDecisionRepository.save_decision()
                                                              → Supabase: public.ai_rule_decisions
```

### `ai_rule_decisions` 테이블 (저장 구조)
RuleDecision 의 텍스트/JSON 결과만 저장한다(**영상·이미지는 저장하지 않음**).
- 식별: `decision_uuid`(unique) / `facts_uuid` / `burst_uuid` / `seat_id` / `period_id` / `period_name` / `decided_at`
- 판정: `activity` / `confidence` / `status` / `severity`
- 근거(JSONB): `reasons` / `evidence` / `rule_hits` / `quality` / `metadata`
- 인덱스: `seat_id` / `burst_uuid` / `decided_at` / `activity` / `status` / `severity`
- migration: `supabase/migrations/20260708000000_ai_rule_decisions.sql`

### RLS / 보안 정책
- `ai_rule_decisions` 저장은 **서버에서 service role 로만** 한다(`SUPABASE_SERVICE_ROLE_KEY`).
- **학생 앱에서 직접 쓰기 금지** — RLS 를 켜고 정책을 두지 않아(기본 잠금) anon/authenticated 는 접근 불가, service role 만 우회.
- **관리자 화면 read-only 조회 정책은 다음 단계에서 별도 migration** 으로 추가한다.
- 저장하는 것은 **RuleDecision 의 텍스트/JSON 뿐**, 민감한 영상/이미지는 저장하지 않는다.
- service role 키는 브라우저용 anon key 가 아니며, **코드에 하드코딩하지 않고** `.env` 에서만 읽는다.

### 환경변수 (`.env`)
```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY   # 서버 저장용, 깃에 올리지 않음
```

### 실행 (`decision_storage_demo.py`)
```bash
python decision_storage_demo.py --fake --save-disabled   # 기본: 저장 없이 직렬화 결과만
python decision_storage_demo.py --fake --save            # 실제 Supabase 저장 시도(env 필요)
```
**기본은 `--save-disabled`** 로 안전. 실제 저장은 사용자가 `--save` 를 명시했을 때만.

### 테스트 (Supabase 불필요)
```bash
python test_ai_decision_storage.py
# serialize / serialize_missing / repo_save / pipeline_success / pipeline_fail / pipeline_disabled / get / no_side_effects / intact
```
`FakeAIDecisionRepository` 로 **실제 Supabase 연결 없이** 전부 통과한다.

### 다음 단계
**관리자 대시보드 읽기 전용 표시** — `ai_rule_decisions` 를 admin read-only RLS 정책으로 노출하고
관리자 화면에 보여준다. (학생 상태 변경/알림/벌점/출결은 여전히 그 이후로 신중히 분리.)

## Admin AI Dashboard Read-only v0.1 (프론트엔드)

저장된 `ai_rule_decisions` 를 **관리자 대시보드에서 읽기 전용**으로 보여준다.
프론트엔드(React/TS) 코드는 메인 앱 `src/features/admin-ai-decisions/` 에 있다.

> **목적**: 관리자가 AI 판정 결과를 **보고** 오탐을 검수·튜닝할 수 있게 한다.
> AI 판정은 **보조 지표**일 뿐 — 보여주기만 하고 **학생 상태/출결/벌점/알림을 자동으로 바꾸지 않는다.**

### `ai_rule_decisions` 읽기 구조 / RLS
- 새 migration `supabase/migrations/20260709000000_ai_rule_decisions_admin_read.sql`:
  - **관리자만 SELECT**: `for select to authenticated using (public.is_admin())` (기존 `is_admin()` 헬퍼 재사용).
  - **INSERT/UPDATE/DELETE 정책 없음** → 저장은 기존처럼 **서버 service role** 만. 학생/일반 사용자는 조회 불가.
  - Realtime: `replica identity full` + `supabase_realtime` 발행 추가 → 새 판정 INSERT 시 화면 갱신.
- 프론트는 **SELECT 전용** API 만 둔다(insert/update/delete 함수 없음).

### 화면 구성 (관리자 대시보드 하단 "AI 판정 현황" 섹션)
1. **안내 배너**: "AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다."
2. **좌석별 최신 판정 카드**(Seat1~8): activity / confidence% / severity / status / 시각 / 주요 reason / 품질.
   판정 없으면 "AI 판정 없음", 오래되면 "오래됨", confidence 낮으면 "신뢰 낮음".
3. **최근 판정 로그 테이블**: 시간/좌석/교시/activity/confidence/severity/status/근거 + 필터(좌석/활동/심각도/상태/개수).
4. **상세 Drawer**: reasons 전체 + evidence/rule_hits/quality/metadata 를 **읽기 전용 JSON** 으로 표시.

### activity 색상 / confidence / severity 의미
| activity | 색상 | | severity | 색상 |
|----------|------|--|----------|------|
| STUDYING(공부 추정) | 초록 | | INFO(정보) | 회색 |
| PHONE(휴대폰 추정) | 빨강 | | WATCH(주의) | 황색 |
| SLEEPING(수면 추정) | 보라 | | WARNING(경고) | 주황 |
| ABSENT(자리비움 추정) | 회색 | | CRITICAL(심각) | 빨강 |
| UNKNOWN(판정 불가) | 회색 | | | |
- **confidence**(0~100%): 해당 규칙의 신뢰도. 카드/로그에 % 표시.
- AI 판정은 "확정 상태"가 아니라 "**AI 추정**" — 카드마다 "AI 추정 · 자동 변경 아님" 표기.

### 접근 제어 / 갱신
- 관리자 페이지 권한은 **기존 방식 그대로**(학생 계정엔 노출 안 됨). RLS 로도 이중 차단.
- 실시간 갱신은 기존 `useRealtimeTableSync` 패턴 재사용(+수동 "새로고침" 버튼). 폴링 반복 호출 없음.

### 테스트 (프론트, Supabase 불필요)
```bash
npm test -- src/features/admin-ai-decisions   # vitest
# API: select 전용/insert·update·delete 없음 / 컴포넌트: 카드·로그·drawer 렌더 / "자동 변경 아님" 문구
```

### 다음 단계
**시계열 안정화** 또는 **관리자 검수 기반 상태 반영** — 단발 판정의 오탐을 줄이고, 관리자가 확인한 뒤에만
상태에 반영하는 흐름. (자동 상태 변경/알림/벌점/출결은 여전히 신중히 분리.)

## AI Decision Stabilizer v0.1

`DecisionStabilizer` 는 최근 **3~5개의 RuleDecision** 을 묶어 좌석별 **안정화된 AI 후보**(`StabilizedDecision`)를 만든다.

> **왜 시계열 안정화인가?** 단발 `RuleDecision` 은 한 Burst 스냅샷이라 깜빡임/오탐이 잦다(한 프레임만 흐려도
> UNKNOWN/PHONE 이 튄다). 최근 여러 판정을 **다수결 + 가중치 + 오래된 것 제외**로 묶으면 더 안정적인
> "후보" 가 된다. **이것도 후보일 뿐 실제 학생 상태가 아니다** — 상태 변경/출결/벌점/알림은 하지 않는다.

### 입력 (둘 다 허용)
- **RuleEngine 의 `RuleDecision` 객체** (백엔드)
- **Supabase `ai_rule_decisions` row dict** (조회 결과/프론트 데이터)
→ 같은 stabilizer 가 둘 다 정규화해서 처리. `ai_decision_stabilizer_repository.py` 가 **SELECT 만** 조회 보조.

### 묶음/판정 흐름
```
[RuleDecision … 또는 row dict …]
   → 정규화 → 오래된 판정 제외(max_age_minutes) → 최신순 윈도우(max_decisions)
   → 최소 개수 확인(min_decisions) → 가중치(최신↑, LOW_CONFIDENCE↓) 다수결
   → 우세 activity 선택 → 충돌/최소횟수/평균신뢰/우세비율 검사 → StabilizedDecision
```

### `StabilizedDecision` 상태(status)
| status | 의미 |
|--------|------|
| **STABLE** | 한 activity 가 충분히 우세(비율 ≥ `stable_ratio`, 최소횟수·평균신뢰 충족) → activity 확정 후보 |
| **UNSTABLE** | 신호가 섞임(우세 비율/최소횟수 부족) → activity UNKNOWN |
| **CONFLICTED** | 상위 두 activity 가 `conflict_margin` 내로 충돌 → UNKNOWN |
| **LOW_CONFIDENCE** | 평균 신뢰도 부족 / 실제 신호 없음 → UNKNOWN |
| **INSUFFICIENT_DATA** | 입력이 없거나 `min_decisions` 미만 → UNKNOWN |

### 보수적 처리 (PHONE/ABSENT/SLEEPING)
- 활동별 **최소 횟수**(`phone/absent/sleeping/studying_min_count`)와 **평균 신뢰도** 를 모두 넘어야 STABLE.
- **ABSENT** 는 오탐 위험(천장 카메라) → UNKNOWN/LOW_CONFIDENCE 가 섞이면 보수적으로 안정화 안 됨.
- **SLEEPING** 은 motion score 부재 → STABLE 이어도 severity 는 **WATCH 이하**로 제한.
- 임계값은 전부 `config/stabilizer.yaml`(window/thresholds/weights/rules)에서 읽는다(하드코딩 없음).

### Evidence / reasons
`evidence`: total/valid/ignored/aged_out, activity_counts/ratios, average_confidence, latest_activity,
consecutive_activity, conflict_detected, source_decision_uuids.
`reasons` 예: "최근 5개 판정 중 PHONE 3회" / "PHONE 평균 신뢰도 0.8" / "최근 판정 2회 연속 PHONE" /
"PHONE과 STUDYING 신호가 충돌하여 UNKNOWN 처리".

### 실행 (`stabilizer_demo.py`)
```bash
python stabilizer_demo.py --phone      # PHONE 3/5 → STABLE PHONE
python stabilizer_demo.py --studying   # STUDYING 4/5 → STABLE STUDYING
python stabilizer_demo.py --absent     # ABSENT 2/5(+UNKNOWN) → 보수적 UNSTABLE
python stabilizer_demo.py --sleeping   # SLEEPING → STABLE(severity WATCH)
python stabilizer_demo.py --conflict   # PHONE/STUDYING → CONFLICTED
python stabilizer_demo.py --insufficient  # 1개 → INSUFFICIENT_DATA
```

### 테스트
```bash
python test_decision_stabilizer.py
# phone/studying/absent/sleeping/empty/too_few/conflict/low_conf/old_excluded/latest_weight/row_dict/by_seat/no_side_effects/intact
```

### 다음 단계
**관리자 대시보드에 안정화 후보 표시** — `StabilizedDecision` 을 좌석 카드 위에 "안정화된 추정" 으로 노출.
(자동 상태 변경/알림/벌점/출결은 여전히 사람·정책이 결정 — 분리 유지.)

## Admin Dashboard Stabilized Candidate Read-only v0.1 (프론트엔드)

관리자 대시보드 "AI 판정 현황" 에서 **단발 RuleDecision** 뿐 아니라 최근 3~5개를 묶은
**안정화된 추정 후보**(`StabilizedCandidate`)를 좌석별로 함께 보여준다.
프론트엔드 코드는 메인 앱 `src/features/admin-ai-decisions/`(stabilizer.ts/stabilizedTypes.ts/컴포넌트)에 있다.

> **왜 대시보드에 안정화 후보인가?** 단발 판정은 한 Burst 스냅샷이라 깜빡임이 잦다. 관리자가
> "지금 한 번 그렇게 떴다" 와 "최근 여러 번 그렇게 떴다(안정화)" 를 **구분**해서 보면 오탐을 덜 신뢰하게 된다.
> 둘 다 **보조 지표**이며 **STABLE 도 "확정" 이 아니다.** 학생 상태/출결/벌점/알림은 자동 변경되지 않는다.

### read-derived 계산 (DB 저장 안 함)
```
ai_rule_decisions SELECT(anon/auth + RLS) → 좌석별 최근 ~5개 → 프론트 stabilizer.ts 계산 → read-only 표시
```
- **DB write 없음**(insert/update/delete 없음). StabilizedCandidate 를 저장하지 않는다(MVP 검증 단계).
- **service role key 를 프론트에 쓰지 않는다.** 기존 anon/auth 클라이언트 + 관리자 RLS SELECT 만.
- `stabilizer.ts` 는 파이썬 `decision_stabilizer.py` 와 판단 방향을 맞춘다(다수결+최신/신뢰 가중+보수 처리).

### 단발 AI vs 안정화 후보 (구분 표시)
좌석 카드는 2층으로 보여준다 — 절대 혼동되지 않게:
```
Seat1
 단발 AI: 휴대폰 추정 72%
 ─────────────
 안정화된 추정: 휴대폰 추정 81% · 안정 · 최근 5개 중 3회
 AI 추정 · 자동 변경 아님
```

### status 의미
| status | 표시 라벨 | 의미 |
|--------|-----------|------|
| STABLE | (활동명) · **안정** | 충분히 우세 → 활동 후보(확정 아님, severity 색상) |
| UNSTABLE | 신호 섞임 | 우세/최소횟수 부족 → UNKNOWN |
| CONFLICTED | 판정 보류 | 상위 두 활동 충돌 → UNKNOWN |
| LOW_CONFIDENCE | 낮은 신뢰 | 평균 신뢰도 부족 → UNKNOWN |
| INSUFFICIENT_DATA | 데이터 부족 | 판정 개수 부족 → UNKNOWN |

### 문구 원칙
포함: "AI 추정", "안정화된 추정", "자동 상태 변경 아님", "관리자 확인 필요",
"AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다."
금지: "확정", "출결 반영", "벌점 부여", "자동 처리"(STABLE 도 "안정" 이라 표현, "확정" 금지).

### 테스트
```bash
npm test -- src/features/admin-ai-decisions   # vitest (stabilizer 로직 + 컴포넌트)
```
`stabilizer.test.ts`(데이터부족/STABLE/충돌/저신뢰/오래된제외/최신가중/SLEEPING·ABSENT 보수/by-seat),
`stabilizedComponents.test.tsx`("안정화된 추정"/"자동 변경 아님" 문구, "확정"·상태변경 버튼 없음).

### 다음 단계
**Seat1 실제 카메라 E2E 테스트** — 실제 RTSP→파이프라인→ai_rule_decisions→대시보드까지 한 좌석으로 검증.
(자동 상태 변경/알림/벌점/출결은 여전히 분리 유지.)

## Seat1 Real Camera E2E Test v0.1 (`seat1_e2e_test.py`)

실제 Seat1 RTSP 카메라(또는 `--fake` 합성)로 **MVP 전체 흐름**을 한 번에 검증하는 도구:
`CameraManager → BurstPackage → OpenCV/MediaPipe/YOLO → FactsFusion(SeatFacts) → RuleEngine(RuleDecision)
→ (선택)ai_rule_decisions 저장 → 관리자 대시보드 확인`.

> ⚠️ **운영 자동화가 아니라 검증 도구**다. 학생 상태 변경/출결/벌점/알림/보호자 연락/관리자 승인·상태반영 버튼/
> RuleDecision 수정·삭제/**영상·이미지 저장**은 절대 안 한다. service role key 는 server-side `.env` 에서만(프론트 금지),
> RTSP URL 비밀번호는 항상 마스킹한다.

### 실행 전 준비 (`.env`)
```bash
SEAT1_RTSP_URL=rtsp://admin:****@<ip>:554/stream2   # cameras.yaml 의 Seat1 enabled:true
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>        # --save 시에만, 절대 깃/프론트 노출 금지
```
- 실제 카메라는 `pip install opencv-python-headless numpy python-dotenv PyYAML`, 저장은 `pip install supabase`.
- MediaPipe/YOLO 모델은 `models/` 에(없으면 자동 **SKIPPED**, 전체 중단 안 함).

### 실행 명령어
```bash
python seat1_e2e_test.py --preflight                       # 연결/설정/모델/Supabase 점검만
python seat1_e2e_test.py --single                          # burst 1회 → 전체 파이프라인 1회
python seat1_e2e_test.py --single --save                   # + Supabase 저장
python seat1_e2e_test.py --single --camera-seconds 15       # warm-up/수집 시간 늘리기(frames=0 대응)
python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo   # 카메라 없이(CI)
python seat1_e2e_test.py --duration 5 --interval 60 --save  # 5분 반복(최소 30초) 저장
python seat1_e2e_test.py --duration 60 --interval 60 --save --preview --seat Seat1   # v0.8 현장 재테스트(단계별 perf 로그)
```
- `--perf-log`(v0.8, 기본 **켜짐**, `--no-perf-log` 로 끔): 각 tick 단계별 소요시간을 `[perf Seat1]` 한 줄 요약으로 로그하고,
  종료 시 `perf_summary`(avg/max total tick, avg/max schedule_drift, avg/max tick_started_late, scheduler_overrun_count, slowest_tick_breakdown)를 출력한다.
  계측값은 수치/텍스트만 남기며 영상/프레임 저장 없음.

#### v0.8 P1 — drift-aware scheduler (스케줄러 개선)
- **구조 변경**: 기존 "tick 작업 → 고정 `sleep(interval)`" 을 **wall-clock 고정 grid** 로 교체했다.
  - tick n 예정 시작 = `loop_start + (n-1)*interval`, 다음 예정 = `loop_start + n*interval`(단조 시계 `time.monotonic` 기준).
  - tick 작업이 끝나면 `sleep = max(0, 다음 예정 시작 - now)` — **작업시간을 제외한 남은 시간만** sleep 한다.
    예: interval=60, 작업 19.5초 → sleep ≈ 40.5초 → cycle 이 60초로 수렴(기존엔 작업+60 ≈ 79.5초였음).
  - 작업시간이 interval 을 **초과**하면 sleep=0, `scheduler_overrun=True`, negative sleep 대신 초과분을 `schedule_drift_seconds` 로 기록한다.
- **`schedule_drift_seconds` 의미 변경(중요)**:
  - **구 v0.8**: 고정 sleep 탓 `drift ≈ 작업시간 초과분 ≈ 19~20초`가 **상수처럼** 찍혔다(주기가 늘 밀렸다는 뜻).
  - **P1 이후**: drift 는 "이번 tick 작업이 슬롯(interval)을 넘긴 **overrun 초**"다. 작업 < interval 이면 **정상값 0**.
    고정 grid 라 계속 overrun 하면 drift/late 는 누적된다(`drift(n)=tick_end - 다음예정`, `late(n)=tick_start - 예정시작`).
- **새 perf 필드**: `scheduled_tick_start_at`, `actual_tick_start_at`, `next_scheduled_tick_start_at`,
  `tick_started_late_by_seconds`, `scheduler_overrun`(bool). 기존 `total_tick_duration`/`sleep_until_next_tick_duration`/`schedule_drift_seconds` 유지(의미만 상기대로 변경).
- 동작 보존: `--save` 일 때만 insert(append-only), `--verify-accumulation` read-only, preview 는 local temporary,
  AI advisory-only, 학생 상태/출결/벌점/알림 자동 변경 없음.
- `--camera-seconds`(real, 기본 **10초**, 최소 1): RTSP warm-up + 프레임 수집 시간. **frames=0 이면 늘리세요**(예: 15~20).
  warm-up 동안 2초마다 **연결 성공/실패·buffer_len·frames_received·last_frame_age·마지막 프레임 시각(last_ts)** 을 자세히 로그한다(영상/이미지 저장 없음, 수치/시각만).
- `--engines` 기본 `opencv`. MediaPipe/YOLO 는 모델/라이브러리 없으면 SKIPPED(전체 실패 아님) → FactsFusion 이 SUCCESS/PARTIAL 처리.
- `--duration` interval 최소 **30초**(더 짧으면 30초로 보정) — DB/카메라 부담 방지.
- `--fake` 는 합성 프레임 + Fake 엔진 백엔드(MediaPipe/YOLO)로 동작, OpenCV 는 동일 스키마 합성 결과. real/fake 를 출력에 명시.
- `--write-result` 시 `logs/e2e/`에 **JSON 결과만** 저장(이미지/영상 저장 없음).

### 대시보드 확인
`--save` 후 터미널 가이드대로: 관리자 로그인 → 대시보드 → AI 판정 현황 → Seat1 단발 AI 판정 확인 →
**3회 이상 저장** 후 안정화된 추정 후보 확인 → "자동 상태 변경 아님" 문구 → 학생 상태/출결/벌점 불변 확인.
저장 확인 SQL(읽기 전용)도 함께 출력된다.

### 저장되는 것 / 저장 안 되는 것
- 저장: frame **count/timestamp/품질 수치**, AI facts, RuleDecision(activity/confidence/reasons/evidence) → `ai_rule_decisions`(**insert 만**).
- 저장 안 함(프라이버시): **프레임 jpg / 비디오 / 스크린샷 / Supabase storage 업로드 / 대시보드 이미지** — 숫자·메타·판정만 남긴다.

### 테스트 (실제 RTSP 불필요)
```bash
python test_seat1_e2e_test.py
# mask / preflight / single / skipped_engine / no_save / save / save_fail / duration / no_side_effects / intact
```

### 문제 해결
- **RTSP 연결 실패**: `.env` SEAT1_RTSP_URL/네트워크/인증/`cameras.yaml` Seat1 enabled, `camera_core.py` 의 tcp↔udp.
- **frame 없음(frames=0)**: 연결은 됐는데 버퍼가 비면 `--camera-seconds` 를 15~20초로 늘린다. warm-up 로그의
  `connected=True/False`, `buffer_len`, `frames_received`, `last_ts` 로 연결 성공·프레임 수신 여부를 확인한다.
  서브스트림 경로(stream2)·fps·`camera_core.py` 의 tcp↔udp 도 점검.
- **Supabase 저장 실패**: SUPABASE_URL/SERVICE_ROLE_KEY, `pip install supabase`, 테이블 migration 적용 여부.
- **RLS 로 대시보드 조회 안 됨**: `20260709_ai_rule_decisions_admin_read` 적용 + 관리자(is_admin) 계정인지.
- **MediaPipe/YOLO 모델 없음**: 정상(SKIPPED). 필요 시 `models/` 에 배치.

### 다음 단계
**Seat1 실사용 1일 관찰 로그 v0.1** — 하루 동안 안정화 후보가 어떻게 변하는지 관찰·기록(여전히 자동 상태 변경 없음).

## 설치

```bash
cd rtsp-poc
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 설정

### 1) 민감정보 → `.env`
`.env.example` 복사 후 실제 RTSP URL 입력. **비밀번호는 `.env` 에만**(로그는 `admin:****` 마스킹).
```bash
cp .env.example .env
```
```
# 단일 카메라(main.py)
RTSP_URL=rtsp://admin:비번@192.168.219.50:554/stream2
# 좌석별(manage.py + cameras.yaml)
SEAT1_RTSP_URL=rtsp://admin:비번@192.168.219.50:554/stream2
SEAT2_RTSP_URL=     # 1대 테스트면 비워둬도 됨
...
```

### 2) 카메라 목록 → `cameras.yaml`
좌석 구조/이름/enabled/stream_type/memo 관리. `rtsp_url` 은 `${SEATn_RTSP_URL}` placeholder 로만 참조(비밀번호 미노출). `cameras.json` 도 동일 구조로 사용 가능(`--config cameras.json`).

```yaml
cameras:
  - seat_id: Seat1
    name: "1번 좌석"
    rtsp_url: "${SEAT1_RTSP_URL}"
    enabled: true          # ← 1대 테스트: Seat1 만 true
    stream_type: sub
    memo: "출입문 쪽"
  - seat_id: Seat2
    ...
    enabled: false
```

## 실행

### Camera Core (단일 카메라)
```bash
python main.py                     # 영상 창 + FPS, q 종료
python main.py --headless --duration 600
```

### CameraManager (좌석 관리) — `manage.py`
```bash
python manage.py --single-seat 1                    # Seat1 1대만
python manage.py --all                              # enabled=true 인 전체
python manage.py --all --headless --duration 600    # 서버 10분
python manage.py --single-seat 1 --health-interval 5
```
| 옵션 | 설명 |
|------|------|
| `--single-seat N` | 좌석 N 1대만 실행 |
| `--all` | enabled=true 인 모든 좌석 실행 |
| `--headless` | 영상 창 없이 로그만(서버) |
| `--duration N` | N초 후 자동 종료(0=무한) |
| `--health-interval N` | `get_all_health()` 출력 주기(초) |
| `--config PATH` | 설정 파일 경로(기본 cameras.yaml) |

- 일반 모드: 실행 중인 좌석들을 **격자(montage) 한 창**에 표시, `q` 종료.
- headless 모드: `get_all_health()` 좌석별 상태를 주기적으로 로그 출력, Ctrl+C 종료.

## 1대 테스트 방법

1. `cameras.yaml` 에서 **Seat1 만 `enabled: true`**, 나머지 `false` (기본값).
2. `.env` 에 `SEAT1_RTSP_URL` 채우기.
3. 실행:
   ```bash
   python manage.py --single-seat 1            # 또는 --all (Seat1만 떠도 동일)
   ```

## 8대 확장 방법

1. `.env` 에 `SEAT1_RTSP_URL` ~ `SEAT8_RTSP_URL` 8개 모두 입력.
2. `cameras.yaml` 에서 사용할 좌석들을 `enabled: true` 로.
3. 실행:
   ```bash
   python manage.py --all --headless
   ```
- `CameraManager` 가 좌석별로 `CameraCore` 인스턴스를 1개씩 띄웁니다(코어 1개=카메라 1대).
- 각 좌석은 독립 Capture/Monitor 스레드와 3초 링버퍼를 가집니다.

## 테스트 (카메라 없이)

`VideoCapture` 를 가짜 주입해 검증합니다.
```bash
pip install opencv-python-headless numpy python-dotenv PyYAML
python test_camera_core.py       # 코어: 수신/health/get_recent_frames/재연결/종료
python test_camera_manager.py    # 매니저: enabled필터/get_recent_frames/get_all_health/stop_all
```

## get_all_health() 출력 형태

```python
[
  {"seat_id":"Seat1","name":"1번 좌석","enabled":True,"running":True,
   "connected":True,"fps":15.0,"resolution":"848x480","frames_received":1234,
   "last_frame_age":0.06,"reconnects":0,"buffer_len":45},
  {"seat_id":"Seat2",...,"enabled":False,"running":False,"connected":False, ...},
  ...
]
```

## 완료 조건 점검 (v0.1)

| 조건 | 확인 |
|------|------|
| Seat1 1대만 enabled로 실행 | `cameras.yaml` 기본값 + `python manage.py --all` |
| `--single-seat 1` | `python manage.py --single-seat 1` |
| `--all` | `python manage.py --all` |
| `get_all_health()` 전체 상태 | health-interval 마다 좌석별 로그 |
| 10분 headless | `--all --headless --duration 600` |
| Camera Core v0.1 미파손 | `python test_camera_core.py` PASS |

## 문제 해결

- `설정 로드 실패` → cameras.yaml 경로/문법, PyYAML 설치 확인
- `enabled=true 이지만 rtsp_url 이 ... 치환되지 않았습니다` → `.env` 의 `SEATn_RTSP_URL` 미설정
- `RTSP open 실패` → 네트워크/인증/스트림 경로/방화벽 (로그 원인 후보 1~6)
- 영상이 안 들어오면 UDP 전용 카메라일 수 있음 → `camera_core.py` 의 `OPENCV_FFMPEG_CAPTURE_OPTIONS` `tcp`→`udp`
