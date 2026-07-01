# REVIEW — Preview Clip v0.5

솔로몬스터디카페 AI 학습관리 MVP — 관리자 대시보드 Seat 카드에 **최근 5초 미리보기(관리자 확인용)** 추가.

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**

- 작성일: 2026-07-01
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`
- 작업 위치: Codespaces (프론트 UI·타입·테스트 + 로컬 클립 스크립트 골격/문서)
- **실제 클립 재생은 스터디카페 Wi-Fi 로컬 노트북에서만 가능** (Cloudflare 배포 화면에서는 로컬 파일 접근 제한)

---

## 1. v0.5 한 줄 요약

AI 판정 카드(3층 구조: 단발 AI / 안정화 후보 / **미리보기**)에 **"최근 5초 보기"** 영역을 추가했다.
실시간 스트리밍(WebRTC/HLS)이 아니라 **로컬에서 임시로 생성한 5초 클립**을 관리자 확인용으로만 재생하며,
영상 바이너리는 **DB에 저장하지 않고** 짧은 TTL 후 자동 만료·삭제된다.
Codespaces에서는 fake preview 데이터로 UI/상태만 검증하고, 실제 캡처는 로컬 노트북 전용 스크립트로 분리했다.

---

## 2. 왜 실시간 스트리밍이 아니라 5초 미리보기인가

1. **MVP 범위·비용**: WebRTC/HLS는 시그널링 서버·TURN·트랜스코딩·동시연결 관리가 필요하다. MVP 검증 단계에서 과도.
2. **개인정보 최소화**: 상시 스트림은 상시 노출이다. "판정이 있을 때 그 근거 5초만" 잠깐 보는 편이 노출을 최소화한다.
3. **저장 안 함 원칙과 정합**: 5초 클립은 임시 파일 + 짧은 TTL로 "영구 저장 안 함"을 지키기 쉽다.
4. **네트워크 현실**: 스터디카페 내부망 RTSP는 외부(Cloudflare)에서 직접 접근 불가. 로컬에서 만든 임시 클립을 로컬에서 확인하는 구조가 현실적.
5. **용도 적합**: 관리자는 "지금 라이브"가 아니라 "이 판정의 근거"를 잠깐 확인하면 된다.

---

## 3. 개인정보 / 영상 저장 원칙

- **기본값은 영상 저장 안 함.** DB(`ai_rule_decisions`)에 영상/이미지/프레임 바이너리를 **절대 저장하지 않는다.**
- 5초 클립은 **관리자 확인용 임시 파일**(`temp/previews/<Seat>/latest.mp4`)로만 존재하며 **gitignore**(커밋 금지).
- **자동 삭제 원칙**: 클립은 짧은 TTL(기본 120초)을 갖고 만료되면 `cleanup_expired()`로 삭제된다.
- 프레임/스크린샷 개별 저장 없음(임시 mp4 하나만, 개별 이미지 파일 미생성).
- RTSP URL 비밀번호는 항상 마스킹, service role key/.env는 출력·커밋 금지.
- **학생 상태/출결/벌점/알림/보호자 연락을 자동 변경하지 않는다.** 미리보기는 읽기 전용 보조 수단.
- 실제 캡처는 로컬 노트북에서만. Codespaces에서는 fake/mock 데이터로 UI만 검증.

---

## 4. 수정 파일 목록

**신규**
| 파일 | 역할 |
|---|---|
| `src/features/admin-ai-decisions/previewTypes.ts` | `PreviewDisplayState`, `derivePreviewState()`, 상태 라벨·원칙 문구 |
| `src/.../components/SeatPreviewButton.tsx` | 카드 3층 미리보기 영역(버튼/상태 뱃지/인라인 video/원칙 문구) |
| `rtsp-poc/preview_clip_capture.py` | 로컬 전용 임시 5초 클립 생성 골격(cv2 lazy, TTL/자동삭제) |
| `rtsp-poc/test_preview_clip_capture.py` | 클립 스크립트 순수 로직 테스트(9개) |
| `rtsp-poc/REVIEW_Preview_Clip_v0.5.md` | 본 리뷰 |

**수정**
| 파일 | 변경 |
|---|---|
| `src/.../types.ts` | `AIDecisionRow`에 preview optional 필드 5개 + `PreviewStatus` 타입 |
| `src/.../components/AIDecisionSeatCard.tsx` | 3층에 `<SeatPreviewButton>` 추가 |
| `src/.../__tests__/AIDecisionComponents.test.tsx` | preview 상태 테스트 4개 |
| `rtsp-poc/.gitignore` | `temp/`, `previews/`, `*.mp4/webm/avi/mkv/jpg/jpeg/png` 제외 |

---

## 5. 프론트 UI 변경 설명

- 카드는 이제 **3층 구조**: ① 단발 AI 판정 → ② 안정화 후보 → ③ **최근 5초 미리보기**.
- `SeatPreviewButton`은 `derivePreviewState(row, nowMs)`로 표시 상태를 정하고:
  - `preview_available` + `preview_clip_url` → **"최근 5초 보기" 버튼**(클릭 시 인라인 `<video controls preload="none" playsInline>` 토글).
  - 그 외 상태 → 상태 뱃지("미리보기 준비 안 됨" / "미리보기 생성 중…" / "미리보기 만료됨" / "미리보기 오류").
- **원칙 문구 항상 노출**: `· 관리자 확인용 미리보기` / `· 영상은 영구 저장되지 않음` / `· AI 판정은 보조 지표 · 자동 상태 변경 없음`.
- 기존 표시(PHONE/ABSENT/UNKNOWN/object-only 힌트/안정화 후보/상세 버튼) 그대로 유지.
- 반응형: `flex-wrap`, `text-[9~10px]`, `video`는 `w-full max-h-40`로 작은 카드에서도 깨지지 않음.
- `preview_*` 필드는 **옵션**이라 `ai_rule_decisions` SELECT 결과(값 없음)에서도 안전(→ "미리보기 준비 안 됨").

---

## 6. preview 상태값 정의

원시 상태(`AIDecisionRow.preview_status: PreviewStatus`): `available | loading | expired | unavailable | error`.

표시 상태(`PreviewDisplayState`, `derivePreviewState`가 원시상태+만료시각+url 종합):

| 표시 상태 | 조건 | 화면 |
|---|---|---|
| `preview_available` | `clip_url` 있음 + (status `available`/미지정) + 미만료 | **"최근 5초 보기"** 버튼 |
| `preview_loading` | status `loading` | "미리보기 생성 중…" |
| `preview_expired` | status `expired` 또는 `preview_expires_at` 초과 | "미리보기 만료됨" |
| `preview_unavailable` | clip_url 없음/기타 | "미리보기 준비 안 됨" |
| `preview_error` | status `error` | "미리보기 오류" |

우선순위: `error > loading > expired > available > unavailable`.

Python 메타 상태(`preview_clip_capture.py`)도 동일 어휘(`available/loading/expired/unavailable/error`)를 사용해 프론트와 정합.

---

## 7. 로컬 임시 클립 생성 구조

`rtsp-poc/preview_clip_capture.py` (로컬 전용):

```
RTSP(env SEAT1_RTSP_URL) ──cv2.VideoCapture(lazy)──▶ 최근 N초 프레임
       │                                                  │
       │                              cv2.VideoWriter(mp4v)│  (개별 이미지 저장 X)
       ▼                                                  ▼
