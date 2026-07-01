# REVIEW — Preview Bridge v0.6-pre

솔로몬스터디카페 AI 학습관리 MVP — v0.5 로컬 5초 클립을 관리자 대시보드 **"최근 5초 보기"**에서 실제 재생하도록 **로컬 preview bridge 서버** 추가.

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**

- 작성일: 2026-07-01
- 대상 좌석: Seat1 (VIGI 서브스트림 `stream2`)
- RTSP(마스킹): `rtsp://admin:****@192.168.219.50:554/stream2`
- 작업 위치: Codespaces (서버/프론트 코드·테스트·문서) — **실제 재생은 로컬 노트북 전용**

---

## 1. v0.6-pre 한 줄 요약

로컬 노트북에서만 도는 **stdlib `http.server` 기반 preview bridge**(`preview_bridge_server.py`, 기본 `127.0.0.1:8765`)를 추가했다.
이 서버가 `temp/previews/<Seat>/latest.json`을 읽어 프론트 preview 필드로 제공(`/api/previews/<Seat>/latest`)하고
`latest.mp4`를 HTTP로 스트리밍(`/previews/<Seat>/latest.mp4`)한다.
프론트는 `VITE_LOCAL_PREVIEW_BRIDGE_URL`이 설정된 경우에만 카드에서 이 값을 가져와 **"최근 5초 보기"** 버튼을 활성화한다.
DB에는 여전히 영상 미저장, path traversal 방지·localhost-only·no-store·디렉터리 목록 금지를 적용했다.

---

## 2. v0.5 / v0.5.1 실제 로컬 성공 결과

- v0.5: 관리자 AI 판정 카드에 preview UI/상태값 추가 완료.
- v0.5: `preview_clip_capture.py`로 로컬 5초 mp4 생성 성공.
- v0.5.1: `latest.json` note 인코딩 깨짐 수정(ASCII 영문 + `ensure_ascii=True`).
- 실제 로컬 테스트:
  - `status=available`, `frame_count=133`, `fps=25.0`, `clip_filename=latest.mp4`
  - `latest.mp4` 재생 성공
  - `latest.json` note 정상: `admin preview only; temporary clip; not stored in DB; no automatic status change`

→ 클립 생성·저장·인코딩까지 검증됨. 남은 고리는 **"그 클립을 대시보드 버튼에서 재생"** = 이번 bridge.

---

## 3. 왜 로컬 bridge가 필요한가

