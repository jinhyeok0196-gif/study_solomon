# COMPONENT_STRUCTURE — 컴포넌트 구조

---

## 디렉토리 트리

```
src/
├── components/                   # 재사용 글로벌 컴포넌트
│   ├── layout/
│   │   ├── AdminLayout.tsx       # 관리자 레이아웃 (사이드바 + Outlet)
│   │   ├── AdminSidebar.tsx      # 관리자 사이드 네비게이션
│   │   ├── Header.tsx            # 공통 헤더
│   │   ├── StudentBottomNav.tsx  # 학생 하단 탭 바 (7개 메뉴)
│   │   └── StudentLayout.tsx     # 학생 레이아웃 (헤더 + Outlet + BottomNav)
│   ├── schedule/
│   │   ├── CurrentPeriodCard.tsx # 현재 교시 카드 (실시간 업데이트)
│   │   ├── LiveClock.tsx         # 실시간 시계 컴포넌트
│   │   ├── ScheduleTimeline.tsx  # 교시별 타임라인 뷰
│   │   └── StudentStatusBadge.tsx# 학생 현재 상태 배지 (착석/외출/파워냅)
│   ├── shared/
│   │   ├── ConfigurationErrorPage.tsx # 환경변수 미설정 시 에러 화면
│   │   ├── NotFoundPage.tsx           # 404 페이지
│   │   ├── PagePlaceholder.tsx        # 미구현 페이지 플레이스홀더
│   │   ├── ProtectedRoute.tsx         # 미인증 시 로그인 페이지로 redirect
│   │   └── RoleGuard.tsx              # 역할 불일치 시 역할별 홈으로 redirect
│   └── ui/
│       ├── Badge.tsx             # 상태 배지 (색상 variant 지원)
│       ├── Button.tsx            # 기본 버튼 (variant, size, loading 지원)
│       ├── Card.tsx              # 카드 컨테이너
│       ├── EmptyState.tsx        # 데이터 없음 상태 UI
│       ├── FormField.tsx         # 레이블+에러 포함 폼 필드 래퍼
│       ├── Input.tsx             # 기본 입력 필드
│       ├── Modal.tsx             # 모달 다이얼로그 (portal 기반)
│       └── Spinner.tsx           # 로딩 스피너
│
├── features/                     # 도메인별 기능 단위
│   ├── admin-attendance/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── admin-dashboard/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── admin-penalty/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   └── schema.ts
│   ├── admin-requests/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── admin-schedule/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── admin-students/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   ├── schema.ts
│   │   ├── types.ts
│   │   └── components/
│   │       ├── CreateStudentForm.tsx
│   │       └── EditStudentForm.tsx
│   ├── admin-warning/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── attendance/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   ├── labels.ts
│   │   ├── stats.ts
│   │   └── stats.test.ts
│   ├── auth/
│   │   ├── api.ts
│   │   ├── phone.ts              # 전화번호 → 이메일 변환
│   │   ├── phone.test.ts
│   │   ├── schema.ts
│   │   └── components/
│   │       ├── GoogleLoginButton.tsx
│   │       └── PhoneLoginForm.tsx
│   ├── chat/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   ├── studentPanelApi.ts
│   │   ├── types.ts
│   │   ├── useChatRealtime.ts    # postgres_changes 구독
│   │   ├── usePresence.ts        # 온라인 상태 + 입력 중
│   │   ├── useTyping.ts          # (미사용, usePresence로 대체됨)
│   │   └── components/
│   │       ├── ChatBubble.tsx         # 메시지 버블 (읽음 확인, 이미지, 재시도)
│   │       ├── ChatDateDivider.tsx    # 날짜 구분선
│   │       ├── ChatInput.tsx          # 입력창 (드래그&드롭 이미지 업로드)
│   │       ├── OnlineStatusBadge.tsx  # 온라인/오프라인 표시
│   │       ├── StudentStatusPanel.tsx # 관리자 채팅 우측 학생 상태 패널
│   │       └── TypingIndicator.tsx    # 입력 중 표시 (3점 애니메이션)
│   ├── mypage/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   └── types.ts
│   ├── notifications/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── outing/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── penalty/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   ├── risk.ts               # 벌점 리스크 레벨 계산
│   │   └── risk.test.ts
│   ├── powernap/
│   │   ├── api.ts
│   │   └── hooks.ts
│   ├── requests/
│   │   ├── api.ts
│   │   ├── hooks.ts
│   │   ├── schema.ts
│   │   ├── types.ts
│   │   └── components/
│   │       ├── RequestForm.tsx
│   │       └── RequestList.tsx
│   └── schedule/
│       ├── api.ts
│       ├── hooks.ts
│       ├── dates.ts              # 주 시작일 계산
│       ├── dates.test.ts
│       ├── types.ts
│       └── components/
│           └── WeeklyScheduleGrid.tsx  # 7×8 시간표 격자
│
├── pages/                        # 라우트별 페이지 컴포넌트
│   ├── admin/
│   │   ├── AttendancePage.tsx
│   │   ├── ChatPage.tsx          # 3패널: 학생목록 + 채팅 + 상태패널
│   │   ├── DashboardPage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── NotificationsPage.tsx
│   │   ├── PenaltiesPage.tsx
│   │   ├── RequestsPage.tsx
│   │   ├── SchedulesPage.tsx
│   │   ├── StudentDetailPage.tsx
│   │   ├── StudentsPage.tsx
│   │   └── WarningsPage.tsx
│   ├── auth/
│   │   ├── CallbackPage.tsx      # 구글 OAuth 콜백 처리
│   │   └── RegisterPage.tsx      # 신규 학생 이름/전화번호 등록
│   └── student/
│       ├── AbsenceRequestPage.tsx
│       ├── AttendancePage.tsx
│       ├── ChatPage.tsx
│       ├── DashboardPage.tsx
│       ├── LeaveRequestPage.tsx
│       ├── LoginPage.tsx
│       ├── MyPage.tsx
│       ├── OutingPage.tsx
│       ├── PenaltyPage.tsx
│       ├── PowerNapPage.tsx
│       ├── ScheduleHistoryPage.tsx
│       └── SchedulePage.tsx
```

