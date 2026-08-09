import React, { Suspense } from 'react';
import { useQuiz } from '@/contexts/QuizContext';
import ProgressBar from './ProgressBar';
import QuizStack, { QUIZ_QUESTIONS } from './QuizStack';
import ContactInfoForm from './questions/ContactInfoForm';
// WelcomeScreen intentionally omitted in the Astro build — the editorial cover
// at /quiz/ replaces it. QuizApp auto-fires startQuiz() before mounting this.
import ProcessingScreen from './ProcessingScreen';
import AmariLogo from './AmariLogo';
import QuizFooter from './QuizFooter';

// ResultsPage is lazy-loaded so its dependency tree (html2canvas, ShareCard, etc.)
// stays out of the initial welcome-screen bundle.
const ResultsPage = React.lazy(() => import('./results/ResultsPage'));

// A no-submit review state for internal visual approval. It is only enabled
// by the explicit URL flag and never calls the quiz submission endpoint.
const ANSWER_MAP_PREVIEW = {
  firstName: 'Preview',
  patternSignature: 'Established Pattern' as const,
  scores: {
    softTissueTension: 40,
    jointBoneAlignment: 25,
    patternDuration: 80,
    dailyActivitiesImpact: 70,
    bodyAdaptations: 25,
    recoveryPotential: 72,
  },
  insights: [],
};

function topMetaLabel({
  isProcessing,
  currentStep,
  totalSteps,
}: {
  isProcessing: boolean;
  currentStep: number;
  totalSteps: number;
}): string {
  if (isProcessing) return 'Reading your pattern';
  if (currentStep === 12) return 'Almost done';
  if (currentStep <= 11) return `Question ${currentStep + 1} of 12`;
  return 'Free Quiz';
}

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
  } = useQuiz();
  const isAnswerMapPreview = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === 'answer-map';

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
      if (currentStep > 11) return;

      if (e.key === 'Enter') {
        const ans = answers[currentStep]?.answer;
        const hasAnswer = ans !== undefined && ans !== null && ans !== '';
        const isMulti = Array.isArray(ans);
        if (hasAnswer || isMulti) goToNextStep();
      }

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
    <section className="screen proc">
      <div className="ring" aria-hidden="true" />
      <h2>Processing your results…</h2>
      <p className="step">We're analyzing your responses.</p>
    </section>
  );

  const renderErrorState = () => (
    <section className="screen" style={{ textAlign: 'center' }}>
      <h2 className="q-title" style={{ color: 'var(--rust)' }}>Submission error</h2>
      <p className="q-desc" style={{ margin: '16px auto' }}>
        {submissionError || 'There was an error submitting your quiz. Please try again.'}
      </p>
      <button type="button" onClick={retrySubmission} disabled={isSubmitting} className="btn">
        {isSubmitting ? 'Retrying…' : 'Try again'}
      </button>
    </section>
  );

  const isResultsView = isAnswerMapPreview || (isCompleted && !isProcessing);
  const meta = topMetaLabel({ isProcessing, currentStep, totalSteps });
  // During results the ResultsPage owns its own chrome; hide take-flow topbar/footer.
  const showTakeChrome = !isResultsView;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', color: 'var(--ink)' }}>
      {showTakeChrome && (
        <div className="topbar">
          <div className="row">
            <AmariLogo />
            <span className="meta">{meta}</span>
          </div>
          {hasStarted && !isProcessing ? (
            <ProgressBar currentStep={currentStep} totalSteps={totalSteps} />
          ) : (
            <div className="rail">
              <div className="rail-fill" style={{ right: isProcessing ? '0%' : '100%' }} />
            </div>
          )}
        </div>
      )}

      {isResultsView ? (
        <div>
          {(isAnswerMapPreview || (scores && patternSignature)) && (
            <Suspense fallback={renderLoadingState()}>
              <ResultsPage
                firstName={isAnswerMapPreview ? ANSWER_MAP_PREVIEW.firstName : firstName}
                patternSignature={isAnswerMapPreview ? ANSWER_MAP_PREVIEW.patternSignature : patternSignature!}
                scores={isAnswerMapPreview ? ANSWER_MAP_PREVIEW.scores : scores!}
                insights={isAnswerMapPreview ? ANSWER_MAP_PREVIEW.insights : insights}
              />
            </Suspense>
          )}
        </div>
      ) : (
        <main className="stage">
          {isProcessing ? (
            <ProcessingScreen />
          ) : !hasStarted ? (
            <div style={{ minHeight: 200 }} />
          ) : isLoading ? (
            renderLoadingState()
          ) : submissionError ? (
            renderErrorState()
          ) : currentStep === 12 ? (
            <ContactInfoForm
              firstName={firstName}
              lastName={lastName}
              email={email}
              phone={phone}
              setFirstName={setFirstName}
              setLastName={setLastName}
              setEmail={setEmail}
              setPhone={setPhone}
              onSubmit={goToNextStep}
              onBack={goToPrevStep}
              isSubmitting={isSubmitting}
            />
          ) : (
            <QuizStack
              onNext={goToNextStep}
              onPrev={goToPrevStep}
              isSubmitting={isSubmitting}
              validationError={validationError}
            />
          )}

          <QuizFooter />
        </main>
      )}
    </div>
  );
};

export default QuizContainer;