- 브라우저는 `temp/previews/Seat1/latest.mp4` 같은 **로컬 파일 경로를 직접 재생할 수 없다**(file:// 접근 차단, 보안).
- 클립은 **스터디카페 내부망 카메라**에서 로컬로 생성된다. 외부(배포 서버)에서 그 파일에 접근할 수 없다.
- 따라서 **같은 로컬 노트북에서 도는 작은 HTTP 서버**가 그 파일을 `http://127.0.0.1:8765/...`로 노출해야
  대시보드의 `<video>`가 재생할 수 있다.
- 외부 의존성 없이(`http.server` 표준 라이브러리) 관리자 노트북에서 즉시 띄울 수 있어 MVP에 적합하다.

---

## 4. Cloudflare 배포 화면에서 제한되는 이유

- 배포된 대시보드(Cloudflare)는 **인터넷 상의 페이지**다. 관리자 노트북의 `127.0.0.1:8765`는 그 페이지 입장에서 접근 대상이 아니다(각 PC의 localhost는 서로 다름).
- 스터디카페 내부망 RTSP·로컬 임시 파일은 외부에서 도달 불가.
- 그래서 **이번 단계는 로컬 관리자 확인용**이다. 배포 화면에서는 `VITE_LOCAL_PREVIEW_BRIDGE_URL` 미설정 → 미리보기는 **"준비 안 됨"** 상태를 안전하게 유지한다(기능 저하 없음, 오류 없음).

---

## 5. 로컬 실행 방법 (스터디카페 노트북)

```powershell
# PowerShell 1 — 5초 클립 생성(임시·자동만료)
python preview_clip_capture.py --seat Seat1 --seconds 5 --ttl 120

# PowerShell 2 — 로컬 bridge 서버
python preview_bridge_server.py --host 127.0.0.1 --port 8765

# PowerShell 3(선택) — 프론트 dev 서버(환경변수 설정 후)
#   .env.local 에 VITE_LOCAL_PREVIEW_BRIDGE_URL=http://127.0.0.1:8765 추가
npm run dev
```

브라우저 확인:
```
http://127.0.0.1:8765/health
http://127.0.0.1:8765/api/previews/Seat1/latest
http://127.0.0.1:8765/previews/Seat1/latest.mp4
```

---

## 6. `preview_clip_capture.py` 실행 방법

```powershell
python preview_clip_capture.py --seat Seat1 --seconds 5 --ttl 120   # 클립 생성
python preview_clip_capture.py --cleanup                            # 만료 클립 정리
```
- 결과: `temp/previews/Seat1/latest.mp4`(임시) + `latest.json`(메타). DB 미저장, gitignore.

---

## 7. `preview_bridge_server.py` 실행 방법

```powershell
python preview_bridge_server.py --host 127.0.0.1 --port 8765
#   --out-root 로 preview 루트 지정 가능(기본 temp/previews)
```

엔드포인트 / 실측 응답:
```
GET /health
  200 {"status":"ok","service":"preview-bridge","version":"0.6-pre","note":"local admin preview only; not stored in DB"}
  Cache-Control: no-store

GET /api/previews/Seat1/latest
  200 {"seat_id":"Seat1","preview_status":"available",
       "preview_clip_url":"http://127.0.0.1:8765/previews/Seat1/latest.mp4",
       "preview_generated_at":"...","preview_expires_at":"...","preview_duration_seconds":5.0}

GET /previews/Seat1/latest.mp4
  200 Content-Type: video/mp4  Cache-Control: no-store

# 안전:  /api/previews/..%2f..%2fetc/latest → 400,  / → 404 (디렉터리 목록 없음)
```

상태 규칙: `latest.json` 없음 → `unavailable`, `expires_at` 지남 → `expired`, `available`인데 mp4 없음 → `unavailable`.

---

## 8. 프론트 `VITE_LOCAL_PREVIEW_BRIDGE_URL` 설정 방법

`.env.local`(gitignore 대상, 커밋 금지):
```
VITE_LOCAL_PREVIEW_BRIDGE_URL=http://127.0.0.1:8765
```
- 설정 시: Seat 카드가 `${bridge}/api/previews/<Seat>/latest`를 fetch → preview 필드를 row에 **보완(override)** → "최근 5초 보기" 버튼 활성.
- 미설정 시: fetch 안 함 → 기존처럼 **"미리보기 준비 안 됨"**(배포/Cloudflare 기본).
- fetch 실패 시: **"미리보기 오류"**로 안전 표시(판정 표시는 안 깨짐).
- 기존 `ai_rule_decisions` row의 `preview_*` optional 구조는 그대로 유지(bridge가 이를 보완).

---

## 9. 개인정보 / 영상 저장 원칙

- **DB(`ai_rule_decisions`)에 영상/이미지/프레임 바이너리 저장 없음.** bridge는 로컬 임시 파일만 서빙.
- 클립은 임시 파일 + 짧은 TTL(기본 120초) + 만료 시 제공 안 함/자동 삭제.
- 프레임/스크린샷 개별 저장 없음(임시 mp4 하나, 64KB 청크 스트리밍).
- `temp/`, `previews/`, `*.mp4`, 이미지 확장자는 **gitignore**(커밋 금지).
- RTSP 원문 URL/비밀번호, service role key, `.env`는 출력·커밋 금지(bridge는 RTSP를 다루지도 않음).
- **학생 상태/출결/벌점/알림/보호자 연락 자동 변경 없음.** 미리보기는 읽기 전용 보조.

---

## 10. 보안 제한

- **localhost only**: 기본 바인드 `127.0.0.1`. 그 외 host는 경고. CORS는 `localhost`/`127.0.0.1`(임의 포트)만 허용(`ALLOWED_ORIGIN_RE`).
- **path traversal 방지**: `seat_id`는 `^[A-Za-z0-9_-]{1,32}$`만 허용(`is_safe_seat`). 파일 경로는 `os.path.commonpath`로 **out_root 하위** 보장(`resolve_clip_path`) — 벗어나면 None → 404/400.
- **no directory listing**: `SimpleHTTPRequestHandler` 미사용, 명시 라우팅만. 그 외 경로/디렉터리 요청은 전부 404.
- **캐시 방지**: 모든 응답에 `Cache-Control: no-store`.
- **만료 클립 미제공**: `expires_at` 지난 클립은 api에서 `expired`, mp4는 410.

---

## 11. 테스트 결과 (Codespaces 실측)

| 스위트 | 결과 |
|---|---|
| `test_preview_bridge_server.py` (신규) | **10 passed** (safe_seat/origin/resolve/build 5종/HTTP 통합/no-db) |
| `test_preview_clip_capture.py` | **11 passed** (유지) |
| `rtsp-poc` 전체 Python | **137 passed** |
| 프론트 `tsc --noEmit` | **에러 0** |
| 프론트 `vitest`(admin-ai-decisions) | **45 passed** (bridge 통합 5개 포함) |

프론트 bridge 테스트: URL 없음→"준비 안 됨"(fetch 안 함), available→"최근 5초 보기" 버튼, expired→"만료됨", fetch 실패→"미리보기 오류", unavailable→"준비 안 됨"+기존 PHONE 표시 유지.
bridge 라이브 스모크: `/health` 200(no-store, CORS localhost:3000), `/api` available+clip_url, `/mp4` 200 video/mp4, traversal 400, `/` 404.

---

## 12. 남은 기술부채

1. **row 주입 vs per-card fetch** — 현재 각 카드가 bridge를 fetch. 좌석 많으면 배칭/폴링/react-query 캐시로 개선 여지.
2. **Range 요청 미지원** — `Accept-Ranges: none`. 긴 영상 seek엔 부적합(5초라 문제 적음).
3. **인증 없음** — 로컬 bridge는 열려 있음(localhost 한정). 다중 사용자 PC라면 토큰/최소 인증 필요.
4. **폴링/갱신 없음** — 카드가 마운트 시 1회 fetch. 클립 갱신 반영엔 재조회 트리거 필요.
5. **다른 학생 노출/블러 미처리** — v0.6 이의신청과 함께 필수.
6. **실제 재생 로컬 미검증** — bridge 로직·헤더는 검증됐으나, 실제 VIGI 클립을 브라우저 `<video>`로 재생하는 것은 로컬 노트북 재검증 필요.

---

## 13. 다음 v0.6 제안 — 근거 클립 기반 **학생 이의신청 / 감사로그 / 다운로드 방지 / 블러**

> 이번 단계에서 Supabase schema 변경·DB migration·학생 이의신청 구현은 **하지 않는다**(문서화만).

**원칙(반드시 유지):**
1. **벌점은 AI가 자동 확정하지 않는다.**
2. AI 판정은 **증거 후보**, 관리자가 확인 후 **"벌점 예정(PENDING)"**으로만 만든다.
3. 학생은 **본인 좌석·본인 벌점 건**에 한해 짧은 클립을 확인할 수 있다.
4. 학생은 **인정 / 이의신청**을 선택.
5. 이의신청 **사유**를 남길 수 있다.
6. **관리자가 최종 확정/취소**.
7. 클립은 **영구 저장하지 않고 제한 시간 후 만료**.
8. 클립에 **다른 학생이 나오면 블러 처리 또는 미제공**.
9. **다운로드 비허용**(`<video controlsList="nodownload" disablePictureInPicture>` + 우클릭 방지 + 서버 단기 서명 URL·no-store).
10. **열람 기록·이의신청 기록을 감사 로그**로 남긴다.
11. 학생 상태/출결/벌점은 **AI가 자동 변경하지 않는다**.

**상태 흐름(초안):**
```
AI 판정(증거 후보) ─(관리자 확인)→ 벌점 예정(PENDING)
   ├─ 학생 열람(본인 건·만료 전·블러·비다운로드)
   │     ├─ 인정(ACK)
   │     └─ 이의신청(APPEAL + 사유)
   └─(관리자 최종)→ 확정(CONFIRMED) | 취소(CANCELLED)
   * 모든 열람/이의/확정/취소 = 감사 로그. 벌점 값 자동 변경 없음.
```

**v0.6 구현 후보:**
- bridge 확장: seat별 접근 토큰(학생 본인 건만), 다운로드 방지 헤더, 만료 단기화, 블러 파이프라인(타 학생 검출 시 마스킹 또는 미제공).
- 프론트: 학생용 "내 벌점 예정 + 근거 클립(블러/비다운로드)" 화면, 인정/이의 버튼 + 사유 입력.
- 데이터(후속): `penalty_candidates`, `appeals`, `preview_access_audit` — **영상 바이너리 미저장**.

---

## 보안 체크리스트 (커밋 전)

- [x] `.env`/`.env.local` 미추적, service role key 출력/커밋 없음
- [x] RTSP URL 항상 `rtsp://admin:****@192.168.219.50:554/stream2` 마스킹(bridge는 RTSP 미취급)
- [x] 모델 `*.pt` / `temp/` / `previews/` / `*.mp4`·이미지 gitignore — 커밋 대상 아님
- [x] DB에 영상/이미지/프레임 바이너리 저장 없음(bridge는 로컬 파일만 서빙)
- [x] path traversal 방지 / localhost-only / no directory listing / no-store
- [x] `ai_rule_decisions` update/delete 없음, schema/migration 변경 없음
- [x] 학생 상태/출결/벌점/알림 자동 변경 없음

> **AI 판정은 보조 지표입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.**
>
> **STABLE 도 확정이 아닙니다.**
