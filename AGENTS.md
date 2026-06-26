# AGENTS.md — 솔로몬스터디카페 AI 개발 가이드

> 이 파일은 모든 AI 에이전트(Claude Code 등)가 이 프로젝트를 작업할 때 반드시 따라야 하는 기준입니다.
> 새로운 기능 구현 전에 이 문서를 먼저 읽고, 기존 코드베이스를 직접 확인한 뒤 작업을 시작합니다.

---

## 1. 프로젝트 목표

솔로몬스터디카페의 운영 업무를 디지털화하는 웹 애플리케이션입니다.

- **학생 포털**: 시간표 제출, 출결 확인, 외출·파워냅 신고, 벌점 조회, 관리자 문의 채팅
- **관리자 포털**: 학생 관리, 출결·벌점·경고 처리, 신청 승인, 실시간 현황 모니터링, 1:1 채팅
- **핵심 가치**: 실시간성(Supabase Realtime), 보안(RLS), 모바일 우선(학생), 데스크톱(관리자)

---

## 2. 개발 원칙

### 작업 전
1. **반드시 관련 코드를 직접 읽는다.** `Read` 도구로 파일을 열어 현재 상태를 확인한다. 기억에 의존하지 않는다.
2. **기존 컴포넌트를 먼저 찾는다.** `Button`, `Card`, `Modal`, `Badge`, `Input`, `FormField`, `Spinner`, `EmptyState` 등 `src/components/ui/`에 있는 컴포넌트를 재사용한다.
3. **DB 변경이 필요하면 Migration을 먼저 작성한다.** 파일명: `supabase/migrations/YYYYMMDD_설명.sql`

### 작업 중
4. **오류를 임시로 숨기지 않는다.** `@ts-ignore`, `eslint-disable`, `as any` 캐스팅으로 회피하지 말고 근본 원인을 해결한다.
5. **폴링을 사용하지 않는다.** `setInterval`, `refetchInterval`로 주기적으로 조회하지 않는다. 실시간 데이터는 Supabase Realtime으로 처리한다.
6. **아키텍처를 유지한다.** 기존 패턴에서 벗어나는 구조를 새로 도입하지 않는다.

### 작업 후
7. **Build → Type Check → Lint → Commit → Push** 순서로 완료한다.
8. **Cloudflare Pages 자동배포 완료를 확인한다.** Push 후 배포 상태를 체크한다.
9. **새 기능 추가 시 README.md와 PRD.md를 함께 수정한다.**

---

## 3. 코드 스타일

### 언어
- 코드(변수명·함수명·파일명): **영어**
- UI 텍스트·주석·커밋 메시지: **한국어 허용**
- 사용자에게 노출되는 에러 메시지: **반드시 한국어**

### TypeScript
```typescript
// ❌ any 사용 금지
const data = response as any;

// ✅ 정확한 타입 사용
const data = response as ChatMessage[];

// ❌ 옵셔널 체이닝 남용으로 타입 가드 회피
const id = user?.id ?? '';

// ✅ ProtectedRoute 하위에서는 단언 사용
const id = user!.id;
```

### 네이밍
| 대상 | 규칙 | 예시 |
|---|---|---|
| 컴포넌트 파일 | PascalCase | `StudentStatusPanel.tsx` |
| 훅 파일 | camelCase, `use` 접두사 | `useChatRealtime.ts` |
| API/유틸 파일 | camelCase | `api.ts`, `utils.ts` |
| 상수 변수 | SCREAMING_SNAKE_CASE | `PENALTY_POINTS`, `WARNING_THRESHOLDS` |
| 일반 변수·함수 | camelCase | `studentId`, `fetchMessages` |

### 주석
- 주석은 **WHY가 비명백할 때만** 작성한다. 코드가 하는 일을 설명하는 주석은 쓰지 않는다.
- 멀티라인 주석 블록 금지. 한 줄 이내로 작성한다.

### Tailwind CSS
- 별도 CSS 파일 생성 금지. Tailwind 유틸리티 클래스만 사용한다.
- 조건부 클래스는 `cn()` (`src/lib/utils.ts`) 을 사용한다.
- 브랜드 색상: `brand-{50..900}` (파란색 계열)

---

## 4. 폴더 구조

