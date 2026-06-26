# API — 기능별 API 함수 목록

모든 API는 Supabase JS 클라이언트(`src/lib/supabase/client.ts`)를 통해 호출됩니다.
각 도메인의 `features/{domain}/api.ts`에 순수 함수로 정의하고,
`features/{domain}/hooks.ts`에서 TanStack Query로 래핑합니다.

---

## 인증 (`features/auth/api.ts`)

| 함수 | 설명 |
|---|---|
| `signInWithPhone(phone, password)` | 전화번호+비밀번호 로그인 (이메일 변환 후 Supabase Auth) |
| `signOutCurrentUser()` | 로그아웃 |
| `signInWithGoogle()` | 구글 OAuth 로그인 (redirect to `/auth/callback`) |
| `createStudentProfile(userId, name, phone)` | 구글 로그인 후 학생 프로필 등록 (`register_student` RPC) |
| `fetchUserProfile(userId)` | `users` 테이블에서 프로필 조회 |

**전화번호 → 이메일 변환** (`features/auth/phone.ts`)
```
010-1234-5678  →  0101234567@solomonstudy.app
```
Supabase Auth는 이메일 기반이므로 전화번호를 고유 이메일로 변환합니다.

---

## 출결 (`features/attendance/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAttendanceRecords(studentId)` | 학생의 전체 출석 기록 (교시 시간 JOIN) |

**통계 계산** (`features/attendance/stats.ts`)
- `computeAttendanceStats(allRecords, monthRecords)`: 전체/이번달 출석률, 지각, 결석 횟수

---

## 관리자 출결 (`features/admin-attendance/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAttendanceForDate(date)` | 특정 날짜 전체 학생 출결 현황 |
| `upsertAttendanceRecord(studentId, date, periodNumber, status)` | 출석 상태 수동 등록/변경 |

---

## 시간표 (`features/schedule/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchCurrentWeekSchedule(studentId, weekStartDate)` | 현재 주 시간표 조회 |
| `fetchScheduleHistory(studentId)` | 시간표 이력 전체 조회 |
| `saveScheduleDraft(studentId, weekStartDate, items)` | 임시저장 (draft) |
| `submitSchedule(weeklyScheduleId)` | 시간표 제출 (submitted) |

---

## 관리자 시간표 (`features/admin-schedule/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAllStudentSchedules(weekStartDate)` | 특정 주 전체 학생 시간표 조회 |
| `updateStudentScheduleItem(...)` | 관리자가 학생 시간표 항목 수정 |

---

## 신청 (`features/requests/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchStudentRequests(studentId, kind)` | 학생의 결석/조퇴 신청 목록 |
| `createAbsenceRequest(studentId, date, periodNumbers, reason)` | 결석 신청 |
| `createLeaveRequest(studentId, date, periodNumbers, reason)` | 조퇴 신청 |

---

## 관리자 신청 처리 (`features/admin-requests/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchPendingRequests()` | 대기 중인 전체 신청 목록 |
| `approveRequest(requestId, kind)` | 신청 승인 (`approve_request_log` RPC) |
| `rejectRequest(requestId, kind, note)` | 신청 반려 (`reject_request_log` RPC) |

---

## 외출 (`features/outing/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchOngoingOuting(studentId)` | 현재 진행 중인 외출 조회 |
| `fetchRecentOutings(studentId, limit?)` | 최근 외출 이력 |
| `startOuting(studentId)` | 외출 시작 (`bathroom_logs` INSERT) |
| `endOuting(outingId)` | 외출 복귀 (`status = 'completed'` UPDATE) |

---

## 파워냅 (`features/powernap/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchTodayNap(studentId)` | 오늘 파워냅 기록 조회 |
| `startNap(studentId, maxMinutes)` | 파워냅 시작 (planned_end_at 자동 계산) |
| `endNap(napId)` | 파워냅 종료 |

---

## 벌점 (`features/penalty/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchPenaltyProfile(studentId)` | 현재 벌점·경고 수 조회 |
| `fetchPenaltyRecords(studentId)` | 벌점 이력 |
| `fetchWarningRecords(studentId)` | 경고 이력 |

**리스크 계산** (`features/penalty/risk.ts`)
- `computeRiskLevel(points)`: `'safe' | 'caution' | 'danger' | 'critical'` 반환

---

