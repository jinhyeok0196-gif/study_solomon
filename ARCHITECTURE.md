# ARCHITECTURE — 전체 아키텍처

---

## 시스템 개요

```
┌─────────────────────────────────────────────────────┐
│                  사용자 브라우저                        │
│                                                     │
│  ┌──────────────┐         ┌──────────────┐          │
│  │  학생 포털    │         │  관리자 포털  │          │
│  │  (모바일)    │         │  (데스크톱)  │          │
│  └──────┬───────┘         └──────┬───────┘          │
│         │                        │                  │
│         └──────────┬─────────────┘                  │
│                    │                                │
│         React SPA (Vite + TypeScript)               │
│         TanStack Query (서버 상태 캐싱)               │
│         React Router v7 (라우팅)                     │
│         Tailwind CSS (스타일)                        │
└─────────────────────────┬───────────────────────────┘
                          │
               ┌──────────┴──────────┐
               │                     │
        HTTPS REST API          WebSocket
               │                     │
┌──────────────┴─────────────────────┴──────────────────┐
│                    Supabase                            │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐ │
│  │  PostgreSQL  │  │   Auth      │  │   Storage     │ │
│  │  (데이터)   │  │  (인증)     │  │  (이미지)     │ │
│  └─────────────┘  └─────────────┘  └───────────────┘ │
│         │                                             │
│  ┌──────┴──────────┐                                 │
│  │    Realtime     │  ← WebSocket 기반 실시간         │
│  │  postgres_changes│                                │
│  │  Presence       │                                │
│  └─────────────────┘                                │
└────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │    Cloudflare Pages    │
              │   (정적 SPA 호스팅)    │
              └───────────────────────┘
```

---

## 프론트엔드 아키텍처

### 상태 관리 계층

```
┌─────────────────────────────────────┐
│           React Context             │
│   AuthContext (user, isLoading)     │  ← 인증 상태 (전역)
└─────────────────────────────────────┘
                  │
┌─────────────────────────────────────┐
│         TanStack Query Cache        │  ← 서버 상태 (비동기 데이터)
│   queryKey → data                   │
│   ['chat-messages', roomId]         │
│   ['admin-chat-rooms']              │
│   ['admin-dashboard-summary']       │
│   ...                               │
└─────────────────────────────────────┘
                  │
┌─────────────────────────────────────┐
│       React Component State         │  ← 로컬 UI 상태
│   useState (모달 열림, 선택된 항목)  │
└─────────────────────────────────────┘
```

### 데이터 흐름

```
사용자 액션
    │
    ▼
Page Component
    │
    ├── useXxxQuery()  →  features/{domain}/hooks.ts
    │       │                      │
    │       │              features/{domain}/api.ts
    │       │                      │
    │       │              Supabase JS Client
    │       │                      │
    │       └──────── TanStack Query Cache ←──── Supabase Realtime
    │                                            (INSERT/UPDATE 이벤트)
    │
    └── useXxxMutation()
            │
            ├── onMutate: Optimistic Update (캐시 직접 수정)
            ├── mutationFn: API 호출
            ├── onError: 롤백
            └── onSuccess: 관련 쿼리 invalidate
```

### Realtime 데이터 흐름

```
DB 변경 (INSERT/UPDATE/DELETE)
    │
    ▼
Supabase Realtime Server
    │
    ▼ WebSocket
useChatRealtime / useRealtimeTableSync
    │
    ├── qc.setQueryData(...)    ← 캐시 직접 업데이트 (채팅)
    └── qc.invalidateQueries()  ← 쿼리 무효화 (그 외)
```

---

## 디렉토리 구조 원칙

```
src/
├── components/   # 도메인에 종속되지 않는 순수 UI
├── context/      # React Context (AuthContext만 존재)
├── features/     # 도메인 단위 캡슐화
│   └── {domain}/
│       ├── api.ts        # Supabase 호출 순수 함수
│       ├── hooks.ts      # TanStack Query 래퍼
│       ├── types.ts      # 도메인 타입 (DB 타입과 분리)
│       ├── schema.ts     # Zod 스키마
│       └── components/  # 해당 도메인 전용 컴포넌트
├── hooks/        # 여러 도메인에서 공유하는 커스텀 훅
├── lib/          # 외부 라이브러리 초기화
├── pages/        # 라우트 진입점
├── routes/       # 라우터 설정
├── types/        # 전역 도메인 타입
└── constants/    # 변경이 드문 상수
```

