import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePeriods } from '@/hooks/usePeriods';
import { useWeeklyScheduleQuery } from '@/features/schedule/hooks';
import { weekStartDateOf, dayOfWeekKeyOf, getWeekStartDate } from '@/features/schedule/dates';
import { useCreateRequestMutation } from '../hooks';
import { requestFormSchema, type RequestFormValues } from '../schema';
import type { RequestKind } from '../types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/ui/FormField';
import { cn } from '@/lib/utils';

interface RequestFormProps {
  kind: RequestKind;
  studentId: string;
  onSubmitted?: () => void;
}

export function RequestForm({ kind, studentId, onSubmitted }: RequestFormProps) {
  const { data: periods } = usePeriods();
  const mutation = useCreateRequestMutation(kind, studentId);

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: { requestDate: '', periodNumbers: [], reason: '' },
  });

  // 선택한 날짜의 시간표에서 '신청한(체크한) 교시'만 선택 가능하게 한다.
  const requestDate = watch('requestDate');
  const weekStart = requestDate ? weekStartDateOf(requestDate) : getWeekStartDate(0);
  const { data: weekSchedule } = useWeeklyScheduleQuery(studentId, weekStart);
  const signedUpPeriods = useMemo(() => {
    if (!requestDate) return new Set<number>();
    const day = dayOfWeekKeyOf(requestDate);
    return new Set<number>(
      (weekSchedule?.cells ?? []).filter((c) => c.dayOfWeek === day).map((c) => c.periodNumber)
    );
  }, [requestDate, weekSchedule]);

  // 날짜를 바꾸면, 그 날짜에 신청하지 않은 교시 선택은 자동으로 해제한다.
  useEffect(() => {
    const current = getValues('periodNumbers') ?? [];
    const pruned = current.filter((n) => signedUpPeriods.has(n));
    if (pruned.length !== current.length) setValue('periodNumbers', pruned);
  }, [signedUpPeriods, getValues, setValue]);

  const onSubmit = async (values: RequestFormValues) => {
    await mutation.mutateAsync(values);
    reset({ requestDate: '', periodNumbers: [], reason: '' });
    onSubmitted?.();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField label="날짜" htmlFor="requestDate" error={errors.requestDate?.message}>
        <Input id="requestDate" type="date" {...register('requestDate')} />
      </FormField>

      <Controller
        control={control}
        name="periodNumbers"
        render={({ field }) => (
          <FormField label="교시" htmlFor="periodNumbers" error={errors.periodNumbers?.message}>
            {!requestDate ? (
              <p className="text-sm text-gray-400">날짜를 먼저 선택하세요.</p>
            ) : signedUpPeriods.size === 0 ? (
              <p className="text-sm text-gray-400">이 날짜에 시간표로 신청한 교시가 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(periods ?? [])
                  .filter((period) => period.is_selectable && signedUpPeriods.has(period.period_number))
                  .map((period) => {
                    const isChecked = field.value.includes(period.period_number);
                    return (
                      <button
                        key={period.period_number}
                        type="button"
                        onClick={() =>
                          field.onChange(
                            isChecked
                              ? field.value.filter((value) => value !== period.period_number)
                              : [...field.value, period.period_number]
                          )
                        }
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-sm',
                          isChecked
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-gray-300 bg-white text-gray-700'
                        )}
                      >
                        {period.label}
                      </button>
                    );
                  })}
              </div>
            )}
          </FormField>
        )}
      />

      <FormField label="사유" htmlFor="reason" error={errors.reason?.message}>
        <textarea
          id="reason"
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          {...register('reason')}
        />
      </FormField>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? '제출 중...' : '제출'}
      </Button>
    </form>
  );
}