temp/previews/Seat1/latest.mp4 (임시·gitignore)   temp/previews/Seat1/latest.json (사이드카 메타)
                                                    { seat_id, status, generated_at,
                                                      expires_at, duration_seconds, ttl_seconds,
                                                      frame_count, fps, clip_filename }
```

- **메타 JSON이 프론트 preview 필드의 원천**이다(영상 바이너리 아님). 원문 경로/URL/비밀번호는 메타에 넣지 않고 **파일명만** 남긴다.
- `expires_at = generated_at + ttl`(기본 120초). `cleanup_expired()`가 만료 클립/메타를 삭제.
- RTSP 없음 → `status=unavailable`(메타만, mp4 미생성). 캡처 실패 → `status=error`(예외 대신 메타).
- 순수 함수(`clip_paths`/`build_metadata`/`is_expired`/`mask_rtsp`)는 cv2·카메라 없이 테스트 가능.
- **DB 저장/업로드/update/delete 없음**, **프레임 개별 저장 없음**, 학생 도메인 코드 없음(소스 스캔 테스트로 강제).

> 서빙 레이어(로컬 dev 서버가 `temp/previews`를 `preview_clip_url`로 노출)는 v0.5 범위 밖 — 후속/로컬 구성.

---

## 8. 실제 카메라 재검증 방법 (스터디카페 로컬 노트북)

```powershell
# 1) 최근 5초 클립 생성(임시·자동만료)
python preview_clip_capture.py --seat Seat1 --seconds 5 --ttl 120
#   → status=available, temp/previews/Seat1/latest.mp4 생성(로컬 전용)

# 2) 만료 클립 정리
python preview_clip_capture.py --cleanup

