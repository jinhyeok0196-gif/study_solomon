# REVIEW — Object-Only Guard v0.4

솔로몬스터디카페 AI 학습관리 MVP — v0.3-real에서 발견된 **ABSENT 오탐(위험 케이스)** 차단 + STUDYING 룰 보수적 개선.

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**

- 작성일: 2026-07-01
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`
- 작업 위치: Codespaces (코드 수정/검증/문서화 전용)
- 실제 카메라 real 검증: 스터디카페 Wi-Fi 로컬 노트북 PowerShell 전용

---

## 1. v0.4 한 줄 요약

**"사람이 일시적으로 미검출됐을 뿐인데 책상 위 phone/laptop만 보고 ABSENT(자리비움)로 확정하던 위험 오탐"**을,
RuleEngine에 **object-only guard**를 넣어 차단했다(ABSENT 룰보다 먼저 적용, UNKNOWN 보류).
동시에 STUDYING 룰을 **사람 존재 + 휴대폰 없음**을 요구하도록 보수화하고,
`reason_code=OBJECT_WITHOUT_PERSON` 진단과 대시보드 **"객체 감지됨 · 사람 미검출 · 자리비움 확정 아님"** 표시를 추가했다.

---

## 2. v0.3-real 실제 카메라 테스트 결과 요약

### 성공한 것
- Seat1 실제 VIGI RTSP 연결 성공, OpenCV 성공
- YOLO 실제 모델 `models/yolo_object.pt` 로딩 성공
- person / phone / laptop 감지 성공
- **PHONE 판정 성공** → Supabase `ai_rule_decisions` 저장 성공(HTTP/2 201 Created)
- 빈 좌석 **ABSENT 판정 성공**

### 실측 요약
| 케이스 | 결과 |
|---|---|
| PHONE 성공 | `activity=PHONE`, `confidence=0.7716`, `detected_labels=['person','phone']`, `person_count=1`, `phone_count=10`, `saved=True` |
| 빈 좌석 | `activity=ABSENT`, `person_count=0`, phone/book/laptop=0 |
| 공부 장면 미완성 | `detected_labels=['person','unknown_object']`, `person_count=1`, `book=0`, `laptop=0`, `activity=UNKNOWN` |
| **위험 케이스** | `detected_labels=['laptop','phone']`, `person_count=0`, `phone_count=10`, `laptop_count=10`, **`activity=ABSENT`** ← 실제로는 사람이 있었으나 person 일시 미검출로 ABSENT 오판 |

**→ 이 위험 케이스가 v0.4의 핵심 수정 대상.**

---

## 3. 고친 문제

1. **ABSENT 오탐(위험)**: `person_count=0`인데 phone/book/laptop/tablet 같은 유의미한 객체가 검출되면
   ABSENT로 확정하던 문제 → **object-only guard**로 차단, `UNKNOWN` 보류로 둔다.
2. **STUDYING 오탐 여지**: 사람 없이/휴대폰과 함께 STUDYING이 나올 수 있던 여지 → 사람 필수 + 휴대폰 없을 때만 STUDYING.
3. **진단 부재**: object-only 케이스를 로그/대시보드에서 자리비움과 구분 못하던 문제 →
   `reason_code=OBJECT_WITHOUT_PERSON`, 저장 payload(evidence)에 detected_labels·counts 고정, 대시보드 전용 문구.

---

## 4. 수정 파일 목록

| 파일 | 변경 |
|---|---|
| `rtsp-poc/rule_engine.py` | **object-only guard**(ABSENT 룰보다 먼저) 추가, `_rule_studying` 보수화(사람 필수·휴대폰 배제), `_build_evidence`에 detected_labels/normalized_labels/person·phone·book·laptop·tablet_count/top_object_confidence 추가 |
| `rtsp-poc/seat1_e2e_test.py` | `--debug-metrics`에 `reason_code=OBJECT_WITHOUT_PERSON` 분류 추가(+`UNKNOWN_REASON_CODES`) |
| `rtsp-poc/test_rule_engine.py` | 충돌 테스트를 신정책(PHONE)으로 갱신 + object-only guard(phone/laptop)·진짜 빈좌석 ABSENT 테스트 추가 |
| `rtsp-poc/test_yolo_e2e_flow.py` | 시나리오 A~G로 재구성 + object-only reason_code 디버그 테스트 |
| `src/features/admin-ai-decisions/types.ts` | `isObjectOnlyUnknown()` + `OBJECT_ONLY_HINT` 추가 |
| `src/.../components/AIDecisionSeatCard.tsx` | object-only 케이스를 amber 뱃지로 우선 표시 |
| `src/.../__tests__/AIDecisionComponents.test.tsx` | object-only 표시 테스트 |
| `rtsp-poc/REVIEW_Object_Only_Guard_v0.4.md` | 본 리뷰(신규) |

---

## 5. RuleEngine 변경 전/후 설명

### 5-1. 판정 순서

**변경 전(v0.3):**
```
품질게이트 → (human/objects 둘다 없음)UNKNOWN → [ABSENT → PHONE → SLEEPING → STUDYING] → 충돌검사 → 우선순위 선택
```
- 위험: `_rule_absent`는 person/face/pose/hands가 전부 없고 valid_frames>0면 발동.
  → phone/laptop이 있어도(사람만 일시 미검출) **ABSENT 확정**.

**변경 후(v0.4):**
```
품질게이트 → (human/objects 둘다 없음)UNKNOWN
          → ★object-only guard★ (사람 미검출 + 유의미한 객체 있음 → UNKNOWN 보류)
          → [ABSENT → PHONE → SLEEPING → STUDYING] → 충돌검사 → 우선순위 선택
