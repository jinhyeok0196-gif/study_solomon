# Solomon Camera Core v0.1

TP-Link **VIGI C420I** 카메라의 RTSP 스트림을 안정적으로 수신하는 **Camera Core**.
단순 영상 출력 PoC를 넘어, 향후 Solomon AI Camera Service의 기반이 되는 구조입니다.

> ⚠️ **이 단계 범위 (v0.1): RTSP 수신 코어만 안정화.**
> MediaPipe / YOLO / Rule Engine / Supabase(DB) / 웹 연동은 **구현하지 않습니다.**

## 무엇이 들어있나

- **CameraCore 클래스** — 카메라 1대 = 코어 1개. (8대 확장 시 8개 인스턴스화)
- **Capture 스레드 / Display·Consumer 분리** — 수신과 소비를 별도 스레드/로직으로.
- **Ring Buffer** — 최근 3초 분량 프레임을 `collections.deque` 로 보관.
  각 프레임은 `FrameItem(frame, timestamp, frame_index)`.
- **`get_recent_frames(seconds=3)`** — 향후 AI Engine의 2~3초 Burst Analysis 진입점.
- **Health Check** — 프레임 수신 중단 감지, FPS 저하 감지, 마지막 프레임 시각,
  연결 상태를 1초마다 로그로 출력.
- **재연결** — 연결 실패/끊김 시 지수 백오프 자동 재연결, 예외에도 죽지 않음.
- **Headless 모드** — `--headless` 로 영상 창 없이 서버에서 실행.

## 파일 구조

| 파일 | 역할 |
|------|------|
| `ring_buffer.py` | `FrameItem` + `RingBuffer` (deque 기반, 스레드세이프, **OpenCV 비의존**) |
| `camera_core.py` | `CameraCore` — Capture 스레드 + Monitor(Health) 스레드 + 재연결 |
| `main.py` | 실행 엔트리포인트 — `--headless`, Display/Consumer, `get_recent_frames` 데모 |
| `test_camera_core.py` | 카메라 없이 `VideoCapture` 를 가짜 주입해 코어 로직 검증하는 통합 테스트 |
| `rtsp_poc.py` | (레거시) 초기 단일파일 PoC. v0.1에서는 `main.py` 사용 권장 |
| `.env.example` | `RTSP_URL` 템플릿 |

## 요구 환경

- Python 3.9+ (개발 3.12 기준)
- 일반 모드는 **GUI(디스플레이) 데스크톱** 필요 (`cv2.imshow`).
  서버/헤드리스 환경은 `--headless` 사용.
- 카메라와 같은 네트워크 (테스트 IP `192.168.219.50`, 포트 `554`)

## 설치

```bash
cd rtsp-poc
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

> 일반 모드(영상 창)는 `opencv-python` 이 필요합니다.
> **서버에서 headless 만** 쓸 거라면 `opencv-python-headless` 로 바꿔도 됩니다.

## 설정 (.env)

`.env.example` 를 복사해 `.env` 를 만들고 실제 접속 정보를 채웁니다.
**비밀번호는 코드/로그가 아닌 `.env` 에만** 둡니다. (로그에서는 `admin:****` 로 마스킹)

```bash
cp .env.example .env
# .env 안: RTSP_URL=rtsp://admin:실제비밀번호@192.168.219.50:554/stream2
```

- 서브 스트림(848x480)=`/stream2`, 메인=`/stream1`.
- 비밀번호 특수문자는 URL 인코딩(`@`→`%40`, `:`→`%3A`, `#`→`%23`).

## 실행

**일반(영상 창) 모드:**
```bash
python main.py
# 영상 창 + 1초마다 STATUS/FPS 로그. 종료: 창 포커스 후 q
```

**Headless(서버) 모드:**
```bash
python main.py --headless
# 영상 창 없이 FPS/상태 로그만. 종료: Ctrl+C
```

**유용한 옵션:**
```bash
python main.py --headless --duration 600     # 10분만 돌리고 자동 종료
python main.py --buffer-seconds 3 --target-fps 10 --burst-interval 5
```
| 옵션 | 기본 | 설명 |
|------|------|------|
| `--headless` | off | 영상 창 없이 실행 |
| `--duration N` | 0(무한) | N초 후 자동 종료 |
| `--buffer-seconds N` | 3 | 링버퍼 보관 시간 |
| `--target-fps N` | 10 | FPS 저하 경고 기준 |
| `--burst-interval N` | 5 | `get_recent_frames(3)` 데모 로그 주기 |
| `--name` | cam0 | 로그 식별용 카메라 이름 |

## 통합 테스트 (카메라 없이)

`VideoCapture` 를 가짜로 주입해 수신/health/`get_recent_frames`/재연결/정상종료를 검증합니다.

```bash
pip install opencv-python-headless numpy python-dotenv   # 테스트용
python test_camera_core.py
# -> PASS: 수신/health/get_recent_frames/재연결/정상종료 모두 정상
```

## 완료 조건 점검

| 조건 | 확인 |
|------|------|
| 일반 모드: 영상 창 + FPS 로그 | `python main.py` 실행 → 창 + `STATUS ... fps=` |
| headless: 창 없이 FPS/상태 로그 | `python main.py --headless` |
| 10분 끊김 없음 | `--duration 600` 또는 수동 10분, 재연결 로그 없는지 확인 |
| `get_recent_frames(3)` 정상 | `[burst] 최근 3초 프레임 N장 ...` 로그 |

## 향후 8대 확장 (참고, 이번 단계 아님)

`CameraCore` 를 카메라 수만큼 만들면 됩니다.
```python
cams = [CameraCore(url_i, name=f"cam{i}") for i, url_i in enumerate(urls)]
for c in cams: c.start()
# 각 c.get_recent_frames(3) 를 AI Engine 이 소비 (← 다음 단계)
```

## 문제 해결

- `.env 에서 RTSP_URL 을 찾지 못했습니다` → `.env` 미설정
- `RTSP open 실패` → 네트워크/인증/스트림 경로/방화벽 (로그의 원인 후보 1~6 확인)
- `프레임 연속 수신 실패 … 재연결` → 연결은 됐으나 스트림 끊김 → 자동 재연결
- 영상이 전혀 안 들어오면 카메라가 UDP만 허용하는 경우 →
  `camera_core.py` 상단 `OPENCV_FFMPEG_CAPTURE_OPTIONS` 의 `tcp` 를 `udp` 로 변경
- FFmpeg backend 확인: `python -c "import cv2; print(cv2.getBuildInformation())"` →
  `Video I/O` 의 `FFMPEG: YES`
