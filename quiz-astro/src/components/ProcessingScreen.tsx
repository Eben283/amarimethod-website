import React, { useEffect, useState } from 'react';

const STEPS = [
  'Mapping where your pain lives…',
  'Tracing the chain behind it…',
  "Weighing what you've already tried…",
  'Estimating your recovery potential…',
];

const ProcessingScreen = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [fade, setFade] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(0);
      setTimeout(() => {
        setCurrentStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
        setFade(1);
      }, 200);
    }, 800);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="screen proc">
      <div className="ring" aria-hidden="true" />
      <h2>Reading your pattern</h2>
      <p className="step" style={{ opacity: fade }}>
        {STEPS[currentStep]}
      </p>
    </section>
  );
};

export default ProcessingScreen;
