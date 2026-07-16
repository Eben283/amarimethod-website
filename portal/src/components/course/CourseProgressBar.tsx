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
  const barHeight = size === 'sm' ? 2 : 2;

  return (
    <div className="w-full">
      {showLabel && (
        <div className="lp-progress-row">
          <span>
            {completed} of {total} complete
          </span>
          <strong>{percent}%</strong>
        </div>
      )}
      <div
        className="lp-bar"
        style={{ height: barHeight }}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