```
src/
├── components/
│   ├── layout/          # AdminLayout, AdminSidebar, StudentLayout, StudentBottomNav, Header
│   ├── schedule/        # CurrentPeriodCard, LiveClock, ScheduleTimeline, StudentStatusBadge
│   ├── shared/          # ProtectedRoute, RoleGuard, NotFoundPage, ConfigurationErrorPage
│   └── ui/              # Button, Card, Modal, Badge, Input, FormField, Spinner, EmptyState
├── constants/           # penaltyRules.ts, periods.ts (변경이 드문 상수)
├── context/             # AuthContext.tsx (전역 인증 상태)
├── features/            # 도메인별 캡슐화
│   └── {domain}/
│       ├── api.ts       # Supabase 호출 순수 함수
│       ├── hooks.ts     # TanStack Query 래퍼
│       ├── types.ts     # 도메인 타입 (필요 시)
│       ├── schema.ts    # Zod 스키마 (필요 시)
│       └── components/  # 해당 도메인 전용 컴포넌트
├── hooks/               # 여러 도메인에서 공유하는 커스텀 훅
├── lib/
│   ├── supabase/
│   │   ├── client.ts    # Supabase 싱글턴 클라이언트
│   │   └── database.types.ts  # 자동 생성 타입 (npm run db:types)
│   ├── queryClient.ts   # TanStack QueryClient 설정
│   ├── time.ts          # 시간 포맷 유틸
│   └── utils.ts         # cn() 등 공통 유틸
├── pages/
│   ├── admin/           # 관리자 페이지 (데스크톱 기준)
│   ├── auth/            # 인증 페이지 (Callback, Register)
│   └── student/         # 학생 페이지 (모바일 기준)
├── routes/
│   ├── AppRouter.tsx    # 전체 라우터
│   └── paths.ts         # STUDENT_PATHS, ADMIN_PATHS 상수
└── types/
    └── domain.ts        # AuthenticatedUser, UserRole 전역 타입
```

### 위치 결정 기준
- 특정 도메인에서만 쓰이는 컴포넌트 → `features/{domain}/components/`
- 여러 도메인에서 쓰이는 컴포넌트 → `components/ui/` 또는 `components/shared/`
- 여러 도메인에서 쓰이는 훅 → `hooks/`
- 특정 도메인에서만 쓰이는 훅 → `features/{domain}/hooks.ts` 또는 별도 파일

---

## 5. Supabase 사용 규칙

### 클라이언트
```typescript
// 항상 싱글턴 클라이언트를 import한다.
import { supabase } from '@/lib/supabase/client';

// 새 클라이언트 직접 생성 금지
// ❌ createClient(url, key) — 절대 하지 않는다.
```

### 쿼리 패턴
```typescript
// SELECT
const { data, error } = await supabase
  .from('table_name')
  .select('col1, col2, related(col)')
  .eq('student_id', studentId)
  .order('created_at', { ascending: false })
  .limit(100);
if (error) throw error;
return data ?? [];

// INSERT
const { data, error } = await supabase
  .from('table_name')
  .insert({ col1: val1 })
  .select()
  .single();
if (error) throw error;

// UPDATE
const { error } = await supabase
  .from('table_name')
  .update({ status: 'completed' })
  .eq('id', id);
if (error) throw error;

// UPSERT
await supabase
  .from('message_reads')
  .upsert(rows, { onConflict: 'message_id,reader_id', ignoreDuplicates: true });

// RPC (SECURITY DEFINER 함수)
const { data, error } = await supabase.rpc('function_name', { p_param: value });
if (error) throw error;
```

### 에러 처리
```typescript
// ❌ 에러 무시
const { data } = await supabase.from('...').select('*');

// ✅ 항상 error 체크 후 throw
const { data, error } = await supabase.from('...').select('*');
if (error) throw error;
```

### Storage (이미지 업로드)
```typescript
// 버킷: chat-images (5MB, image/* 제한)
const path = `${roomId}/${Date.now()}_${file.name}`;
const { error } = await supabase.storage.from('chat-images').upload(path, file);
if (error) throw new Error('이미지 업로드에 실패했습니다.');
const { data: urlData } = supabase.storage.from('chat-images').getPublicUrl(path);
// 메시지 내용: `__IMG__:${urlData.publicUrl}`
```

