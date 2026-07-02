# 참집중 — v0.9 P1 내부 데모 절차 (--fake UI/흐름 검증용)

> ⚠️ **이 문서의 `--fake` 데이터는 UI·흐름 검증 전용이다. 실제 AI 정확도가 아니다.**
> fake 판정을 "참집중이 집중을 정확히 판별했다"는 근거로 절대 사용하지 마라.
> 실제 활동 분류 정확도 검증은 **v0.9 이후 실제 모델 배치 단계의 NO-GO 항목**이다.

## 0. 목적

- 실제 YOLO/MediaPipe 모델 없이(=레포에 모델 없음), **관리자 화면 "AI 판정 현황"에
  UNKNOWN이 아닌 판정 1종(집중/study)이 표시되는 흐름**을 내부에서 확인한다.
- 목적은 **UI 배선·데이터 흐름 검증**이지 AI 성능 측정이 아니다.

## 1. 실제 RTSP 경로 vs --fake 데모 경로 (혼동 금지)

| 구분 | 실제 카메라(RTSP) 경로 | 내부 데모(--fake) 경로 |
|---|---|---|
| 입력 | 실제 Seat1 RTSP 프레임 | 합성 프레임(`_fake_burst`) |
| 엔진 | 기본 `opencv`만 → 활동 분류 안 함 | `opencv,mediapipe,yolo` fake 백엔드(책+사람→study) |
| 활동 결과 | **대부분 UNKNOWN** (분류 모델 미배치) | study 등 UNKNOWN 아닌 판정 |
| 의미 | 구조는 살아있으나 분류는 미검증 | **UI/흐름 검증용** (정확도 아님) |
| 모델 파일 | `models/yolo_object.pt` 등 필요(현재 없음) | 불필요(Fake 백엔드) |

- 실제 경로에서 UNKNOWN이 많이 보이는 것은 **정상**이며, 모델 배치 전 상태를 그대로 반영한 것이다.
- 관리자 화면 안내 배너에 이 구분 문구(`AI_SOURCE_NOTE`)를 상시 노출한다.

## 2. 안전 원칙 (반드시 준수)

- `ai_rule_decisions`는 **append-only** → fake 행은 삭제로 되돌리기 어렵다.
- 따라서 **fake `--save` 는 로컬/개발 Supabase(로컬 도커, 기본 `.env`)에만** 실행한다.
  **원격 프로덕션에 fake 데이터를 절대 저장하지 않는다.**
  (환경 구분: 로컬 `.env` = 로컬 도커 / 배포 = 원격 — 원격 대상 저장 금지)
- 영상/이미지/frame binary는 DB에 저장하지 않는다(메타데이터만).
- `latest.mp4`/`latest.json`은 local temporary preview only, preview bridge는 127.0.0.1 전용.

## 3. 절차

### 3-1. 저장 없이 판정만 확인 (DB 오염 0 — 가장 안전)

```
python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo --debug-metrics
```

- 콘솔 출력의 `activity` 가 UNKNOWN이 아닌 값(예: study)으로 나오는지 확인.
- DB/화면 반영은 없음(=저장 안 함). 파이프라인 판정 로직만 검증.

### 3-2. 관리자 화면 표시까지 확인 (로컬 Supabase 한정)

전제: 프론트(`npm run dev`)와 Python 파이프라인이 **동일한 로컬/개발 Supabase**를 바라볼 것.

```
# 로컬/개발 .env(로컬 도커)를 사용하는 환경에서만:
python seat1_e2e_test.py --single --fake --engines opencv,mediapipe,yolo --save --seat Seat1
```

- 관리자 대시보드 → "AI 판정 현황" → Seat1 카드 및 "최근 AI 판정 로그"에
  UNKNOWN이 아닌 판정 1종이 나타나는지 확인.
- 확인 후, 이 행이 **fake(UI 검증용)** 임을 데모 참여자에게 명확히 고지한다.

### 3-3. preview 흐름(선택)

```
python preview_bridge_server.py            # 127.0.0.1:8765 로컬 전용
# 프론트 .env: VITE_LOCAL_PREVIEW_BRIDGE_URL=http://127.0.0.1:8765
```

- 좌석 카드의 "최근 5초 보기"가 로컬에서 재생되는지 확인. 미설정 시 "미리보기 준비 안 됨"으로 graceful degrade.

## 4. 데모 시 반드시 말할 경계 문구

- "지금 보이는 판정은 **UI·흐름 검증용 데모 데이터**이며, 실제 AI 정확도가 아닙니다."
- "실제 카메라 경로는 분류 모델 배치 전까지 대부분 UNKNOWN으로 표시됩니다."
- "AI는 보조 지표이며 출결·벌점·학생 상태·알림을 자동으로 변경하지 않습니다."
- "STABLE 안정화 후보도 확정이 아니며 관리자 확인이 필요합니다."

## 5. 다음 단계 (P1 범위 아님 — 기록만)

- 실제 YOLO/MediaPipe **모델 로컬 배치**(`models/*.pt`, `.task` — 커밋 금지) 후
  실제 활동 분류 검증. 이것이 이후 단계의 핵심 과제이며, 그전까지 **정확도 주장 금지.**
- 모델은 현재 레포에 **없음**(확인됨). 이번 P1에서는 모델 다운로드·대용량 커밋·정확도 주장 모두 금지.
