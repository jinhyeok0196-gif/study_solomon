export type PeriodNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface PeriodDefinition {
  period: PeriodNumber;
  label: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

// 실제 운영 교시 시간은 2단계에서 system_settings 테이블로 이전하며,
// 아래 값은 DB 연동 전 화면 미리보기를 위한 기본값입니다.
export const DEFAULT_PERIODS: PeriodDefinition[] = [
  { period: 1, label: '1교시', startTime: '09:00', endTime: '10:20' },
  { period: 2, label: '2교시', startTime: '10:30', endTime: '11:50' },
  { period: 3, label: '3교시', startTime: '12:00', endTime: '13:20' },
  { period: 4, label: '4교시', startTime: '13:30', endTime: '14:50' },
  { period: 5, label: '5교시', startTime: '15:00', endTime: '16:20' },
  { period: 6, label: '6교시', startTime: '16:30', endTime: '17:50' },
  { period: 7, label: '7교시', startTime: '18:00', endTime: '19:20' },
  { period: 8, label: '8교시', startTime: '19:30', endTime: '20:50' },
];

export const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const DAY_OF_WEEK_LABEL: Record<DayOfWeek, string> = {
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
  sat: '토',
  sun: '일',
};
