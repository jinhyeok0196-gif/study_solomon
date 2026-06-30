import { cn } from '@/lib/utils';
import {
  ACTIVITY_CONFIG,
  SEVERITY_CONFIG,
  STATUS_LABEL,
  confidencePercent,
  type AIDecisionRow,
} from '../types';

interface Props {
  row: AIDecisionRow | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="break-all text-sm text-gray-800">{value}</span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <pre className="max-h-48 overflow-auto rounded-md bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-700">
        <code>{JSON.stringify(value ?? null, null, 2)}</code>
      </pre>
    </div>
  );
}

/** AI 판정 상세 보기 Drawer(읽기 전용 — 값 수정 불가). */
export function AIDecisionDetailDrawer({ row, onClose }: Props) {
  if (!row) return null;
  const cfg = ACTIVITY_CONFIG[row.activity];
  const sev = SEVERITY_CONFIG[row.severity];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 배경 */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

      {/* Drawer */}
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', cfg.badgeClass)}>
              {cfg.emoji} {cfg.label}
            </span>
            <span className="text-xs text-gray-400">{row.seat_id}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            AI 추정 결과입니다. 학생 상태·출결·벌점은 자동 변경되지 않습니다.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="activity" value={`${cfg.label} (${row.activity})`} />
            <Field label="confidence" value={`${confidencePercent(row.confidence)}%`} />
            <Field label="status" value={STATUS_LABEL[row.status]} />
            <Field label="severity" value={<span className={cn('rounded px-1.5 py-0.5', sev.badgeClass)}>{sev.label}</span>} />
            <Field label="seat_id" value={row.seat_id} />
            <Field label="period" value={row.period_name ?? row.period_id ?? '-'} />
            <Field label="decided_at" value={new Date(row.decided_at).toLocaleString('ko-KR')} />
            <Field label="created_at" value={new Date(row.created_at).toLocaleString('ko-KR')} />
            <Field label="decision_uuid" value={row.decision_uuid} />
            <Field label="facts_uuid" value={row.facts_uuid ?? '-'} />
            <Field label="burst_uuid" value={row.burst_uuid ?? '-'} />
          </div>

          {/* reasons */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">reasons</span>
            {row.reasons?.length ? (
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {row.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            ) : (
              <span className="text-sm text-gray-400">-</span>
            )}
          </div>

          {/* JSON 보기(읽기 전용) */}
          <JsonBlock label="evidence" value={row.evidence} />
          <JsonBlock label="rule_hits" value={row.rule_hits} />
          <JsonBlock label="quality" value={row.quality} />
          <JsonBlock label="metadata" value={row.metadata} />
        </div>
      </aside>
    </div>
  );
}
