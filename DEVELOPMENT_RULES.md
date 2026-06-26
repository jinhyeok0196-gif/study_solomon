# DEVELOPMENT_RULES — 개발 규칙

코딩 스타일, 파일 구성, 패턴 가이드입니다.
`PROJECT_RULES.md`의 "무엇을 해야 하는가"에 대응하는 "어떻게 해야 하는가"를 다룹니다.

---

## 1. 파일 및 폴더 규칙

### 새 도메인 추가 시 파일 구조
```
src/features/{domain}/
├── api.ts       # Supabase 호출 순수 함수
├── hooks.ts     # TanStack Query 래퍼 (useXxx 형태)
├── types.ts     # 필요 시 도메인 타입 정의
├── schema.ts    # 필요 시 Zod 스키마
└── components/  # 해당 도메인 전용 컴포넌트
```

### 새 페이지 추가 시 체크리스트
- [ ] `src/pages/student/` 또는 `src/pages/admin/`에 파일 생성
- [ ] `src/routes/paths.ts`에 경로 상수 추가
- [ ] `src/routes/AppRouter.tsx`에 `<Route>` 등록
- [ ] 학생 페이지면 `StudentBottomNav.tsx`에 탭 추가 고려

---

## 2. TanStack Query 패턴

### Query 훅 작성
```typescript
// features/{domain}/hooks.ts
export function useXxxQuery(param: string) {
  return useQuery({
    queryKey: ['xxx', param],        // 파라미터를 키에 포함
    queryFn: () => fetchXxx(param),
    enabled: !!param,                // param이 없으면 실행 안 함
    staleTime: 1000 * 60 * 5,       // 5분 (실시간 구독 없는 경우)
  });
}
```

### Mutation 훅 작성
```typescript
export function useXxxMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: XxxInput) => createXxx(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['xxx'] });
    },
  });
}
```

### Optimistic Update (채팅 메시지 등)
```typescript
onMutate: async (input) => {
  await qc.cancelQueries({ queryKey: ['xxx'] });
  const previous = qc.getQueryData<XxxItem[]>(['xxx']);
  qc.setQueryData<XxxItem[]>(['xxx'], (old) => [
    ...(old ?? []),
    { id: `pending-${Date.now()}`, ...input, _isPending: true },
  ]);
  return { previous };
},
onError: (_err, _vars, context) => {
  qc.setQueryData(['xxx'], context?.previous);
},
```

### queryKey 네이밍 컨벤션
```typescript
['chat-messages', roomId]          // 특정 리소스
['admin-chat-rooms']               // 전체 목록
['student-unread-count', roomId]   // 집계
['admin-dashboard-summary']        // 요약
```

---

## 3. Supabase 쿼리 패턴

### SELECT
```typescript
const { data, error } = await supabase
  .from('table_name')
  .select('col1, col2, related_table(col)')
  .eq('student_id', studentId)
  .order('created_at', { ascending: false })
  .limit(100);

if (error) throw error;
return data ?? [];
```

### INSERT
```typescript
const { data, error } = await supabase
  .from('table_name')
  .insert({ col1: val1, col2: val2 })
  .select()
  .single();

if (error) throw error;
return data;
```

### UPDATE
```typescript
const { error } = await supabase
  .from('table_name')
  .update({ status: 'completed', ended_at: new Date().toISOString() })
  .eq('id', id);

if (error) throw error;
```

### UPSERT (읽음 처리 등)
```typescript
await supabase
  .from('message_reads')
  .upsert(rows, { onConflict: 'message_id,reader_id', ignoreDuplicates: true });
```

### RPC 호출
```typescript
const { data, error } = await supabase.rpc('function_name', {
  p_param: value,
});
if (error) throw error;
```

---

## 4. Realtime 구독 패턴

### 단순 테이블 동기화 (재사용 훅)
```typescript
// 페이지 컴포넌트에서
useRealtimeTableSync('bathroom_logs', [['admin-dashboard-summary']]);
```

### 채팅 전용 (useChatRealtime)
```typescript
useChatRealtime({
  roomId,
  currentUserId: userId,
  currentRole: 'student',
  onNewMessage: (msg) => {
    showBrowserNotification('새 메시지', msg.content);
  },
});
```

### Presence (온라인 상태)
```typescript
const { onlineUsers, connectionStatus, sendTyping, stopTyping, getTypingUsersInRoom } =
  useChatPresence(userId, 'student', userName);
```

### 채널 정리 규칙
모든 `supabase.channel()` 호출은 반드시 `useEffect` 내에서 하고,
cleanup에서 `supabase.removeChannel(channel)`을 호출합니다.

