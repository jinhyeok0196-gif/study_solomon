import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCreateManualPenaltyMutation } from '../hooks';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface Props {
  studentId: string;
  className?: string;
}

const POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 1~10점 버튼 + 선택 사유로 벌점을 즉시 부여한다. */
export function QuickPenaltyGrant({ studentId, className }: Props) {
  const { user } = useAuth();
  const adminId = user!.id;
  const mutation = useCreateManualPenaltyMutation();
  const [reason, setReason] = useState('');
  const [granted, setGranted] = useState<number | null>(null);

  const grant = (points: number) => {
    if (mutation.isPending) return;
    mutation.mutate(
      { studentId, points, description: reason.trim() || undefined, createdBy: adminId },
      {
        onSuccess: () => {
          setGranted(points);
          setReason('');
        },
      }
    );
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">벌점 부여</span>
        {granted != null && <span className="text-xs font-medium text-red-600">+{granted}점 부여됨</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {POINTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={mutation.isPending}
            onClick={() => grant(p)}
            className="h-7 w-7 rounded-md border border-red-300 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
      <Input
        value={reason}
        maxLength={100}
        placeholder="벌점 사유 (선택)"
        onChange={(e) => setReason(e.target.value)}
        className="text-xs"
      />
    </div>
  );
}
