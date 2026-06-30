import { cn } from '@/lib/utils';
import { confidencePercent } from '../types';
import { STABILIZED_STATUS_LABEL, type StabilizedCandidate } from '../stabilizedTypes';
import { getCandidateLabel, getCandidateBadgeClass } from '../stabilizer';

interface Props {
  candidate: StabilizedCandidate | null;
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

/** 안정화 후보 상세 Drawer(읽기 전용). 자동 변경 아님 문구 필수. */
export function StabilizedCandidateDetail({ candidate, onClose }: Props) {
  if (!candidate) return null;
  const isStable = candidate.status === 'STABLE';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-gray-400">안정화된 추정</span>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', getCandidateBadgeClass(candidate))}>
              {getCandidateLabel(candidate)}
            </span>
            <span className="text-xs text-gray-400">{candidate.seat_id}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label="닫기">✕</button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            안정화된 AI 추정 후보입니다. 학생 상태, 출결, 벌점은 자동 변경되지 않습니다.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="status" value={STABILIZED_STATUS_LABEL[candidate.status]} />
            <Field label="confidence" value={isStable ? `${confidencePercent(candidate.confidence)}%` : '-'} />
            <Field label="activity" value={isStable ? candidate.activity : 'UNKNOWN(보류)'} />
            <Field label="severity" value={candidate.severity} />
            <Field label="decision_count" value={`${candidate.decision_count} / ${candidate.window_size}`} />
            <Field label="seat_id" value={candidate.seat_id} />
            <Field label="decided_from" value={candidate.decided_from ? new Date(candidate.decided_from).toLocaleString('ko-KR') : '-'} />
            <Field label="decided_to" value={candidate.decided_to ? new Date(candidate.decided_to).toLocaleString('ko-KR') : '-'} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">reasons</span>
            {candidate.reasons?.length ? (
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {candidate.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            ) : <span className="text-sm text-gray-400">-</span>}
          </div>

          <JsonBlock label="activity_counts" value={candidate.activity_counts} />
          <JsonBlock label="confidence_by_activity" value={candidate.confidence_by_activity} />
          <JsonBlock label="evidence" value={candidate.evidence} />
          <JsonBlock label="source_decision_uuids" value={candidate.source_decision_uuids} />
          <JsonBlock label="metadata" value={candidate.metadata} />
        </div>
      </aside>
    </div>
  );
}