# 3) 로컬 dev 서버로 temp/previews 를 정적 서빙 후, 대시보드 row 에
#    preview_clip_url / preview_status='available' / preview_expires_at 주입 → "최근 5초 보기" 확인
```

> **로컬 전용:** Codespaces/Cloudflare 배포 화면에서는 내부망 RTSP·로컬 파일 접근이 제한된다.
> 실제 클립 재생은 스터디카페 Wi-Fi 로컬 노트북에서만 가능하다.

---

## 9. 테스트 결과 (Codespaces 실측)

| 스위트 | 결과 |
|---|---|
| `test_preview_clip_capture.py` (신규) | **9 passed** (mask/paths/metadata/expiry/capture(no-rtsp)/cleanup/no-db) |
| `rtsp-poc` 전체 Python | **125 passed** (기존 116 + 신규 9) |
| 프론트 `tsc --noEmit` | **에러 0** |
| 프론트 `vitest`(admin-ai-decisions) | **40 passed** (preview 4개 포함) |

프론트 preview 테스트: preview 없음→"미리보기 준비 안 됨", url 있음→"최근 5초 보기" 버튼,
`expired`/만료초과→"미리보기 만료됨", `error`→"미리보기 오류". 기존 PHONE·object-only 표시 테스트 유지.

CLI 스모크(RTSP 없음): `status=unavailable`, 메타 JSON만 생성(mp4 미생성) 확인.

---

## 10. 남은 기술부채

1. **서빙 레이어 미구현** — `temp/previews`를 `preview_clip_url`로 노출하는 로컬 정적 서버 + row 주입 경로는 후속.
2. **다른 학생 노출 처리 없음** — 클립에 타 학생이 잡히면 블러/미제공이 필요(v0.6 이의신청과 함께).
3. **실제 캡처 로컬 미검증** — cv2 VideoWriter mp4 생성은 로컬 노트북에서 재검증 필요(Codespaces는 카메라/내부망 없음).
4. **preview 필드 원천 연결 미완** — 메타 JSON → 프론트 row 주입 파이프라인(로컬 인덱스/폴링) 설계 필요.
5. **접근 통제·감사 없음** — 누가 언제 미리보기를 열람했는지 로그가 없음(v0.6 감사 로그 후보).
6. **다운로드 방지 강제 아님** — 현재 `<video controls>`는 브라우저 다운로드 여지. v0.6에서 다운로드 비허용 정책 강제 필요.

---

## 11. 다음 v0.6 제안 — "근거 클립 기반 학생 이의신청(Appeal)" 후보

**배경:** 추후 벌점 부과 시, 학생도 **짧은 근거 클립**을 확인하고 **이의신청**할 수 있는 구조를 고려한다.
v0.5는 관리자용 5초 미리보기까지만 만들고, 학생용 이의신청은 v0.6 후보로 문서화한다.

**원칙(반드시 유지):**
1. **벌점은 AI가 자동 확정하지 않는다.**
2. AI 판정은 **증거 후보**이고, 관리자가 확인한 뒤 **"벌점 예정" 상태**로만 만든다.
3. 학생은 **본인 좌석·본인 벌점 건에 한해** 짧은 클립을 확인할 수 있다.
4. 학생은 **인정 / 이의신청**을 선택할 수 있다.
5. 이의신청 **사유를 남길 수 있다.**
6. **관리자가 최종 확정/취소**한다.
7. 클립은 **영구 저장하지 않고 제한 시간 이후 만료**한다.
8. 클립에 **다른 학생이 나오면 블러 처리 또는 제공하지 않는다.**
9. **다운로드는 허용하지 않는다.**
10. **열람 기록·이의신청 기록은 감사 로그**로 남긴다.
11. 학생 상태/출결/벌점은 **AI가 자동 변경하지 않는다**는 원칙을 유지한다.

**제안 상태 흐름(초안, 자동 확정 없음):**
```
AI 판정(증거 후보)
   └─(관리자 확인)→ 벌점 예정(PENDING)
          ├─(학생 열람: 본인 건, 만료 전, 블러/비다운로드)
          │     ├─ 인정(ACK) ─────────────┐
          │     └─ 이의신청(APPEAL + 사유) │
          └────────────────────────────────┤
                            (관리자 최종)   ▼
                          확정(CONFIRMED) 또는 취소(CANCELLED)
   * 모든 열람/이의/확정/취소는 감사 로그(audit)로 기록. 벌점 값 자동 변경 없음.
```

**v0.6 구현 후보(문서 단계):**
- 데이터: `penalty_candidates`(status: PENDING/CONFIRMED/CANCELLED), `appeals`(reason, decision), `preview_access_audit`(who/when/seat/clip_ref). 영상 바이너리 미저장.
- 프론트: 학생용 "내 벌점 예정 + 근거 클립(블러·비다운로드)" 화면, 인정/이의 버튼, 사유 입력.
- 클립 정책: 만료 TTL, 다운로드 비허용(`controlsList="nodownload"` + 서버 단기 서명 URL), 타 학생 블러.
- 관리자: 이의신청 큐 → 최종 확정/취소(수동). AI는 끝까지 자동 변경하지 않음.

---

## 보안 체크리스트 (커밋 전)

- [x] `.env` 미추적, service role key 출력/커밋 없음
- [x] RTSP URL 항상 `rtsp://admin:****@192.168.219.50:554/stream2` 마스킹
- [x] 모델 `*.pt` / `temp/` / `*.mp4`·이미지 gitignore — 커밋 대상 아님(temp/ 미추적 확인)
- [x] DB에 영상/이미지/프레임 바이너리 저장 없음(메타 JSON만, 로컬 임시)
- [x] 프레임 개별 저장 없음(임시 mp4 하나), 자동 삭제(TTL)
- [x] `ai_rule_decisions` update/delete 없음
- [x] 학생 상태/출결/벌점/알림 자동 변경 없음(미리보기는 읽기 전용 보조)

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**