```

### 5-2. object-only guard (신규 코드)

```python
# 3.5) object-only guard (v0.4): 사람 신호는 없는데 유의미한 객체(phone/book/laptop/tablet)만
#      검출되면 ABSENT 로 확정하지 않는다. person 이 프레임에서 일시적으로 미검출된 경우
#      책상 위 물건만 보고 "자리비움"으로 오판하는 위험 케이스를 차단한다.
person_present = (_b(objects, "person_detected") or _b(human, "face_detected")
                  or _b(human, "pose_detected") or _b(human, "hands_detected"))
meaningful_object = any(_b(objects, f"{k}_detected")
                        for k in ("phone", "book", "laptop", "tablet"))
if not person_present and meaningful_object:
    labels = [k for k in ("phone", "book", "laptop", "tablet") if _b(objects, f"{k}_detected")]
    rule_hits = [{"rule": "object_only_guard", "fired": True, "confidence": 0.0}]
    return self._build(sf, decided_at, A.UNKNOWN, 0.0, A.STATUS_SUCCESS,
                       reasons=[f"객체 감지됨({', '.join(labels)}) · 사람 미검출 "
                                f"→ 자리비움 확정 보류(object-only, 사람 일시 미검출 가능)"],
                       evidence=evidence, rule_hits=rule_hits, quality=quality)