## 관리자 벌점 (`features/admin-penalty/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAllPenaltyRecords()` | 전체 학생 벌점 이력 |
| `addPenaltyPoints(studentId, reasonCode, points, description, createdBy)` | 벌점 부여 |
| `subtractPenaltyPoints(studentId, points, description, createdBy)` | 벌점 차감 |

---

## 관리자 경고 (`features/admin-warning/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAllWarningRecords()` | 전체 경고 이력 |
| `issueWarning(studentId, level, issuedBy, note)` | 수동 경고 부여 |

---

## 학생 관리 (`features/admin-students/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAllStudents()` | 전체 학생 목록 |
| `fetchStudentDetail(studentId)` | 학생 상세 정보 |
| `createStudent(data)` | 관리자가 학생 계정 직접 생성 |
| `updateStudent(studentId, data)` | 학생 정보 수정 |

---

## 알림 (`features/notifications/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchAdminNotifications()` | 관리자 알림 목록 (최근 100건) |
| `markNotificationRead(notificationId)` | 읽음 처리 |

---

## 대시보드 (`features/admin-dashboard/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchDashboardSummary()` | 오늘 현황 집계 (착석·외출·파워냅·결석·지각·총학생 수) |

---

## 채팅 (`features/chat/api.ts`)

| 함수 | 설명 |
|---|---|
| `getOrCreateChatRoom(studentId)` | 채팅방 ID 조회/생성 (`get_or_create_chat_room` RPC) |
| `fetchChatMessages(roomId)` | 메시지 목록 (최근 100건, 오름차순) |
| `sendChatMessage(roomId, senderId, senderRole, content, messageType?)` | 메시지 전송 |
| `markRoomMessagesRead(roomId, readerId, senderRole)` | 상대방 메시지 읽음 처리 |
| `fetchChatRoomsWithMeta(adminId)` | 전체 채팅방 목록 + 최근 메시지 + 미읽음 수 |
| `fetchQuickReplies()` | 빠른 답변 목록 |
| `createQuickReply(content)` | 빠른 답변 추가 |
| `deleteQuickReply(id)` | 빠른 답변 삭제 |

---

## 채팅 학생 패널 (`features/chat/studentPanelApi.ts`)

| 함수 | 설명 |
|---|---|
| `fetchTodayBathroomLogs(studentId)` | 오늘 외출 기록 |
| `fetchTodayAttendance(studentId)` | 오늘 출석 현황 |
| `fetchStudentRecentRequests(studentId, limit?)` | 최근 신청 내역 |
| `fetchStudentWeekScheduleCells(studentId, weekStartDate)` | 이번 주 시간표 셀 |
| `addManualWarning(studentId, issuedBy, note)` | 경고 수동 부여 |
| `fetchTodayAbsenceLeaveRequests(studentId)` | 오늘 결석/조퇴 신청 |

---

## 마이페이지 (`features/mypage/api.ts`)

| 함수 | 설명 |
|---|---|
| `fetchMyProfile(userId)` | 학생 본인 프로필 조회 |
| `updateMyProfile(userId, data)` | 프로필 수정 (이름, 학교, 학년 등) |
| `changePassword(newPassword)` | 비밀번호 변경 |

---

## Realtime 훅

| 훅 | 위치 | 설명 |
|---|---|---|
| `useRealtimeTableSync(table, queryKeys)` | `hooks/useRealtimeTableSync.ts` | 테이블 변경 시 쿼리 무효화 |
| `useChatRealtime(options)` | `features/chat/useChatRealtime.ts` | 채팅 메시지 실시간 구독 |
| `useChatPresence(userId, role, name)` | `features/chat/usePresence.ts` | 온라인 상태 + 입력 중 표시 |

---

## 공통 패턴

### 에러 처리
```typescript
const { data, error } = await supabase.from('table').select('*');
if (error) throw error;
```
에러는 상위 TanStack Query `onError`에서 처리합니다.

### 이미지 메시지
```
content = '__IMG__:https://[project].supabase.co/storage/v1/object/public/chat-images/...'
```
`ChatBubble` 컴포넌트가 접두사를 감지하여 `<img>` 태그로 렌더링합니다.

### RPC 호출
```typescript
const { data, error } = await supabase.rpc('function_name', { param: value });
```
SECURITY DEFINER 함수는 RLS를 우회하여 실행됩니다.
