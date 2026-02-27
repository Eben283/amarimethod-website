
import React from 'react';
import { useQuiz } from '@/contexts/QuizContext';
import ProgressBar from './ProgressBar';
import QuizStack, { QUIZ_QUESTIONS } from './QuizStack';
import ContactInfoForm from './questions/ContactInfoForm';
import ResultsPage from './results/ResultsPage';
import WelcomeScreen from './WelcomeScreen';
import ProcessingScreen from './ProcessingScreen';
import AmariLogo from './AmariLogo';
import QuizFooter from './QuizFooter';
import { Button } from './ui/button';
import { Loader2 } from 'lucide-react';

const QuizContainer = () => {
  const {
    currentStep,
    totalSteps,
    answers,
    firstName,
    lastName,
    email,
    phone,
    scores,
    patternSignature,
    insights,
    isSubmitting,
    isLoading,
    isProcessing,
    isCompleted,
    submissionError,
    validationError,
    goToNextStep,
    goToPrevStep,
    setAnswer,
    setFirstName,
    setLastName,
    setEmail,
    setPhone,
    retrySubmission,
    hasStarted,
    startQuiz,
  } = useQuiz();

  // Auto-skip Q10 (treatment results) if no treatments selected
  React.useEffect(() => {
    if (currentStep === 10) {
      const showTreatmentResults =
        answers[9]?.answer &&
        (answers[9].answer as string[]).length > 0 &&
        !(answers[9].answer as string[]).includes("I haven't tried any treatments");

      if (!showTreatmentResults) {
        const timer = setTimeout(() => goToNextStep(), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [currentStep, answers, goToNextStep]);

  // Keyboard: Enter to advance, number keys 1-9 for active single-select question
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (currentStep > 11) return; // contact form handles its own keys

      if (e.key === 'Enter') {
        const ans = answers[currentStep]?.answer;
        const hasAnswer = ans !== undefined && ans !== null && ans !== '';
        const isMulti = Array.isArray(ans);
        if (hasAnswer || isMulti) goToNextStep();
      }

      // Number keys 1-9 for single-select questions
      const q = QUIZ_QUESTIONS[currentStep];
      if (q?.type === 'single' && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < q.options.length) {
          setAnswer(currentStep, q.options[idx]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, answers, goToNextStep, setAnswer]);

  const renderLoadingState = () => (
    <div className="text-center py-12 flex flex-col items-center justify-center min-h-[300px]">
      <Loader2 className="h-12 w-12 text-amari-pine-teal animate-spin mb-4" />
      <h3 className="text-xl font-medium mb-2">Processing your results...</h3>
      <p className="text-gray-600">
        We're analyzing your responses to generate a personalized pain assessment.
      </p>
    </div>
  );

  const renderErrorState = () => (
    <div className="text-center py-12 flex flex-col items-center justify-center min-h-[300px] bg-red-50 border border-red-200 rounded-lg px-6">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <h3 className="text-xl font-medium mb-2 text-red-700">Submission Error</h3>
      <p className="text-red-600 mb-4">
        {submissionError || 'There was an error submitting your assessment. Please try again.'}
      </p>
      <Button
        onClick={retrySubmission}
        disabled={isSubmitting}
        className="bg-amari-pine-teal hover:bg-amari-pine-teal/90 text-white"
      >
        {isSubmitting ? (
          <span className="flex items-center">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Retrying...
          </span>
        ) : (
          'Try Again'
        )}
      </Button>
    </div>
  );

  const isNavVisible = hasStarted && !isProcessing && !isCompleted && !submissionError && !isLoading;

  return (
    <div className="min-h-screen bg-amari-bone-white">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <AmariLogo />

        {isProcessing ? (
          <ProcessingScreen />
        ) : !isCompleted ? (
          <div>
            {!hasStarted ? (
              <WelcomeScreen onStart={startQuiz} />
            ) : (
              <>
                <ProgressBar currentStep={currentStep} totalSteps={totalSteps} />

                {isLoading ? (
                  renderLoadingState()
                ) : submissionError ? (
                  renderErrorState()
                ) : currentStep === 12 ? (
                  /* ── Contact form (step 12) ── */
                  <>
                    <div className="flex items-center gap-2.5 mb-4">
                      <span className="text-xs font-semibold uppercase tracking-widest text-amari-charcoal bg-amari-charcoal bg-opacity-10 px-3 py-1 rounded-full font-sans">
                        Your Results
                      </span>
                    </div>
                    <div className="quiz-step-enter">
                      <ContactInfoForm
                        firstName={firstName}
                        lastName={lastName}
                        email={email}
                        phone={phone}
                        setFirstName={setFirstName}
                        setLastName={setLastName}
                        setEmail={setEmail}
                        setPhone={setPhone}
                      />
                    </div>
                  </>
                ) : (
                  /* ── Question stack (steps 0–11) ── */
                  <QuizStack
                    onNext={goToNextStep}
                    onPrev={goToPrevStep}
                    isSubmitting={isSubmitting}
                    validationError={validationError}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          <div>
            {scores && patternSignature && (
              <ResultsPage
                firstName={firstName}
                patternSignature={patternSignature}
                scores={scores}
                insights={insights}
              />
            )}
          </div>
        )}

        <QuizFooter />
      </div>
    </div>
  );
};

export default QuizContainer;