```

### 5-3. `_rule_studying` 보수화 (변경 전/후)

**전:** `book/laptop/tablet` 검출만 있으면 사람·휴대폰과 무관하게 confidence 누적 후 발동 가능.

**후:**
```python
study = book or laptop or tablet
if not study: return (False, 0.0, [])
person = person_detected or pose_detected or face_detected
if not person: return (False, 0.0, [])   # 사람 없으면 STUDYING 아님(object-only)
if phone_detected: return (False, 0.0, [])  # 휴대폰 있으면 STUDYING 확정 보류(PHONE 우선)
# 이후 conf 계산(사람 보정 + 손/자세)
```

### 5-4. `_build_evidence` — 저장 payload 안정화

evidence(저장/대시보드가 참조)에 아래를 고정 추가:
`detected_labels`, `normalized_labels`, `person_count`, `phone_count`, `book_count`, `laptop_count`, `tablet_count`, `top_object_confidence`.
→ `ai_rule_decisions.evidence`(JSONB)로 저장되어 대시보드가 안정적으로 참조 가능(수치/텍스트만).

---

## 6. object-only guard 정책

- **트리거 조건:** 사람 신호 없음(`person_detected`/`face_detected`/`pose_detected`/`hands_detected` 전부 false)
  **AND** 유의미한 객체 있음(`phone`/`book`/`laptop`/`tablet` 중 하나 이상 detected).
- **결과:** `activity=UNKNOWN`, `status=SUCCESS`, `rule_hits`에 `object_only_guard: fired`, 이유에 `object-only` 명시.
  **ABSENT로 확정하지 않는다.**
- **적용 순서:** ABSENT 룰보다 **먼저**(그래서 ABSENT가 발동조차 하지 않음).
- **자리비움(ABSENT)은 언제?** 사람도 없고 유의미한 객체도 없을 때만(빈 좌석).
- **진단:** `--debug-metrics` → `reason_code=OBJECT_WITHOUT_PERSON`, `no_fact_reason`에 검출 라벨/사유 표기.
- `unknown_object`는 "유의미한 객체"에 포함하지 않는다(무리한 판정 금지).

---

## 7. STUDYING 룰 보수적 개선 정책 (오탐 방지 우선)

STUDYING **확정 조건**(모두 충족):
- `person_count > 0` (사람 존재: person_detected 또는 자세/얼굴)
- `phone_count = 0` (휴대폰 미검출 — 있으면 STUDYING 아님, PHONE/UNKNOWN)
- `book` 또는 `laptop` 또는 `tablet` 중 하나 이상 검출
- confidence ≥ `studying_confidence`(config, 기본 0.6)

보류(STUDYING로 확정하지 않음):
- 사람 있고 `unknown_object`만 있는 경우 → **UNKNOWN**(학습 도구 아님)
- 휴대폰이 함께 있는 경우 → STUDYING 아님(PHONE 또는 UNKNOWN)

> 참고: 사람+휴대폰+책이면 휴대폰이 STUDYING을 억제한다. 이때 PHONE confidence가 임계 미만이면 UNKNOWN이 될 수 있다(보수적).

---

## 8. 테스트 시나리오와 결과 (Codespaces fake, 모델 불필요)

| # | 입력 | 기대 | 결과 |
|---|---|---|---|
| A | person + phone | PHONE | ✅ PHONE |
| B | person + laptop (휴대폰 없음) | STUDYING | ✅ STUDYING |
| C | person + book (휴대폰 없음) | STUDYING | ✅ STUDYING |
| D | no person + no objects | ABSENT | ✅ ABSENT |
| E | **no person + phone** | UNKNOWN(ABSENT 금지) | ✅ UNKNOWN(object-only) |
| F | **no person + laptop** | UNKNOWN(ABSENT 금지) | ✅ UNKNOWN(object-only) |
| G | person + unknown_object only | UNKNOWN | ✅ UNKNOWN |

### object-only debug 출력 실측 (시나리오 E)
```
activity = UNKNOWN
reason(0) = 객체 감지됨(phone) · 사람 미검출 → 자리비움 확정 보류(object-only, 사람 일시 미검출 가능)
  reason_code = OBJECT_WITHOUT_PERSON
  no_fact_reason = 유의미한 객체(phone)는 감지됐으나 사람(person) 미검출 → 자리비움 확정 보류(object-only). person 일시 미검출 가능
  person_count = 0
  phone_count = 1
  detected_labels = ['phone']
  normalized_labels = ['phone']
  top_object_confidence = 0.87
  yolo_status = SUCCESS
```

### 테스트 스위트 결과
| 스위트 | 결과 |
|---|---|
| `test_yolo_e2e_flow.py` | **11 passed** (A~G + opencv-only + objects 전달 + debug reason_code 2) |
| `test_rule_engine.py` | **14 passed** (object-only guard 2 + phone_suppress_studying + absent_empty 포함) |
| `rtsp-poc` 전체 | **116 passed** |
| 프론트 `tsc --noEmit` | **에러 0** |
| 프론트 `vitest`(admin-ai-decisions) | **36 passed** (object-only 표시 1 포함) |

---

## 9. 로컬 실제 카메라 재검증 명령어 (스터디카페 노트북)

```powershell
# 모델 배치(로컬) + ultralytics 설치는 v0.3에서 완료된 상태 가정
python seat1_e2e_test.py --preflight

