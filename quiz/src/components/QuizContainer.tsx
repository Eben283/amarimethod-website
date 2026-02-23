
import React from 'react';
import { useQuiz } from '@/contexts/QuizContext';
import ProgressBar from './ProgressBar';
import SingleSelectQuestion from './questions/SingleSelectQuestion';
import MultiSelectQuestion from './questions/MultiSelectQuestion';
import ContactInfoForm from './questions/ContactInfoForm';
import ResultsPage from './results/ResultsPage';
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
    skipStep,
    setAnswer,
    setFirstName,
    setLastName,
    setEmail,
    setPhone,
    retrySubmission,
  } = useQuiz();

  const handleNextStep = () => goToNextStep();

  // Auto-skip Q11 (treatment results) if no treatments were selected
  React.useEffect(() => {
    if (currentStep === 10) {
      const showTreatmentResults = answers[9]?.answer &&
                                   (answers[9].answer as string[]).length > 0 &&
                                   !(answers[9].answer as string[]).includes('I haven\'t tried any treatments');

      if (!showTreatmentResults) {
        // Auto-skip to next question after brief delay (smooth UX)
        const timer = setTimeout(() => {
          goToNextStep();
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [currentStep, answers, goToNextStep]);

  // Keyboard navigation: Enter to advance, number keys for single-select
  React.useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Enter key advances to next step (if answer is selected)
      if (e.key === 'Enter') {
        const currentAnswer = answers[currentStep]?.answer;
        const hasAnswer = currentAnswer !== undefined && currentAnswer !== null && currentAnswer !== '';

        // For multi-select, allow empty arrays to advance (optional questions)
        const hasMultiSelectAnswer = Array.isArray(currentAnswer);

        if (hasAnswer || hasMultiSelectAnswer) {
          handleNextStep();
        }
      }

      // Number keys (1-9) for single-select questions
      const isSingleSelect = [0, 1, 3, 4, 10].includes(currentStep); // Q1, Q2, Q4, Q5, Q11
      if (isSingleSelect && e.key >= '1' && e.key <= '9') {
        const optionIndex = parseInt(e.key) - 1;

        // Get the options for current question
        let options: string[] = [];
        switch (currentStep) {
          case 0: // Primary pain location
            options = ['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Hips', 'Knees', 'Ankles/Feet', 'Wrists/Hands', 'Elbows'];
            break;
          case 1: // Pain trigger
            options = ['Sudden injury or accident', 'Gradual onset over time (no specific event)', 'After starting a new activity/exercise', 'Stress or emotional factors', 'After a major life change (pregnancy, new job, etc.)', 'I\'m not sure'];
            break;
          case 3: // Pain duration
            options = ['Less than 1 week', '1-4 weeks', '1-3 months', '3-6 months', '6-12 months', 'More than 1 year'];
            break;
          case 4: // Pain intensity
            options = ['Mild (1-3)', 'Moderate (4-6)', 'Severe (7-10)'];
            break;
          case 10: // Treatment results
            options = ['No improvement', 'Slight improvement', 'Moderate improvement', 'Significant improvement but not complete', 'Temporary relief, but pain returned'];
            break;
        }

        if (optionIndex >= 0 && optionIndex < options.length) {
          setAnswer(currentStep, options[optionIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentStep, answers, handleNextStep, setAnswer]);

  const renderQuestionStep = () => {
    // Check if answers array is initialized and has valid items
    if (!answers || answers.length === 0) {
      return (
        <div className="text-center py-6">
          <p>Loading questions...</p>
        </div>
      );
    }

    switch (currentStep) {
      case 0: // Q1: Primary pain location
        return (
          <SingleSelectQuestion
            question="Where is your pain primarily located?"
            options={[
              'Neck',
              'Shoulders',
              'Upper back',
              'Lower back',
              'Hips',
              'Knees',
              'Ankles/Feet',
              'Wrists/Hands',
              'Elbows',
            ]}
            selectedOption={answers[0]?.answer as string}
            onChange={(option) => setAnswer(0, option)}
            otherOption={true}
            description="Select the area where you experience the most pain or discomfort."
            required={true}
          />
        );

      case 1: // Q2: Pain trigger (NEW)
        return (
          <SingleSelectQuestion
            question="What do you think triggered or worsened your pain?"
            options={[
              'Sudden injury or accident',
              'Gradual onset over time (no specific event)',
              'After starting a new activity/exercise',
              'Stress or emotional factors',
              'After a major life change (pregnancy, new job, etc.)',
              'I\'m not sure',
            ]}
            selectedOption={answers[1]?.answer as string}
            onChange={(option) => setAnswer(1, option)}
            description="Understanding the origin helps identify the pattern. Select what best describes your situation."
            required={true}
          />
        );

      case 2: // Q3: Additional pain locations
        return (
          <MultiSelectQuestion
            question="Do you experience pain in any additional areas?"
            options={[
              'Neck',
              'Shoulders',
              'Upper back',
              'Lower back',
              'Hips',
              'Knees',
              'Ankles/Feet',
              'Wrists/Hands',
              'Elbows',
            ]}
            selectedOptions={answers[2]?.answer as string[] || []}
            onChange={(options) => setAnswer(2, options)}
            otherOption={true}
            description="Select all other areas where you experience pain or discomfort. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 3: // Q4: Pain duration
        return (
          <SingleSelectQuestion
            question="How long have you been experiencing this pain?"
            options={[
              'Less than 1 week',
              '1-4 weeks',
              '1-3 months',
              '3-6 months',
              '6-12 months',
              'More than 1 year',
            ]}
            selectedOption={answers[3]?.answer as string}
            onChange={(option) => setAnswer(3, option)}
            description="Select the timeframe that best represents how long you've been experiencing your primary pain."
            required={true}
          />
        );

      case 4: // Q5: Pain intensity
        return (
          <SingleSelectQuestion
            question="How would you describe your pain intensity?"
            options={[
              'Mild (1-3)',
              'Moderate (4-6)',
              'Severe (7-10)',
            ]}
            selectedOption={answers[4]?.answer as string}
            onChange={(option) => setAnswer(4, option)}
            description="On a scale of 1-10, with 10 being the worst pain imaginable, how would you rate your typical pain level?"
            required={true}
          />
        );

      case 5: // Q6: Pain timing
        return (
          <MultiSelectQuestion
            question="When do you typically experience pain?"
            options={[
              'In the morning, right after waking up',
              'During the day, while active',
              'After physical activity',
              'After sitting for long periods',
              'At night, when trying to sleep',
              'The pain is constant throughout the day',
            ]}
            selectedOptions={answers[5]?.answer as string[] || []}
            onChange={(options) => setAnswer(5, options)}
            otherOption={true}
            description="Select all times when you typically experience pain. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 6: // Q7: Pain qualities (OPTIMIZED - reduced to 8 options)
        return (
          <MultiSelectQuestion
            question="What type of pain are you experiencing?"
            options={[
              'Sharp or stabbing',
              'Dull or achy',
              'Tight or stiff',
              'Burning',
              'Shooting down arm/leg',
              'Tingling or numbness',
              'Throbbing',
              'Pinching',
            ]}
            selectedOptions={answers[6]?.answer as string[] || []}
            onChange={(options) => setAnswer(6, options)}
            otherOption={true}
            description="Select all words that describe the quality of your pain. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 7: // Q8: Aggravating activities (ADDED twisting/rotating)
        return (
          <MultiSelectQuestion
            question="What activities make your pain worse?"
            options={[
              'Walking/Running',
              'Sitting',
              'Standing for long periods',
              'Bending forward',
              'Bending backward',
              'Twisting or rotating',
              'Lifting or carrying objects',
              'Going up/down stairs',
              'Repetitive movements',
              'Specific exercise/sports',
            ]}
            selectedOptions={answers[7]?.answer as string[] || []}
            onChange={(options) => setAnswer(7, options)}
            otherOption={true}
            description="Select all activities that tend to worsen your pain. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 8: // Q9: Life impact
        return (
          <MultiSelectQuestion
            question="Does your pain affect any of the following aspects of your life?"
            options={[
              'Sleep quality',
              'Work performance',
              'Ability to exercise',
              'Social activities',
              'Household chores',
              'Hobbies/Recreation',
              'Mood and mental health',
              'Relationships',
              'Driving',
            ]}
            selectedOptions={answers[8]?.answer as string[] || []}
            onChange={(options) => setAnswer(8, options)}
            otherOption={true}
            description="Select all areas of life that are impacted by your pain. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 9: // Q10: Treatments tried
        return (
          <MultiSelectQuestion
            question="Have you tried any treatments for your pain?"
            options={[
              'Physical therapy',
              'Chiropractic care',
              'Massage therapy',
              'Acupuncture',
              'Pain medication',
              'Anti-inflammatory medication',
              'Injections (cortisone, etc.)',
              'Surgery',
              'Exercise/Stretching',
              'Heat/Ice therapy',
              'I haven\'t tried any treatments'
            ]}
            selectedOptions={answers[9]?.answer as string[] || []}
            onChange={(options) => setAnswer(9, options)}
            otherOption={true}
            description="Select all treatments you have tried for your pain. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 10: // Q11: Treatment results (auto-skips if no treatments selected)
        const showTreatmentResults = answers[9]?.answer &&
                                   (answers[9].answer as string[]).length > 0 &&
                                   !(answers[9].answer as string[]).includes('I haven\'t tried any treatments');

        if (!showTreatmentResults) {
          // Show brief loading message while auto-advancing (useEffect handles skip)
          return (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-4 border-amari-oat border-t-amari-pine-teal rounded-full animate-spin mb-4"></div>
              <p className="text-amari-text-light">Loading next question...</p>
            </div>
          );
        }

        return (
          <SingleSelectQuestion
            question="How would you describe your results from previous treatments?"
            options={[
              'No improvement',
              'Slight improvement',
              'Moderate improvement',
              'Significant improvement but not complete',
              'Temporary relief, but pain returned',
            ]}
            selectedOption={answers[10]?.answer as string}
            onChange={(option) => setAnswer(10, option)}
            description="Select the option that best describes your overall experience with previous treatments."
            required={true}
          />
        );

      case 11: // Q12: Other health conditions (OPTIMIZED - reduced to 12 options)
        return (
          <MultiSelectQuestion
            question="Do you have any other health conditions?"
            options={[
              'Arthritis',
              'Fibromyalgia',
              'Sciatica',
              'Disc herniation/bulge',
              'Scoliosis',
              'Previous injury/trauma',
              'Previous surgery',
              'Diabetes',
              'Autoimmune condition',
              'Depression/Anxiety',
              'Chronic fatigue',
              'None of the above'
            ]}
            selectedOptions={answers[11]?.answer as string[] || []}
            onChange={(options) => setAnswer(11, options)}
            otherOption={true}
            description="Select any health conditions you have been diagnosed with. (Optional)"
            showSkipButton={true}
            onSkip={skipStep}
          />
        );

      case 12: // Q13: Contact info
        return (
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
        );

      default:
        return null;
    }
  };

  const renderLoadingState = () => {
    return (
      <div className="text-center py-12 flex flex-col items-center justify-center min-h-[300px]">
        <Loader2 className="h-12 w-12 text-amari-pine-teal animate-spin mb-4" />
        <h3 className="text-xl font-medium mb-2">Processing your results...</h3>
        <p className="text-gray-600">
          We're analyzing your responses to generate a personalized pain assessment.
        </p>
      </div>
    );
  };

  const renderErrorState = () => {
    return (
      <div className="text-center py-12 flex flex-col items-center justify-center min-h-[300px] bg-red-50 border border-red-200 rounded-lg px-6">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="text-xl font-medium mb-2 text-red-700">Submission Error</h3>
        <p className="text-red-600 mb-4">
          {submissionError || "There was an error submitting your assessment. Please try again."}
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
            "Try Again"
          )}
        </Button>
      </div>
    );
  };

  const renderNavigationButtons = () => {
    // Debug logging
    console.log('[QuizContainer] Rendering navigation buttons for step:', currentStep);
    console.log('[QuizContainer] isLoading:', isLoading, 'submissionError:', submissionError);

    return (
      <div className="mt-8">
        {validationError && (
          <p className="text-sm text-red-500 text-center mb-3" role="alert">{validationError}</p>
        )}
      <div className="flex justify-between">
        {currentStep > 0 && (
          <button
            onClick={goToPrevStep}
            className="btn-secondary"
            disabled={isSubmitting}
          >
            <span>Previous<span className="arrow">→</span></span>
          </button>
        )}

        {currentStep === 0 && <div></div>}

        <button
          onClick={handleNextStep}
          disabled={isSubmitting}
          className={`btn-primary ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isSubmitting ? (
            <span>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing
            </span>
          ) : currentStep === totalSteps - 1 ? (
            <span>Submit<span className="arrow">→</span></span>
          ) : (
            <span>Next<span className="arrow">→</span></span>
          )}
        </button>
      </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-amari-bone-white">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <AmariLogo />

        {isProcessing ? (
          <ProcessingScreen />
        ) : !isCompleted ? (
          <div>
            <div className="text-center mb-8">
              <h1 className="text-3xl md:text-4xl font-freight mb-4">Pain Pattern Assessment</h1>
              <p className="text-lg text-gray-600 mb-6">
                Discover the root causes of your pain with our personalized assessment
              </p>

              {/* Trust indicators */}
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-amari-text-light max-w-2xl mx-auto">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">2-3 minutes</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span className="font-medium">200+ clients helped</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">Free personalized results</span>
                </div>
              </div>
            </div>

            <ProgressBar currentStep={currentStep} totalSteps={totalSteps} />
            
            {isLoading ? (
              renderLoadingState()
            ) : submissionError ? (
              renderErrorState()
            ) : (
              renderQuestionStep()
            )}

            {/* Always show navigation buttons unless we're loading or submitted */}
            {!isLoading && !isCompleted && renderNavigationButtons()}
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
