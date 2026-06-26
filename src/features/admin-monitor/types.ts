export interface SeatLayout {
  id: string;
  seatNumber: number;
  displayName: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  isActive: boolean;
  sortOrder: number;
}

export type SeatStatus =
  | 'empty'        // 빈 좌석 (학생 미배정)
  | 'not_arrived'  // 미등원 (학생 배정됨, 당일 출결 없음)
  | 'inactive'     // 비활성 회원
  | 'studying'     // 공부중
  | 'outing'       // 외출중
  | 'power_nap'    // 파워냅
  | 'late'         // 지각
  | 'absent';      // 결석

export interface SeatStatusConfig {
  cardClass: string;
  dotClass: string;
  label: string;
  emoji: string;
  textClass: string;
}

export const SEAT_STATUS_CONFIG: Record<SeatStatus, SeatStatusConfig> = {
  empty: {
    cardClass: 'bg-gray-50 border-gray-100',
    dotClass: 'bg-gray-200',
    label: '빈 좌석',
    emoji: '⚪',
    textClass: 'text-gray-300',
  },
  not_arrived: {
    cardClass: 'bg-slate-50 border-slate-200',
    dotClass: 'bg-slate-300',
    label: '미등원',
    emoji: '⚫',
    textClass: 'text-slate-500',
  },
  inactive: {
    cardClass: 'bg-gray-100 border-gray-200',
    dotClass: 'bg-gray-400',
    label: '비활성',
    emoji: '⚫',
    textClass: 'text-gray-500',
  },
  studying: {
    cardClass: 'bg-green-50 border-green-300',
    dotClass: 'bg-green-500 animate-pulse',
    label: '공부중',
    emoji: '🟢',
    textClass: 'text-green-700',
  },
  outing: {
    cardClass: 'bg-orange-50 border-orange-300',
    dotClass: 'bg-orange-500 animate-pulse',
    label: '외출중',
    emoji: '🚻',
    textClass: 'text-orange-700',
  },
  power_nap: {
    cardClass: 'bg-purple-50 border-purple-300',
    dotClass: 'bg-purple-500 animate-pulse',
    label: '파워냅',
    emoji: '😴',
    textClass: 'text-purple-700',
  },
  late: {
    cardClass: 'bg-red-50 border-red-300',
    dotClass: 'bg-red-500 animate-pulse',
    label: '지각',
    emoji: '🔴',
    textClass: 'text-red-700',
  },
  absent: {
    cardClass: 'bg-gray-100 border-gray-300',
    dotClass: 'bg-gray-500',
    label: '결석',
    emoji: '⚫',
    textClass: 'text-gray-600',
  },
};

export interface MonitorStudentRow {
  id: string;
  seatNumber: number;
  studentName: string;
  membershipStatus: string;
  currentPenaltyPoints: number;
  warningCount: number;
  ongoingOuting?: {
    id: string;
    startedAt: string;
  };
  ongoingPowerNap?: {
    id: string;
    startedAt: string;
    plannedEndAt: string;
  };
  todayAttendances: Array<{ periodNumber: number; status: string }>;
}

export interface SeatData {
  seat: SeatLayout;
  student: MonitorStudentRow | null;
  status: SeatStatus;
}

export type EventType =
  | 'outing_start'
  | 'outing_end'
  | 'nap_start'
  | 'nap_end'
  | 'penalty'
  | 'attendance';

export interface EventLogEntry {
  id: string;
  time: string;
  studentName: string;
  type: EventType;
  label: string;
  detail?: string;
}

export const EVENT_EMOJI: Record<EventType, string> = {
  outing_start: '🚻',
  outing_end:   '✅',
  nap_start:    '😴',
  nap_end:      '✅',
  penalty:      '⚠️',
  attendance:   '📋',
};
