import React, { useEffect, useRef } from 'react';
import { QuizProvider, useQuiz } from '@/contexts/QuizContext';
import QuizContainer from './QuizContainer';
import { Toaster } from './ui/toaster';
import { mountTurnstile } from '@/lib/turnstile';

/**
 * Bootstrap component — fires startQuiz() once on mount so the React island
 * skips the legacy WelcomeScreen state. Visitors arrive here from the
 * editorial cover at /quiz/, which is the new welcome screen.
 */
function QuizBootstrap() {
  const { hasStarted, startQuiz } = useQuiz();
  useEffect(() => {
    if (!hasStarted) startQuiz();
  }, [hasStarted, startQuiz]);
  return <QuizContainer />;
}

export default function QuizApp() {
  const turnstileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turnstileRef.current) {
      mountTurnstile(turnstileRef.current, import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '');
    }
  }, []);

  return (
    <QuizProvider>
      <QuizBootstrap />
      <Toaster />
      <div ref={turnstileRef} aria-hidden="true" />
    </QuizProvider>
  );
}
