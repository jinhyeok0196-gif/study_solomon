import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { OTHER_REASON } from '@/constants/reasons';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  reasons: readonly string[];
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** 사유(미리 정의된 목록 + '기타' 직접 입력)를 고르고 확인하는 공용 모달. */
export function ReasonSelectModal({
  open,
  title,
  reasons,
  confirmLabel = '시작',
  isPending = false,
  onConfirm,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');

  // 모달이 열릴 때마다 선택 상태 초기화
  useEffect(() => {
    if (open) {
      setSelected(null);
      setOtherText('');
    }
  }, [open]);

  const isOther = selected === OTHER_REASON;
  const finalReason = isOther ? otherText.trim() : selected ?? '';
  const canConfirm = finalReason.length > 0 && !isPending;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {[...reasons, OTHER_REASON].map((reason) => {
            const active = selected === reason;
            return (
              <button
                key={reason}
                type="button"
                onClick={() => setSelected(reason)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm',
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-brand-300'
                )}
              >
                {reason}
              </button>
            );
          })}
        </div>

        {isOther && (
          <Input
            autoFocus
            placeholder="사유를 입력해주세요"
            value={otherText}
            maxLength={100}
            onChange={(e) => setOtherText(e.target.value)}
          />
        )}

        <Button className="w-full" disabled={!canConfirm} onClick={() => onConfirm(finalReason)}>
          {isPending ? '처리 중...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
