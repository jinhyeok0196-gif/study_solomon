interface Props {
  date: string;
}

export function ChatDateDivider({ date }: Props) {
  const d = new Date(date);
  const label = d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
  return (
    <div className="flex items-center gap-3 my-3 px-3">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-xs text-gray-400 whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}