### 환경 변수 안전 처리
```typescript
// 환경변수가 없어도 빌드가 깨지지 않도록 placeholder 사용 (client.ts 참고)
const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
```

---

## 6. Realtime 구현 규칙

### 핵심 원칙
- **폴링 금지**: `setInterval`, `refetchInterval`로 주기적 조회 불가
- **WebSocket 인증**: `supabase.realtime.setAuth(accessToken)` — `client.ts`의 `onAuthStateChange`에서 자동 처리됨. 추가 설정 불필요
- **채널 정리**: 컴포넌트 언마운트 시 반드시 `supabase.removeChannel(channel)` 호출

### 패턴 1 — 일반 테이블 동기화 (`useRealtimeTableSync`)
```typescript
// 페이지에서 단순히 테이블 변경 시 쿼리 무효화할 때
useRealtimeTableSync('bathroom_logs', [['admin-dashboard-summary']]);
useRealtimeTableSync('attendance_records', [['admin-attendance-by-date', date]]);
```

### 패턴 2 — 채팅 메시지 (`useChatRealtime`)
```typescript
// postgres_changes로 TanStack Query 캐시 직접 수정 (invalidate보다 빠름)
useChatRealtime({
  roomId,
  currentUserId: userId,
  currentRole: 'student',
  onNewMessage: (msg) => showBrowserNotification('새 메시지', msg.content),
});
```

### 패턴 3 — 온라인 상태 / 입력 중 (`useChatPresence`)
```typescript
const { onlineUsers, connectionStatus, sendTyping, stopTyping, getTypingUsersInRoom } =
  useChatPresence(userId, 'student', userName);
```

### 새 테이블에 Realtime 추가 시 체크리스트
```sql
-- Migration에 반드시 포함
ALTER TABLE public.new_table REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.new_table;
```

### 채널 구독 패턴 (직접 작성 시)
```typescript
useEffect(() => {
  const channel = supabase
    .channel(`unique-channel-name-${someId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'my_table' }, (payload) => {
      // 캐시 직접 수정 또는 invalidate
    })
    .subscribe((status) => {
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        // 자동 재시도 로직 (useChatRealtime 참고)
      }
    });

  return () => { supabase.removeChannel(channel); };
}, [deps]);
```

---

## 7. TanStack Query 사용 규칙

### Query 훅 작성 (`features/{domain}/hooks.ts`)
```typescript
export function useXxxQuery(param: string) {
  return useQuery({
    queryKey: ['xxx', param],          // 파라미터를 키에 포함
    queryFn: () => fetchXxx(param),
    enabled: !!param,                  // falsy 값이면 실행 안 함
    staleTime: 1000 * 60 * 5,         // 5분 캐시 (Realtime 없는 경우)
    // staleTime: Infinity,            // Realtime으로 캐시 관리 시
  });
}
```

### Mutation 훅 작성
```typescript
export function useXxxMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: XxxInput) => createXxx(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['xxx'] });
    },
    onError: () => {
      // 사용자에게 한국어 에러 표시
    },
  });
}
```

### Optimistic Update (채팅 메시지 등)
```typescript
onMutate: async (input) => {
  await qc.cancelQueries({ queryKey: ['chat-messages', roomId] });
  const previous = qc.getQueryData<ChatMessage[]>(['chat-messages', roomId]);
  qc.setQueryData<ChatMessage[]>(['chat-messages', roomId], (old) => [
    ...(old ?? []),
    { id: `pending-${Date.now()}`, ...input, _isPending: true },
  ]);
  return { previous };
},
onError: (_err, _vars, context) => {
  qc.setQueryData(['chat-messages', roomId], context?.previous);
},
```

### queryKey 컨벤션
```typescript
['admin-students']                     // 전체 목록
['admin-student-detail', studentId]    // 단일 리소스
['admin-dashboard-summary']            // 집계/요약
['chat-messages', roomId]              // 도메인 + 식별자
['system-setting', key]                // 설정
```

### 금지 사항
```typescript
// ❌ refetchInterval로 폴링
useQuery({ queryKey: ['...'], queryFn: fn, refetchInterval: 3000 });

// ❌ useEffect 내에서 직접 fetch
useEffect(() => { fetch('/api/data').then(setData); }, []);

