
import React from 'react';

type ProgressBarProps = {
  currentStep: number;
  totalSteps: number;
};

const ProgressBar = ({ currentStep, totalSteps }: ProgressBarProps) => {
  const progress = Math.min((currentStep / (totalSteps - 1)) * 100, 100);

  return (
    <div className="w-full mb-8">
      <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden shadow-sm">
        <div
          className="h-full bg-gradient-to-r from-amari-pine-teal to-amari-forest-green transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <div className="mt-2 text-sm text-center text-gray-600 font-sans flex items-center justify-center gap-2">
        <span>Step {currentStep + 1} of {totalSteps}</span>
        <span className="text-amari-pine-teal font-medium">• {Math.round(progress)}% complete</span>
      </div>
    </div>
  );
};

export default ProgressBar;
