# Solomon Camera / Scheduler / Orchestrator / AI Engine Core v0.1

TP-Link **VIGI C420I** 카메라의 RTSP 스트림을 수신·관리하고, 교시 기반 트리거로 프레임 묶음
(BurstPackage)을 만들어 **교체 가능한 AI Engine** 인터페이스로 전달하는 모듈군.

- **Camera Core v0.1** — 카메라 1대 RTSP 수신 코어 (`CameraCore`)
- **CameraManager v0.1** — Seat1~Seat8 **8대 관리 구조** (`CameraManager`)
- **Scheduler Engine v0.1** — 교시 기반 **Burst 트리거 생성** (`SchedulerEngine`)
- **Orchestrator Engine v0.1** — 트리거→큐→워커→**BurstPackage 생성** (`OrchestratorEngine`)
- **AI Engine Core v0.1** — **교체 가능한 AI 인터페이스** + Dummy (`AIEngine`/`AIManager`)
- **OpenCV Vision Engine v0.1** — 프레임 **전처리·품질검사·ROI** (`OpenCVEngine`)

> ⚠️ **범위: RTSP 수신/관리 + 트리거 + BurstPackage + AI 인터페이스 + OpenCV 전처리까지만.**
> 실제 AI 판별(MediaPipe/YOLO/행동·사람·휴대폰) / Rule Engine / Supabase(DB) / 대시보드는 **구현하지 않습니다.**

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
