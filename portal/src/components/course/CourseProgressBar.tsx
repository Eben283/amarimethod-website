interface CourseProgressBarProps {
  readonly completed: number;
  readonly total: number;
  readonly size?: 'sm' | 'md';
  readonly showLabel?: boolean;
}

export default function CourseProgressBar({
  completed,
  total,
  size = 'md',
  showLabel = true,
}: CourseProgressBarProps) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const barHeight = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-amari-text-muted font-sans">
            {completed} of {total} complete
          </span>
          <span className="text-xs font-semibold text-amari-charcoal font-sans">
            {percent}%
          </span>
        </div>
      )}
      <div className={`w-full ${barHeight} bg-amari-light-sand rounded-full overflow-hidden`}>
        <div
          className={`${barHeight} bg-amari-accent-warm rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
