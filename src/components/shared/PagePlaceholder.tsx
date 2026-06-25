interface PagePlaceholderProps {
  title: string;
  description?: string;
  stage: string;
}

export function PagePlaceholder({ title, description, stage }: PagePlaceholderProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      {description && <p className="text-sm text-gray-500">{description}</p>}
      <span className="mt-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">
        {stage}
      </span>
    </div>
  );
}