// ✅ TanStack Query로 처리
const { data } = useXxxQuery(param);
```

---

## 8. RLS 작성 규칙

### 헬퍼 함수 (변경하지 않음)
```sql
public.is_admin()          -- role = 'admin' 확인 (SECURITY DEFINER)
public.current_user_role() -- 현재 사용자 role 반환
auth.uid()                 -- 현재 로그인 사용자 UUID
```

### 정책 원칙
```
관리자(is_admin()) → 전체 접근
학생               → 본인 데이터만 (student_id = auth.uid() 또는 id = auth.uid())
```

### 신규 테이블 RLS 체크리스트
```sql
-- 1. RLS 활성화
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- 2. SELECT 정책
CREATE POLICY "new_table_select_self_or_admin" ON public.new_table
  FOR SELECT USING (student_id = auth.uid() OR public.is_admin());

-- 3. INSERT 정책
CREATE POLICY "new_table_insert_self" ON public.new_table
  FOR INSERT WITH CHECK (student_id = auth.uid());

-- 4. UPDATE/DELETE는 필요한 경우에만 추가
CREATE POLICY "new_table_update_admin" ON public.new_table
  FOR UPDATE USING (public.is_admin());
```

### SECURITY DEFINER 함수 사용 시점
RLS가 막는 작업을 안전하게 우회해야 할 때 (예: 학생 자가 등록, 채팅방 생성):
```sql
CREATE OR REPLACE FUNCTION public.my_function(p_param text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public  -- 반드시 포함 (search_path 고정)
AS $$
BEGIN
  -- RLS를 우회하여 실행
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_function TO authenticated;
```

### 주의사항
- `SECURITY DEFINER` 함수는 최소 권한 원칙을 준수한다. 필요한 작업만 수행한다.
- `SET search_path = public`을 반드시 포함한다 (보안 취약점 방지).
- 정책은 가능한 단순하게 유지한다. 복잡한 서브쿼리는 성능 저하를 유발한다.

---

## 9. 컴포넌트 작성 규칙

### 페이지 컴포넌트 구조
```typescript
export default function XxxPage() {
  // 1. Auth 훅
  const { user } = useAuth();

  // 2. 서버 상태 훅
  const { data, isLoading } = useXxxQuery(user!.id);

  // 3. 뮤테이션 훅
  const mutation = useXxxMutation();

  // 4. 로컬 UI 상태 (최소화)
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 5. 파생 상태·계산
  const filtered = useMemo(() => (data ?? []).filter(...), [data]);

  // 6. 핸들러
  const handleSubmit = async () => { ... };

  // 7. 로딩/에러 상태
  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!data?.length) return <EmptyState title="..." />;

  // 8. 렌더링
  return <div>...</div>;
}
```

### 재사용 컴포넌트
```typescript
interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;       // 선택 속성은 기본값 명시
}

export function XxxComponent({ value, onChange, disabled = false }: Props) {
  return <div>...</div>;
}
```

### 기존 UI 컴포넌트 사용법
```typescript
import { Button } from '@/components/ui/Button';       // variant: primary|secondary|danger|ghost
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';          // open, onClose, title, children
import { Badge } from '@/components/ui/Badge';          // tone: default|success|warning|danger
import { Input } from '@/components/ui/Input';          // forwardRef, 모든 input 속성 지원
import { FormField } from '@/components/ui/FormField';  // label, htmlFor, error, children
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState'; // title, description?
```

### 폼 작성 패턴
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

// schema.ts에 별도 정의
const schema = z.object({ reason: z.string().min(1, '사유를 입력해주세요.') });
type FormValues = z.infer<typeof schema>;

function MyForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FormField label="사유" htmlFor="reason" error={errors.reason?.message}>
        <Input id="reason" {...register('reason')} />
      </FormField>
      <Button type="submit">제출</Button>
    </form>
  );
}
```

### 금지 패턴
```typescript
// ❌ inline style 사용 (Tailwind 사용)
<div style={{ color: 'red' }}>

// ❌ 절대 경로 없이 깊은 상대 경로
import { Button } from '../../../components/ui/Button';

// ✅ 절대 경로
import { Button } from '@/components/ui/Button';
```

---

## 10. 커밋 규칙

### 메시지 형식
```
<type>: <한국어 또는 영어 설명>

예시:
feat: 학생 이용권 현황 페이지 추가
fix: 채팅 Realtime WebSocket 인증 토큰 누락 수정
refactor: useChatRealtime 재시도 로직 분리
chore: package.json 의존성 업데이트
docs: AGENTS.md 작성
migration: 이용권 테이블 추가
```

