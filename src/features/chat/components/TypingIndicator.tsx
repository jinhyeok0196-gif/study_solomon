import { cn } from '@/lib/utils';

interface Props {
  names: string[];
  className?: string;
}

export function TypingIndicator({ names, className }: Props) {
  if (!names.length) return null;
  const label =
    names.length === 1
      ? `${names[0]}님이 입력 중입니다...`
      : `${names.join(', ')}님이 입력 중입니다...`;

  return (
    <div className={cn('flex items-center gap-2 px-4 py-1', className)}>
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}
