import { useState, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import { useAssignableStudentsQuery, useSeatAssignMutations } from '../hooks';

interface Props {
  open: boolean;
  seatNumber: number | null;
  seatLabel: string;
  onClose: () => void;
}

export function SeatAssignModal({ open, seatNumber, seatLabel, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: students, isLoading } = useAssignableStudentsQuery(open);
  const { assign } = useSeatAssignMutations();

  const filtered = useMemo(() => {
    const list = students ?? [];
    const keyword = search.trim();
    if (!keyword) return list;
    return list.filter((s) => s.name.includes(keyword));
  }, [students, search]);

  const handleClose = () => {
    setSearch('');
    setSelectedId(null);
    onClose();
  };

  const handleAssign = async () => {
    if (!selectedId || seatNumber == null) return;
    await assign.mutateAsync({ studentId: selectedId, seatNumber });
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`${seatLabel} 좌석에 학생 배정`}>
      <div className="flex flex-col gap-3">
        <Input
          placeholder="학생 이름 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="max-h-64 overflow-y-auto rounded-md border border-gray-100">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">학생이 없습니다</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {filtered.map((student) => {
                const isSelected = selectedId === student.id;
                return (
                  <li key={student.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(student.id)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                        isSelected ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50'
                      )}
                    >
                      <span className="font-medium">{student.name}</span>
                      {student.seatNumber != null && (
                        <span className="text-xs text-gray-400">
                          현재 {student.seatNumber}번 → 이동
                        </span>
                      )}
                      {isSelected && <span className="text-brand-500">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={handleClose}>
            취소
          </Button>
          <Button
            className="flex-1"
            disabled={!selectedId || assign.isPending}
            onClick={handleAssign}
          >
            배정
          </Button>
        </div>
      </div>
    </Modal>
  );
}