---

## 라우트 구조

### 학생 라우트 (StudentLayout 하위)
```
/            → DashboardPage     (대시보드)
/schedule    → SchedulePage      (주간 시간표 제출)
/schedule/history → ScheduleHistoryPage (이력)
/attendance  → AttendancePage    (출석 기록)
/absence-requests/new → AbsenceRequestPage
/leave-requests/new   → LeaveRequestPage
/outing      → OutingPage        (외출 시작/복귀)
/power-nap   → PowerNapPage      (파워냅 타이머)
/penalty     → PenaltyPage       (벌점/경고)
/mypage      → MyPage
/chat        → ChatPage          (1:1 채팅)
```

### 관리자 라우트 (AdminLayout 하위, /admin 접두사)
```
/admin             → DashboardPage
/admin/students    → StudentsPage
/admin/students/:id → StudentDetailPage
/admin/schedules   → SchedulesPage
/admin/attendance  → AttendancePage
/admin/penalties   → PenaltiesPage
/admin/warnings    → WarningsPage
/admin/notifications → NotificationsPage
/admin/requests    → RequestsPage
/admin/chat        → ChatPage (3패널)
```

### 인증 라우트 (레이아웃 없음)
```
/login         → StudentLoginPage
/admin/login   → AdminLoginPage
/auth/callback → CallbackPage (구글 OAuth)
/auth/register → RegisterPage (신규 학생 등록)
```

---

## 레이아웃 계층

```
App
└── AuthProvider
    └── QueryClientProvider
        └── BrowserRouter
            └── AppRouter
                ├── /login           → StudentLoginPage
                ├── /admin/login     → AdminLoginPage
                ├── /auth/*          → Auth pages
                ├── ProtectedRoute (미인증 → /login)
                │   └── RoleGuard (role='student')
                │       └── StudentLayout
                │           ├── Header
                │           ├── <Outlet>  ← 학생 페이지들
                │           └── StudentBottomNav
                └── ProtectedRoute (미인증 → /admin/login)
                    └── RoleGuard (role='admin')
                        └── AdminLayout
                            ├── AdminSidebar
                            └── <Outlet>  ← 관리자 페이지들
```

---

## 핵심 컴포넌트 상세

### StudentBottomNav
7개 탭: 홈·시간표·출석·외출·파워냅·벌점·문의

### AdminSidebar
링크 목록: 대시보드·학생 관리·시간표·출결·벌점·경고·신청·알림·학생 문의

### StudentStatusPanel (채팅 우측 패널)
- Props: `{ studentId: string, roomId: string | null }`
- 15초 refetch 주기로 실시간 학생 데이터 표시
- 퀵 액션 버튼들이 각각 모달로 동작 (페이지 이동 없음)

### ChatBubble
- Props: `{ message: ChatMessageLocal, isOwn: boolean, isRead: boolean, onRetry? }`
- `_isPending`: 전송 중 (optimistic), `_isFailed`: 전송 실패 (재시도 버튼)
- `content.startsWith('__IMG__:')` → `<img>` 렌더링

### ChatInput
- Props: `{ onSend, isSending, showQuickReplies?, onTypingChange?, roomId? }`
- 드래그&드롭으로 이미지 업로드 → Supabase Storage → `__IMG__:url` 메시지 전송
- 2초 debounce로 입력 중 이벤트 발생

---

## UI 컴포넌트 Props 요약

### Button
```typescript
variant: 'primary' | 'secondary' | 'danger' | 'ghost'
size: 'sm' | 'md' | 'lg'
isLoading?: boolean
disabled?: boolean
```

### Badge
```typescript
variant: 'default' | 'success' | 'warning' | 'danger' | 'info'
```

### Modal
```typescript
isOpen: boolean
onClose: () => void
title?: string
children: ReactNode
```

### FormField
```typescript
label: string
error?: string
required?: boolean
children: ReactNode
```
