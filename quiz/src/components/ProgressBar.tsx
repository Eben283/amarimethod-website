
import React from 'react';

type ProgressBarProps = {
  currentStep: number;
  totalSteps: number;
};

const ProgressBar = ({ currentStep, totalSteps }: ProgressBarProps) => {
  const progress = Math.min((currentStep / (totalSteps - 1)) * 100, 100);
  const pct = Math.round(progress);

  return (
    <div className="w-full mb-8 px-1">
      {/* Bar row */}
      <div className="flex items-center gap-3 mb-2.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-amari-text-light font-sans flex-shrink-0">
          Start
        </span>

        <div className="flex-1 relative h-1.5 bg-amari-oat rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%`, backgroundColor: '#252525' }}
          />
        </div>

        <span className="text-xs font-semibold tabular-nums text-amari-charcoal font-sans flex-shrink-0 w-8 text-right">
          {pct}%
        </span>

        <span className="text-xs font-semibold uppercase tracking-widest text-amari-text-light font-sans flex-shrink-0">
          Finish
        </span>
      </div>

      {/* Step dots row */}
      <div className="flex items-center justify-between px-[2.75rem]">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const isPast    = i < currentStep;
          const isCurrent = i === currentStep;
          const isFuture  = i > currentStep;
          return (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width:           isCurrent ? '8px' : '5px',
                height:          isCurrent ? '8px' : '5px',
                backgroundColor: isFuture  ? '#D9CFBF' : '#5E8C8A', // oat : pine-teal
                opacity:         isPast    ? 0.55 : 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ProgressBar;
