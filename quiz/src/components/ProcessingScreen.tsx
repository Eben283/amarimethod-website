import React, { useEffect, useState } from 'react';

const ProcessingScreen = () => {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    'Analyzing your pain pattern...',
    'Evaluating movement compensations...',
    'Calculating your scores...',
    'Generating personalized insights...',
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < steps.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 600);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-[500px] flex items-center justify-center">
      <div className="max-w-2xl w-full px-6">
        <div className="bg-white rounded-xl shadow-lg p-8 md:p-10">
          {/* Simple spinner */}
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 border-4 border-amari-oat border-t-amari-pine-teal rounded-full animate-spin"></div>
          </div>

          {/* Main heading */}
          <h2 className="text-2xl md:text-3xl font-serif text-amari-charcoal text-center mb-6">
            Analyzing Your Results
          </h2>

          {/* Simple progress text */}
          <div className="text-center">
            <p className="text-base md:text-lg font-sans text-amari-text-light">
              {steps[currentStep]}
            </p>
          </div>

          {/* Bottom message */}
          <div className="mt-8 text-center">
            <p className="text-sm text-amari-text-light font-sans">
              This will only take a moment...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProcessingScreen;
