import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG,
  SEVERITY_CONFIG,
  STATUS_LABEL,
  SEAT_IDS,
  confidencePercent,
  type AIDecisionRow,
  type AIDecisionFilters,
  type Activity,
  type Severity,
  type DecisionStatus,
} from '../types';

interface Props {
  rows: AIDecisionRow[];
  filters: AIDecisionFilters;
  onFiltersChange: (next: AIDecisionFilters) => void;
  onOpen: (row: AIDecisionRow) => void;
}

const ACTIVITIES: Activity[] = ['STUDYING', 'PHONE', 'SLEEPING', 'ABSENT', 'UNKNOWN'];
const SEVERITIES: Severity[] = ['INFO', 'WATCH', 'WARNING', 'CRITICAL'];
const STATUSES: DecisionStatus[] = ['SUCCESS', 'SKIPPED', 'FAILED', 'LOW_CONFIDENCE'];
const LIMITS = [20, 50, 100];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** 최근 AI 판정 로그 테이블(읽기 전용 — 수정/삭제/상태반영 버튼 없음). */
export function AIDecisionLogTable({ rows, filters, onFiltersChange, onOpen }: Props) {
  const set = (patch: Partial<AIDecisionFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-2">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label="좌석 필터"
          className="rounded border border-gray-200 px-2 py-1"
          value={filters.seatId ?? ''}
          onChange={(e) => set({ seatId: e.target.value || undefined })}
        >
          <option value="">전체 좌석</option>
          {SEAT_IDS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          aria-label="활동 필터"
          className="rounded border border-gray-200 px-2 py-1"
          value={filters.activity ?? ''}
          onChange={(e) => set({ activity: (e.target.value || undefined) as Activity | undefined })}
        >
          <option value="">전체 활동</option>
          {ACTIVITIES.map((a) => <option key={a} value={a}>{ACTIVITY_CONFIG[a].label}</option>)}
        </select>
        <select
          aria-label="심각도 필터"
          className="rounded border border-gray-200 px-2 py-1"
          value={filters.severity ?? ''}
          onChange={(e) => set({ severity: (e.target.value || undefined) as Severity | undefined })}
        >
          <option value="">전체 심각도</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_CONFIG[s].label}</option>)}
        </select>
        <select
          aria-label="상태 필터"
          className="rounded border border-gray-200 px-2 py-1"
          value={filters.status ?? ''}
          onChange={(e) => set({ status: (e.target.value || undefined) as DecisionStatus | undefined })}
        >
          <option value="">전체 상태</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select
          aria-label="개수 필터"
          className="rounded border border-gray-200 px-2 py-1"
          value={filters.limit ?? 50}
          onChange={(e) => set({ limit: Number(e.target.value) })}
        >
          {LIMITS.map((n) => <option key={n} value={n}>최근 {n}개</option>)}
        </select>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">시간</th>
              <th className="px-2 py-1.5 font-medium">좌석</th>
              <th className="px-2 py-1.5 font-medium">교시</th>
              <th className="px-2 py-1.5 font-medium">활동</th>
              <th className="px-2 py-1.5 font-medium">신뢰</th>
              <th className="px-2 py-1.5 font-medium">심각도</th>
              <th className="px-2 py-1.5 font-medium">상태</th>
              <th className="px-2 py-1.5 font-medium">근거</th>
              <th className="px-2 py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-6 text-center text-gray-400">
                  표시할 AI 판정이 없습니다
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const cfg = ACTIVITY_CONFIG[row.activity];
                const sev = SEVERITY_CONFIG[row.severity];
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{fmtTime(row.decided_at)}</td>
                    <td className="px-2 py-1.5 font-medium text-gray-700">{row.seat_id}</td>
                    <td className="px-2 py-1.5 text-gray-500">{row.period_name ?? '-'}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 font-medium', cfg.badgeClass)}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-gray-700">{confidencePercent(row.confidence)}%</td>
                    <td className="px-2 py-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 font-medium', sev.badgeClass)}>
                        {sev.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">{STATUS_LABEL[row.status]}</td>
                    <td className="max-w-[200px] truncate px-2 py-1.5 text-gray-500">
                      {row.reasons?.[0] ?? '-'}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onOpen(row)}
                        className="rounded-md px-2 py-0.5 font-medium text-brand-600 hover:bg-brand-50"
                      >
                        상세
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
