import React from 'react';

type ProgressBarProps = {
  currentStep: number;
  totalSteps: number;
};

/**
 * Thin ink rail under the fixed topbar.
 * Progress = currentStep / totalSteps (questions 0–11 + contact as final step).
 */
const ProgressBar = ({ currentStep, totalSteps }: ProgressBarProps) => {
  const progress = Math.min((currentStep / Math.max(totalSteps - 1, 1)) * 100, 100);
  const right = `${100 - progress}%`;

  return (
    <div className="rail" aria-hidden="true">
      <div className="rail-fill" style={{ right }} />
    </div>
  );
};

export default ProgressBar;