# 위험 케이스 재현 확인: 사람이 잠깐 안 잡혀도 phone/laptop만으로 ABSENT 나오지 않아야 함
python seat1_e2e_test.py --single --engines opencv,yolo --camera-seconds 15 --debug-metrics
#   → 기대: person 미검출 순간 activity=UNKNOWN, reason_code=OBJECT_WITHOUT_PERSON (ABSENT 아님)

# 정상 공부 장면
python seat1_e2e_test.py --single --engines opencv,yolo --camera-seconds 15 --debug-metrics
#   → person + book/laptop + 휴대폰 없음 → STUDYING

# 저장까지
python seat1_e2e_test.py --single --engines opencv,yolo --camera-seconds 15 --save
```

> **로컬 real 재검증 필요:** Codespaces는 내부망/모델/ultralytics 없음 → 위 명령은 스터디카페 노트북에서 확인.

---

## 10. 남은 기술부채

1. **object-only의 시간적 확정 부재** — 현재는 단발 프레임 기준. person이 여러 프레임 연속 미검출 + 객체 지속이면
   진짜 자리비움일 수 있으나, v0.4는 안전하게 UNKNOWN 보류만 한다. 다중 프레임/시간 창 기반 판정은 후순위.
2. **person 검출 안정성** — 천장 카메라 각도로 person이 자주 끊기면 STUDYING/PHONE도 UNKNOWN이 잦아질 수 있음.
   confidence_threshold/ROI 실측 재보정, 프레임 다수결(YOLO sample_every_n_frames) 튜닝 필요.
3. **충돌(conflict) 코드 사실상 휴면** — 신정책의 상호배타 조건으로 두 룰이 동시 발동하는 경우가 드묾.
   방어적으로 코드는 유지(향후 다인 검출/SLEEPING 정교화 시 재활성 가능).
4. **PHONE 임계 경계** — 책+휴대폰+사람에서 PHONE conf가 임계 근처면 UNKNOWN이 됨. 실데이터로 가중치 재검토 여지.
5. **object-only 대시보드는 evidence 기반** — reason_code 자체는 저장 payload에 없음(evidence의 detected/counts로 추론).
   reason_code를 metadata에 저장하면 더 명시적(스키마 변경, 후순위).
6. **real 재검증 미실행** — v0.4 로직은 로컬 실제 카메라에서 재확인 필요.

---

## 11. 다음 v0.5 제안

1. **시간 창 기반 안정화 강화(DecisionStabilizer 연계)**: object-only/UNKNOWN이 N회 연속이면
   "사람 미검출 지속" 보조 신호로 안정화 후보 표시(여전히 자동 상태 변경 없음).
2. **person 검출 견고화**: 프레임 다수결(예: 최근 K프레임 중 M프레임 이상 person이면 present)로 일시 미검출 완충.
3. **MediaPipe 연동**: 손/자세 human fact 추가 → PHONE/STUDYING/SLEEPING 정밀도 향상.
4. **confidence_threshold·ROI 로컬 실측 재보정** + duration 관찰로그로 하루치 검증.
5. **reason_code를 저장 payload에 포함**해 대시보드가 object-only/자리비움/신호부족을 정밀 구분.

---

## 보안 체크리스트 (커밋 전)

- [x] `.env` 미추적(gitignore) — 실제 비밀번호/service role key 커밋 안 됨
- [x] RTSP URL 항상 `rtsp://admin:****@192.168.219.50:554/stream2` 마스킹
- [x] service role key 출력/커밋 없음
- [x] 모델 파일(`*.pt`)·`models/` gitignore — 커밋 대상 아님
- [x] 영상/이미지/프레임 저장 코드 없음(debug metrics·evidence는 수치/텍스트만)
- [x] `ai_rule_decisions` update/delete 없음(insert only, `--save` 시에만)
- [x] 학생 상태/출결/벌점/알림 자동 변경 없음(object-only guard도 UNKNOWN 보류만)

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**