### 타입 정의
| 타입 | 용도 |
|---|---|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 (기능 변경 없음) |
| `chore` | 빌드·설정·의존성 변경 |
| `docs` | 문서 변경 |
| `test` | 테스트 추가/수정 |
| `migration` | DB 마이그레이션 추가 |

### 규칙
- 커밋 단위: 논리적으로 하나의 변경사항
- 마이그레이션과 코드 변경은 같은 커밋에 묶어도 됨
- 작업 완료 후 반드시 `git push origin main`까지 수행

---

## 11. 배포 규칙

### 배포 환경
- **플랫폼**: Cloudflare Pages
- **빌드 명령**: `npm run build` (`tsc --noEmit && vite build`)
- **출력 디렉토리**: `dist/`
- **트리거**: `main` 브랜치 push 시 자동 빌드·배포

### 환경 변수 (Cloudflare Pages 대시보드에 등록)
| 변수명 | 용도 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |

### 배포 확인 절차
1. `git push origin main`
2. Cloudflare Pages 대시보드에서 빌드 로그 확인
3. 배포 완료 후 프로덕션 URL에서 주요 기능 동작 확인
4. Supabase 관련 기능(로그인, 실시간 채팅)이 작동하는지 확인

### Push 전 로컬 검증
```bash
npm run build        # 빌드 성공 여부
npm run type-check   # TypeScript 오류 없음
# lint 도구 미설정 시 type-check로 대체
```

---

## 12. 문서 관리 규칙

### 수정 대상 파일
| 파일 | 수정 시점 |
|---|---|
| `README.md` | 새 기능 추가, 설치/실행 방법 변경 시 |
| `PRD.md` | 기능 요구사항 추가·변경 시 |
| `AGENTS.md` | 개발 규칙·패턴 변경 시 |
| `DATABASE.md` | DB 스키마·RLS 변경 시 |
| `API.md` | API 함수 추가·변경 시 |
| `COMPONENT_STRUCTURE.md` | 컴포넌트 구조 변경 시 |
| `ARCHITECTURE.md` | 아키텍처 패턴 변경 시 |
| `DEVELOPMENT_RULES.md` | 개발 규칙 변경 시 |

### 원칙
- 문서는 **코드와 함께** 커밋한다. 별도 커밋으로 미루지 않는다.
- AI가 읽을 것을 고려해 **명확하고 구체적으로** 작성한다.
- 추상적인 설명보다 **실제 코드 예시**를 포함한다.

---

## 13. 성능 최적화 원칙

### TanStack Query 캐시 전략
```typescript
// 자주 바뀌지 않는 데이터 (교시 정보, 시스템 설정)
staleTime: 1000 * 60 * 60  // 1시간

// 일반 서버 상태
staleTime: 1000 * 30        // 30초 (queryClient 기본값)

// Realtime으로 관리하는 데이터 (채팅 메시지)
staleTime: Infinity         // 만료 없음, Realtime이 직접 캐시 수정
```

### Realtime vs invalidate 선택
- **캐시 직접 수정** (`qc.setQueryData`): 채팅 메시지처럼 새 행을 추가만 하는 경우 → 네트워크 요청 없음
- **캐시 무효화** (`qc.invalidateQueries`): 집계·목록처럼 전체를 다시 가져와야 하는 경우

### 불필요한 렌더링 방지
```typescript
// 리스트 아이템이 많은 경우 useMemo로 필터링 메모화
const filtered = useMemo(
  () => (students ?? []).filter((s) => s.name.includes(search)),
  [students, search]
);

// 콜백은 useCallback (자식 컴포넌트에 props로 내려줄 때)
const handleClick = useCallback(() => { ... }, [deps]);
```

### 번들 크기
- 동적 import 고려 (현재 단일 번들 ~200KB gzipped)
- 라이브러리 추가 시 번들 영향도 확인

---

## 14. 향후 AI(CCTV) 연동 원칙

### 설계 방향 (미구현, 향후 계획)
스터디카페 좌석 CCTV 영상을 AI로 분석하여 학생의 실제 학습 상태를 감지합니다.

