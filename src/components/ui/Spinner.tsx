import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600',
        className
      )}
      role="status"
      aria-label="로딩 중"
    />
  );
}
