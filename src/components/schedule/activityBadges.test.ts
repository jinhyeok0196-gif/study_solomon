import { describe, expect, it } from 'vitest';
import { periodActivityBadges } from './activityBadges';
import { withRo } from '@/lib/korean';

const at = (h: number, m: number) => new Date(2026, 5, 1, h, m).getTime();
const iso = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();

describe('withRo', () => {
  it('받침 없음/ㄹ 받침 → 로', () => {
    expect(withRo('전화')).toBe('전화로'); // 받침 없음
    expect(withRo('화장실')).toBe('화장실로'); // ㄹ 받침
    expect(withRo('업무')).toBe('업무로');
  });
  it('그 외 받침 → 으로', () => {
    expect(withRo('병원')).toBe('병원으로'); // ㄴ
    expect(withRo('졸음')).toBe('졸음으로'); // ㅁ
    expect(withRo('컨디션 회복')).toBe('컨디션 회복으로'); // ㄱ
  });
});

describe('periodActivityBadges', () => {
  // 교시 10:00~11:00
  const slotStart = at(10, 0);
  const slotEnd = at(11, 0);

  it('교시와 겹친 외출만, 겹친 분으로 표시', () => {
    const outings = [{ startedAt: iso(10, 10), endedAt: iso(10, 25), reason: '화장실' }];
    const badges = periodActivityBadges(slotStart, slotEnd, outings, [], at(12, 0));
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({ kind: 'outing', label: '외출(화장실로 15분)', ongoing: false });
  });

  it('교시 밖 외출은 제외', () => {
    const outings = [{ startedAt: iso(9, 0), endedAt: iso(9, 30), reason: '전화' }];
    expect(periodActivityBadges(slotStart, slotEnd, outings, [], at(12, 0))).toHaveLength(0);
  });

  it('교시 경계로 겹친 부분만 계산', () => {
    // 9:50~10:20 중 교시(10:00~)와 겹친 20분
    const naps = [{ startedAt: iso(9, 50), endedAt: iso(10, 20), reason: '졸음' }];
    const badges = periodActivityBadges(slotStart, slotEnd, [], naps, at(12, 0));
    expect(badges[0]).toMatchObject({ kind: 'nap', label: '파워냅(졸음으로 20분)' });
  });

  it('진행 중(미종료)이면 현재까지 경과분·진행중 표시', () => {
    const outings = [{ startedAt: iso(10, 10), endedAt: null, reason: '병원' }];
    // 현재 10:25 → 15분 경과
    const badges = periodActivityBadges(slotStart, slotEnd, outings, [], at(10, 25));
    expect(badges[0]).toMatchObject({ ongoing: true, label: '외출(병원으로 15분·진행중)' });
  });

  it('사유 없으면 사유 생략', () => {
    const outings = [{ startedAt: iso(10, 0), endedAt: iso(10, 10), reason: null }];
    expect(periodActivityBadges(slotStart, slotEnd, outings, [], at(12, 0))[0].label).toBe('외출(10분)');
  });
});
