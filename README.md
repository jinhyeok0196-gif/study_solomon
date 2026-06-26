# 솔로몬스터디카페 관리 시스템

스터디카페 운영에 필요한 학생·관리자 기능을 하나의 웹앱으로 통합한 SPA입니다.

## 기술 스택

| 분류 | 기술 |
|---|---|
| 프레임워크 | React 18 + TypeScript |
| 빌드 | Vite 8 |
| 라우팅 | React Router v7 |
| 서버 상태 | TanStack Query v5 |
| 백엔드 | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| 스타일 | Tailwind CSS v3 |
| 폼 | React Hook Form + Zod |
| 배포 | Cloudflare Pages |
| 테스트 | Vitest |

## 주요 기능

**학생 포털**
- 대시보드: 현재 교시 현황, 출석 통계, 벌점 리스크
- 주간 시간표 제출 및 이력 조회
- 출석 기록 조회
- 결석·조퇴 신청 및 승인 현황
- 외출 시작/복귀 기록
- 파워냅(낮잠) 타이머 (1일 1회, 최대 40분)
- 벌점·경고 내역 조회
- 1:1 채팅 (관리자 문의)
- 마이페이지

**관리자 포털**
- 대시보드: 실시간 현황 (착석·외출·파워냅·결석·지각 인원)
- 실시간 관제: 좌석 배치 기반 관제판 (좌석별 상태/교시/타이머, 클릭 시 학생 패널+채팅, 좌석 배정/해제, 실시간 이벤트 로그)
- 학생 관리 (등록·수정·상세 조회)
- 주간 시간표 확인 및 수정
- 출결 관리 (수동 처리 포함)
- 벌점 부여·차감 및 경고 관리
- 결석·조퇴 신청 승인/반려
- 실시간 알림 수신 (외출·파워냅·무단결석 등)
- 1:1 채팅 (학생 전체 목록 + 학생 상태 패널)

## 로컬 개발 환경 설정

```bash
# 의존성 설치
npm install

# 환경 변수 설정 (.env.local 파일 생성)
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key

# 개발 서버 실행 (http://localhost:3000)
npm run dev

# 타입 체크
npm run type-check

# 테스트 실행
npm test

# 프로덕션 빌드
npm run build
```

## 환경 변수

| 변수명 | 설명 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |

Cloudflare Pages 배포 시 대시보드 → Settings → Environment variables에 동일하게 등록합니다.

## 프로젝트 구조

```
src/
├── components/       # 재사용 UI 컴포넌트 (layout, ui, schedule, shared)
├── context/          # React Context (AuthContext)
├── features/         # 도메인별 API + hooks + 로컬 컴포넌트
├── hooks/            # 전역 커스텀 훅
├── lib/              # Supabase 클라이언트, QueryClient, 유틸
├── pages/            # 라우트별 페이지 컴포넌트
│   ├── admin/
│   └── student/
├── routes/           # AppRouter, paths 상수
├── types/            # 전역 도메인 타입
└── constants/        # 교시 정의, 벌점 규칙 등
```

## 배포

`main` 브랜치 푸시 시 Cloudflare Pages에 자동 배포됩니다.

- 빌드 명령: `npm run build`
- 출력 디렉토리: `dist`

## 데이터베이스 마이그레이션

마이그레이션 파일은 `supabase/migrations/`에 날짜순으로 관리합니다.
Supabase 대시보드 SQL 에디터에서 순서대로 실행합니다.

```bash
# 로컬 Supabase CLI 사용 시
npm run db:start    # 로컬 Supabase 시작
npm run db:reset    # 마이그레이션 재적용
npm run db:types    # TypeScript 타입 재생성
```

자세한 내용은 각 문서를 참조하세요:
- [ARCHITECTURE.md](ARCHITECTURE.md) — 전체 아키텍처
- [DATABASE.md](DATABASE.md) — DB 스키마 및 RLS
- [API.md](API.md) — 기능별 API 목록
- [COMPONENT_STRUCTURE.md](COMPONENT_STRUCTURE.md) — 컴포넌트 구조
- [PRD.md](PRD.md) — 제품 요구사항
- [PROJECT_RULES.md](PROJECT_RULES.md) — 프로젝트 규칙
- [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) — 개발 규칙
