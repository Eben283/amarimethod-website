
import React from 'react';
import { QuizProvider } from '@/contexts/QuizContext';
import QuizContainer from '@/components/QuizContainer';

const Index = () => {
  return (
    <QuizProvider>
      <QuizContainer />
    </QuizProvider>
  );
};

export default Index;
