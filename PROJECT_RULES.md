# PROJECT_RULES

이 문서는 솔로몬스터디카페 프로젝트에서 반드시 지켜야 할 규칙을 정의합니다.
새로운 기여자는 작업 시작 전 반드시 숙지하세요.

---

## 1. 언어 및 네이밍

- **코드 언어**: 변수명·함수명·파일명은 영어
- **주석·문서·커밋 메시지**: 한국어 허용
- **UI 텍스트**: 한국어 (전체 한국어 서비스)
- **파일명 컨벤션**
  - 컴포넌트: PascalCase (`StudentStatusPanel.tsx`)
  - 훅: camelCase, `use` 접두사 (`useChatRealtime.ts`)
  - API/유틸: camelCase (`fetchChatMessages.ts`, `api.ts`)
  - 상수: camelCase 파일, SCREAMING_SNAKE_CASE 변수 (`PENALTY_POINTS`)

---

## 2. 역할 분리

### 학생(student) vs 관리자(admin)
- 모든 기능은 `user.role`을 기준으로 분기합니다.
- 학생 페이지는 `src/pages/student/`, 관리자 페이지는 `src/pages/admin/`에 위치합니다.
- RLS 정책이 서버에서 2차 검증을 수행합니다. 프론트엔드 `RoleGuard`만 믿지 마세요.

---

## 3. 데이터 페칭

- **서버 상태는 TanStack Query만 사용합니다.** `useEffect + fetch` 직접 사용 금지.
- 모든 쿼리/뮤테이션은 `features/{domain}/hooks.ts`에 정의합니다.
- **폴링(setInterval, 주기적인 SELECT 조회) 사용 금지.** 실시간 데이터는 Supabase Realtime으로 처리합니다.
- 쿼리 캐시 무효화는 `qc.invalidateQueries({ queryKey: [...] })`를 사용합니다.

---

## 4. Realtime 규칙

- 메시지/알림 등 실시간 데이터는 `supabase.channel().on('postgres_changes', ...)` 또는 Presence를 사용합니다.
- 채널은 컴포넌트 언마운트 시 반드시 `supabase.removeChannel(channel)`로 정리합니다.
- 새 테이블에 Realtime이 필요하면 반드시 `ALTER PUBLICATION supabase_realtime ADD TABLE ...`과 `REPLICA IDENTITY FULL`을 마이그레이션에 포함합니다.

---

## 5. 인증 및 보안

- 인증 상태는 `useAuth()` 훅을 통해서만 접근합니다.
- `user!.id` 사용 시 해당 컴포넌트가 `ProtectedRoute` 하위에 있는지 확인합니다.
- 민감한 작업(벌점 부여, 학생 계정 생성 등)은 반드시 RLS 또는 SECURITY DEFINER 함수로 보호합니다.
- SQL Injection 방지: 직접 SQL 문자열 조합 금지, Supabase JS 쿼리 빌더만 사용합니다.

---

## 6. 폼 및 유효성 검사

- 폼은 React Hook Form + Zod 스키마를 사용합니다.
- 스키마는 `features/{domain}/schema.ts`에 정의합니다.
- 서버 에러는 UI에 한국어로 표시합니다. 영어 에러 메시지를 그대로 노출하지 않습니다.

---

## 7. 스타일

- Tailwind CSS 유틸리티 클래스를 사용합니다. 별도 CSS 파일 생성 금지.
- 커스텀 색상은 `brand-{50..900}` 팔레트를 사용합니다 (파란색 계열).
- 조건부 클래스 조합은 `cn()` 유틸리티 (`src/lib/utils.ts`)를 사용합니다.
- 모바일 우선(mobile-first) 반응형 설계입니다. 학생 화면은 모바일, 관리자 화면은 데스크톱 기준입니다.

---

## 8. 컴포넌트 설계

- 페이지 컴포넌트(`pages/`)는 비즈니스 로직을 가져도 되지만, 재사용 컴포넌트(`components/`)는 순수 UI 컴포넌트여야 합니다.
- 특정 도메인에만 쓰이는 컴포넌트는 `features/{domain}/components/`에 위치합니다.
- Props 타입은 컴포넌트 파일 상단 `interface Props { ... }`로 정의합니다.

---

## 9. 에러 처리

- API 에러는 React Query의 `onError` 또는 `try/catch`에서 처리합니다.
- 유저에게 보여줄 에러 메시지는 한국어입니다.
- 에러 바운더리는 현재 미구현입니다. 중요 페이지 추가 시 고려하세요.

---

## 10. 테스트

- 순수 로직(날짜 계산, 통계, 리스크 평가 등)은 Vitest 단위 테스트를 작성합니다.
- UI 컴포넌트 테스트는 현재 최소화되어 있습니다. 추가는 환영합니다.
- 테스트 파일은 테스트 대상 파일과 같은 디렉토리에 `.test.ts(x)` 확장자로 작성합니다.

---

## 11. 커밋 컨벤션

```
feat: 새로운 기능 추가
fix: 버그 수정
refactor: 리팩토링
chore: 빌드/설정 변경
docs: 문서 변경
test: 테스트 추가/수정
```

예시: `fix: 채팅 Realtime WebSocket 인증 토큰 누락 수정`

---

## 12. 마이그레이션 규칙

- 마이그레이션 파일명은 `YYYYMMDD_설명.sql` 형식입니다.
- 한 번 배포된 마이그레이션은 수정하지 않습니다. 변경이 필요하면 새 마이그레이션을 작성합니다.
- 마이그레이션에는 반드시 RLS 정책과 인덱스를 함께 포함합니다.
- 새 테이블 추가 시 체크리스트:
  - [ ] `ENABLE ROW LEVEL SECURITY`
  - [ ] RLS 정책 (student: 본인만, admin: 전체)
  - [ ] 필요한 인덱스
  - [ ] Realtime 필요 시 `ALTER PUBLICATION` + `REPLICA IDENTITY FULL`
  - [ ] `db:types` 실행 후 타입 재생성
