import React, { useEffect } from 'react';
import { QuizProvider, useQuiz } from '@/contexts/QuizContext';
import QuizContainer from './QuizContainer';
import { Toaster } from './ui/toaster';

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
  return (
    <QuizProvider>
      <QuizBootstrap />
      <Toaster />
    </QuizProvider>
  );
}