### 테이블 설계 (계획)
```sql
-- 기존 activity_logs와 분리된 별도 테이블로 추가
CREATE TABLE public.ai_activity_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid        NOT NULL REFERENCES student_profiles(id),
  seat_id         text,                             -- 좌석 식별자
  captured_at     timestamptz NOT NULL,
  status          text        NOT NULL,             -- 'seated' | 'studying' | 'phone_use' | 'drowsy' | 'away'
  confidence      numeric(4,3),                     -- 0.000 ~ 1.000
  raw_meta        jsonb,                            -- 모델 원본 출력
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 구현 원칙
1. **기존 출결 시스템과 분리**: AI 감지 결과는 보조 정보로만 사용. 공식 출결은 기존 `attendance_records` 기준
2. **벌점 자동 부여는 신중하게**: AI 오판 가능성이 있으므로, 초기에는 관리자 확인 후 벌점 부여
3. **RLS 동일 적용**: 학생은 본인 데이터만, 관리자는 전체 접근
4. **Realtime 연동**: `ai_activity_logs` 테이블을 `supabase_realtime` publication에 추가하여 관리자 대시보드에 실시간 반영
5. **프라이버시 고려**: CCTV 원본 영상은 서버에 저장하지 않음. 분석 결과(status, confidence)만 DB에 저장
6. **기존 컴포넌트 재사용**: 관리자 대시보드에 새 카드를 추가하는 방식으로 통합. 별도 페이지 최소화

---

## 빠른 참조 — 현재 구현된 라우트

### 학생 (`StudentLayout` 하위)
```
/                       → DashboardPage
/schedule               → SchedulePage (주간 시간표)
/schedule/history       → ScheduleHistoryPage
/attendance             → AttendancePage
/absence-requests/new   → AbsenceRequestPage
/leave-requests/new     → LeaveRequestPage
/outing                 → OutingPage
/power-nap              → PowerNapPage
/penalty                → PenaltyPage
/mypage                 → MyPage
/chat                   → ChatPage (학생 1:1 채팅)
```

### 관리자 (`AdminLayout` 하위, `/admin` 접두사)
```
/admin                  → DashboardPage
/admin/students         → StudentsPage
/admin/students/:id     → StudentDetailPage
/admin/schedules        → SchedulesPage
/admin/attendance       → AttendancePage
/admin/penalties        → PenaltiesPage
/admin/warnings         → WarningsPage
/admin/notifications    → NotificationsPage
/admin/requests         → RequestsPage (이름변경/전화번호변경/탈퇴/시간표수정 신청)
/admin/chat             → ChatPage (3패널: 학생목록 + 채팅 + 학생상태패널)
```

### 인증 (레이아웃 없음)
```
/login                  → StudentLoginPage
/admin/login            → AdminLoginPage
/auth/callback          → CallbackPage (Google OAuth)
/auth/register          → RegisterPage (신규 학생 등록)
```

## 빠른 참조 — 현재 DB 테이블

```
users               student_profiles    periods
system_settings     weekly_schedules    schedule_items
attendance_records  absence_requests    leave_requests
bathroom_logs       power_nap_logs      penalty_records
warning_records     notifications       activity_logs
request_logs        chat_rooms          chat_messages
message_reads       quick_replies
```

## 빠른 참조 — 핵심 커스텀 훅

| 훅 | 위치 | 용도 |
|---|---|---|
| `useAuth()` | `hooks/useAuth.ts` | 인증 상태 (user, login, logout) |
| `usePeriods()` | `hooks/usePeriods.ts` | 교시 목록 (1시간 캐시) |
| `useScheduleStatus(periods, now)` | `hooks/useScheduleStatus.ts` | 현재/다음 교시 계산 |
| `useCurrentTime(ms)` | `hooks/useCurrentTime.ts` | 실시간 현재 시각 |
| `useSystemSetting(key, fallback)` | `hooks/useSystemSetting.ts` | system_settings 조회 |
| `useRealtimeTableSync(table, keys)` | `hooks/useRealtimeTableSync.ts` | 테이블 변경 → 캐시 무효화 |
| `useChatRealtime(options)` | `features/chat/useChatRealtime.ts` | 채팅 postgres_changes 구독 |
| `useChatPresence(userId, role, name)` | `features/chat/usePresence.ts` | 온라인/입력중 상태 |