```typescript
useEffect(() => {
  const channel = supabase.channel('name').on(...).subscribe();
  return () => { supabase.removeChannel(channel); };
}, [deps]);
```

---

## 5. 컴포넌트 작성 패턴

### 페이지 컴포넌트 구조
```typescript
export default function XxxPage() {
  // 1. 훅
  const { user } = useAuth();
  const { data, isLoading } = useXxxQuery(user!.id);

  // 2. 파생 상태
  const filteredItems = (data ?? []).filter(...);

  // 3. 핸들러
  const handleClick = () => { ... };

  // 4. 로딩/빈 상태 처리
  if (isLoading) return <Spinner />;
  if (!data?.length) return <EmptyState />;

  // 5. 렌더링
  return <div>...</div>;
}
```

### 재사용 컴포넌트 구조
```typescript
interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function XxxComponent({ value, onChange, disabled = false }: Props) {
  return <div>...</div>;
}
```

---

## 6. 타입 작성 규칙

### DB 타입 직접 사용
```typescript
import type { Tables } from '@/lib/supabase/database.types';

// DB 타입 그대로
type BathroomLog = Tables<'bathroom_logs'>;

// 필요한 컬럼만 선택
type BathroomLogStatus = Pick<Tables<'bathroom_logs'>, 'id' | 'status' | 'started_at'>;
```

### 도메인 타입 (camelCase 변환이 필요한 경우)
```typescript
// features/{domain}/types.ts
export interface AttendanceRecord {
  classDate: string;      // class_date → camelCase
  periodNumber: number;
  status: AttendanceStatus;
}
```

### Union 타입 활용
```typescript
export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'early_leave'
  | 'excused_absence'
  | 'excused_early_leave';
```

---

## 7. 폼 작성 패턴

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// schema.ts에 별도 정의 권장
const schema = z.object({
  reason: z.string().min(1, '사유를 입력해주세요.'),
});

type FormValues = z.infer<typeof schema>;

function XxxForm({ onSubmit }: { onSubmit: (v: FormValues) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FormField label="사유" error={errors.reason?.message} required>
        <Input {...register('reason')} />
      </FormField>
      <Button type="submit">제출</Button>
    </form>
  );
}
```

---

## 8. 날짜/시간 처리

- 저장: `timestamptz` (UTC ISO 8601)
- 표시: 한국 로컬 시간 변환
- 날짜 연산: `date-fns` 라이브러리 사용
- 현재 시간 실시간 갱신: `useCurrentTime(intervalMs)` 훅 사용

```typescript
import { format, isSameDay } from 'date-fns';

const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
const displayTime = format(new Date(isoString), 'HH:mm');
```

---

## 9. 에러 메시지 처리

```typescript
// ❌ 잘못된 예
throw error; // Supabase 영어 에러 그대로 노출

// ✅ 올바른 예
if (error) throw new Error('결석 신청 중 오류가 발생했습니다.');
```

---

## 10. cn() 유틸리티

조건부 클래스는 `cn()` 사용 (`src/lib/utils.ts` — clsx 래퍼):

```typescript
import { cn } from '@/lib/utils';

<div className={cn(
  'base-class',
  isActive && 'active-class',
  variant === 'danger' && 'danger-class',
)} />
```

---

## 11. 이미지 업로드 (채팅)

```typescript
// Supabase Storage에 업로드
const path = `${roomId}/${Date.now()}_${file.name}`;
await supabase.storage.from('chat-images').upload(path, file);
const { data: urlData } = supabase.storage.from('chat-images').getPublicUrl(path);

// 메시지 내용으로 전송
onSend(`__IMG__:${urlData.publicUrl}`);
```

---

## 12. 환경변수 안전 처리

```typescript
// ❌ 직접 사용 (빌드 시 undefined 시 앱 크래시)
const url = import.meta.env.VITE_SUPABASE_URL;

// ✅ 올바른 패턴 (client.ts 참고)
const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
export const isSupabaseConfigured = Boolean(url && url !== 'https://placeholder.supabase.co');
```

---

## 13. 금지 사항 요약

| 금지 | 이유 |
|---|---|
| `useEffect + fetch` 직접 데이터 페칭 | TanStack Query 사용 |
| `setInterval` 폴링 | Realtime 사용 |
| `console.log` 배포 코드에 남기기 | 프로덕션 노이즈 |
| 영어 에러 메시지 노출 | UX 원칙 |
| RLS 없는 테이블 생성 | 보안 |
| Supabase 클라이언트 직접 생성 | `src/lib/supabase/client.ts`의 싱글턴 사용 |
| `any` 타입 남용 | 타입 안전성 |
| 절대 경로 없이 상대 경로 깊이 중첩 | `@/` 절대 경로 사용 |
