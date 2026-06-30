# Solomon Camera Core / CameraManager / Scheduler Engine v0.1

TP-Link **VIGI C420I** 카메라의 RTSP 스트림을 수신·관리하고, 교시 기반 분석 트리거를 생성하는 모듈.

- **Camera Core v0.1** — 카메라 1대 RTSP 수신 코어 (`CameraCore`)
- **CameraManager v0.1** — Seat1~Seat8 **8대 관리 구조** (`CameraManager`)
- **Scheduler Engine v0.1** — 교시 기반 **Burst 트리거 생성** (`SchedulerEngine`)

> ⚠️ **범위: RTSP 수신/관리 + 교시 트리거 생성까지만.**
> MediaPipe / YOLO / AI 판별 / Rule Engine / Supabase(DB) / 대시보드는 **구현하지 않습니다.**

## 파일 구조

| 파일 | 역할 |
|------|------|
| `ring_buffer.py` | `FrameItem` + `RingBuffer` (deque, 스레드세이프, OpenCV 비의존) |
| `camera_core.py` | `CameraCore` — 카메라 1대 수신(Capture/Monitor 스레드 + 재연결) |
| `camera_config.py` | `CameraConfig` + cameras.yaml/json 로더(env 치환, OpenCV 비의존) |
| `camera_manager.py` | `CameraManager` — Seat1~Seat8 ↔ CameraCore 관리 |
| `schedule_config.py` | `ScheduleConfig`/`TriggerEvent` + schedule.yaml 로더(OpenCV 비의존) |
| `scheduler_engine.py` | `SchedulerEngine` — 교시 기반 Burst 트리거 생성 |
| `main.py` | Camera Core 실행(단일 카메라, `RTSP_URL`) |
| `manage.py` | **CameraManager 실행**(다중 좌석, cameras.yaml) |
| `scheduler_demo.py` | **SchedulerEngine 데모**(교시/트리거 확인) |
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
