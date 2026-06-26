import { useMemo } from 'react';
import type { PeriodRow } from '@/hooks/usePeriods';

export interface ScheduleSlot {
  id: string;
  type: 'period' | 'break';
  label: string;
  startMinutes: number;
  endMinutes: number;
  crossesMidnight: boolean;
  category: 'class' | 'meal' | 'arrival' | 'free' | 'break';
  displayColor: string;
  durationMinutes: number | null;
  periodNumber?: number;
}

export interface ScheduleSlotStatus extends ScheduleSlot {
  status: 'past' | 'current' | 'upcoming';
}

export interface ScheduleStatus {
  currentSlot: ScheduleSlot | null;
  nextSlot: ScheduleSlot | null;
  remainingMinutes: number;
  remainingSeconds: number;
  upcomingClassAlert: { minutesBefore: number; slot: ScheduleSlot } | null;
  timeline: ScheduleSlotStatus[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function isCurrentSlot(slot: ScheduleSlot, nowMinutes: number): boolean {
  if (slot.crossesMidnight) {
    return nowMinutes >= slot.startMinutes || nowMinutes < slot.endMinutes;
  }
  return nowMinutes >= slot.startMinutes && nowMinutes < slot.endMinutes;
}

function isPastSlot(slot: ScheduleSlot, nowMinutes: number): boolean {
  if (slot.crossesMidnight) {
    return false;
  }
  return nowMinutes >= slot.endMinutes;
}

export function useScheduleStatus(periods: PeriodRow[] | undefined, now: Date): ScheduleStatus {
  const sorted = useMemo(
    () => (periods ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [periods]
  );

  return useMemo(() => {
    if (sorted.length === 0) {
      return {
        currentSlot: null,
        nextSlot: null,
        remainingMinutes: 0,
        remainingSeconds: 0,
        upcomingClassAlert: null,
        timeline: [],
      };
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const nowSeconds = nowMinutes * 60 + now.getSeconds();

    const slots: ScheduleSlot[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const startMin = timeToMinutes(p.start_time);
      const endMin = timeToMinutes(p.end_time);
      const crossesMidnight = endMin < startMin;

      if (i > 0) {
        const prevEnd = timeToMinutes(sorted[i - 1].end_time);
        if (startMin > prevEnd) {
          slots.push({
            id: `break-${i}`,
            type: 'break',
            label: '쉬는시간',
            startMinutes: prevEnd,
            endMinutes: startMin,
            crossesMidnight: false,
            category: 'break',
            displayColor: '#d1d5db',
            durationMinutes: startMin - prevEnd,
          });
        }
      }

      slots.push({
        id: `period-${p.period_number}`,
        type: 'period',
        label: p.display_name,
        startMinutes: startMin,
        endMinutes: endMin,
        crossesMidnight,
        category: p.category,
        displayColor: p.display_color,
        durationMinutes: p.duration_minutes,
        periodNumber: p.period_number,
      });
    }

    let currentSlot: ScheduleSlot | null = null;
    let nextSlot: ScheduleSlot | null = null;

    for (let i = 0; i < slots.length; i++) {
      if (isCurrentSlot(slots[i], nowMinutes)) {
        currentSlot = slots[i];
        nextSlot = slots[i + 1] ?? null;
        break;
      }
    }

    let remainingMinutes = 0;
    let remainingSeconds = 0;
    if (currentSlot) {
      const endTotalSeconds =
        currentSlot.crossesMidnight && nowMinutes >= 12 * 60
          ? (currentSlot.endMinutes + 1440) * 60
          : currentSlot.endMinutes * 60;
      const diffSeconds = Math.max(0, endTotalSeconds - nowSeconds);
      remainingSeconds = diffSeconds;
      remainingMinutes = Math.ceil(diffSeconds / 60);
    }

    const upcomingClasses = slots.filter(
      (s) =>
        s.type === 'period' &&
        s.category === 'class' &&
        !isCurrentSlot(s, nowMinutes) &&
        !isPastSlot(s, nowMinutes)
    );
    let upcomingClassAlert: ScheduleStatus['upcomingClassAlert'] = null;
    if (upcomingClasses.length > 0) {
      const next = upcomingClasses[0];
      const minutesBefore = next.startMinutes - nowMinutes;
      if (minutesBefore > 0 && minutesBefore <= 10) {
        upcomingClassAlert = { minutesBefore, slot: next };
      }
    }

    const timeline: ScheduleSlotStatus[] = slots.map((slot) => ({
      ...slot,
      status: isCurrentSlot(slot, nowMinutes)
        ? 'current'
        : isPastSlot(slot, nowMinutes)
        ? 'past'
        : 'upcoming',
    }));

    return { currentSlot, nextSlot, remainingMinutes, remainingSeconds, upcomingClassAlert, timeline };
  }, [sorted, now]);
}