### 의존성 방향

```
pages → features → lib/supabase
pages → components → (없음)
features → hooks (공유)
features → constants
pages → hooks
```

역방향 의존 금지: `lib`이 `features`를 import하지 않음

---

## 인증 아키텍처

```
Supabase Auth
    │
    ├── 전화번호 로그인
    │   phone → email 변환 (010-XXXX-XXXX → 010XXXXXXXX@solomonstudy.app)
    │   signInWithPassword(email, password)
    │
    └── Google OAuth
        signInWithOAuth → /auth/callback → /auth/register (신규) or 홈 (기존)

로그인 성공
    │
    ▼
AuthContext.syncUserFromSession()
    │
    └── fetchUserProfile(userId)  →  users 테이블 조회
        │
        └── setUser({ id, role, name, phone })
                │
                ▼
        RoleGuard: role === 'student' → StudentLayout
                   role === 'admin'   → AdminLayout
```

**Realtime 인증 동기화**
```
onAuthStateChange(session)
    │
    └── supabase.realtime.setAuth(session.access_token)
        ← WebSocket에 JWT 전달 (필수: 없으면 SUBSCRIBED 안 됨)
```

---

## 채팅 시스템 아키텍처

```
학생 ChatPage                     관리자 ChatPage
      │                                 │
useChatRealtime                  useChatRealtime
  channel: chat-realtime-{roomId}
  postgres_changes: chat_messages INSERT/DELETE
  postgres_changes: message_reads INSERT
      │                                 │
      └──────── TanStack Query Cache ───┘
                  ['chat-messages', roomId]

useChatPresence (chat-global-presence)
  Presence: 온라인 상태 + 입력 중 표시
  setAuth: 로그인 후 JWT 자동 전달
```

---

## 빌드 및 배포 파이프라인

```
로컬 개발
    npm run dev
    ↓
코드 작성 + 타입 체크 (tsc --noEmit)
    ↓
git push origin main
    ↓
Cloudflare Pages 자동 감지
    ↓
npm run build (tsc + vite build)
    ↓
dist/ → Cloudflare CDN 배포
    ↓
https://[project].pages.dev
```

### PWA
- `vite-plugin-pwa`로 Service Worker 자동 생성
- `registerType: 'autoUpdate'` — 새 버전 자동 설치
- `public/manifest.json` 직접 사용
- 오프라인 지원 없음 (Supabase 연결 필수)

---

## Supabase 설정 구조

### 클라이언트 (`src/lib/supabase/client.ts`)
```typescript
createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } },
})

// Realtime JWT 동기화 (필수)
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    supabase.realtime.setAuth(session.access_token);
  }
});
```

### 타입 생성
`src/lib/supabase/database.types.ts` — `npm run db:types`로 재생성

### Storage
- 버킷: `chat-images`
- 최대 파일 크기: 5MB
- 허용 MIME: `image/*`
- 접근: 업로드는 인증 필요, 읽기는 public

---

## 성능 고려사항

| 항목 | 전략 |
|---|---|
| 서버 상태 캐싱 | TanStack Query (staleTime 설정) |
| 채팅 메시지 | `staleTime: Infinity` + Realtime 직접 캐시 수정 |
| 실시간 업데이트 | Supabase Realtime (폴링 없음) |
| 번들 크기 | 동적 import 고려 (현재 단일 번들 ~200KB gzipped) |
| 이미지 | Storage CDN URL 직접 사용 |

---

## 보안 고려사항

| 위협 | 대응 |
|---|---|
| 타 학생 데이터 접근 | Supabase RLS (서버 강제) |
| 관리자 권한 탈취 | RoleGuard + RLS 이중 검증 |
| SQL Injection | Supabase JS 파라미터 바인딩 |
| XSS | React JSX 기본 이스케이프 |
| 이미지 업로드 | MIME type + 크기 제한 (Storage 설정) |
| 인증 토큰 탈취 | HTTPS only, httpOnly는 Supabase 관리 |
