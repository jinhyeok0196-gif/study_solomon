import { DAYS_OF_WEEK, DAY_OF_WEEK_LABEL, type DayOfWeek } from '@/constants/periods';
import { usePeriods } from '@/hooks/usePeriods';
import { cn } from '@/lib/utils';
import { cellKey } from '../types';

interface WeeklyScheduleGridProps {
  selected: ReadonlySet<string>;
  onToggle?: (dayOfWeek: DayOfWeek, periodNumber: number) => void;
  readOnly?: boolean;
}

export function WeeklyScheduleGrid({ selected, onToggle, readOnly = false }: WeeklyScheduleGridProps) {
  const { data: periods } = usePeriods();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-center text-sm">
        <thead>
          <tr>
            <th className="w-16 border-b border-gray-200 p-2 text-xs text-gray-500">교시</th>
            {DAYS_OF_WEEK.map((day) => (
              <th key={day} className="border-b border-gray-200 p-2 text-xs text-gray-500">
                {DAY_OF_WEEK_LABEL[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(periods ?? []).map((period) => (
            <tr key={period.period_number}>
              <td className="border-b border-gray-100 p-2 text-xs text-gray-500">
                {period.label}
              </td>
              {DAYS_OF_WEEK.map((day) => {
                const key = cellKey(day, period.period_number);
                const isSelected = selected.has(key);
                return (
                  <td key={key} className="border-b border-gray-100 p-1">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => onToggle?.(day, period.period_number)}
                      aria-pressed={isSelected}
                      className={cn(
                        'h-8 w-8 rounded-md border text-xs transition-colors',
                        isSelected
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-gray-200 bg-white text-transparent hover:border-brand-300',
                        readOnly && 'cursor-default hover:border-gray-200'
                      )}
                    >
                      {isSelected ? '✓' : '·'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
