import React, { useRef, useEffect } from 'react';
import { useQuiz } from '@/contexts/QuizContext';
import SingleSelectQuestion from './questions/SingleSelectQuestion';
import MultiSelectQuestion from './questions/MultiSelectQuestion';

// ─── Question definitions ────────────────────────────────────────────────────
// Single source of truth for all 12 quiz questions (used by QuizStack +
// exported for keyboard shortcut handling in QuizContainer).

export type QDef = {
  index: number;
  type: 'single' | 'multi';
  question: string;
  description?: string;
  options: string[];
  required?: boolean;
  otherOption?: boolean;
  category: string;
  questionNum: number;
};

export const QUIZ_QUESTIONS: QDef[] = [
  {
    index: 0, type: 'single',
    question: 'Where is your pain primarily located?',
    description: 'Select the area where you experience the most pain or discomfort.',
    options: ['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Hips', 'Knees', 'Ankles/Feet', 'Wrists/Hands', 'Elbows'],
    required: true, otherOption: true,
    category: 'Pain Location', questionNum: 1,
  },
  {
    index: 1, type: 'single',
    question: 'What do you think triggered or worsened your pain?',
    description: 'Understanding the origin helps identify the pattern.',
    options: ['Sudden injury or accident', 'Gradual onset over time (no specific event)', 'After starting an activity/exercise', 'Stress or emotional factors', 'After a major life change (pregnancy, new job, etc.)', "I'm not sure"],
    required: true,
    category: 'Pain History', questionNum: 2,
  },
  {
    index: 2, type: 'multi',
    question: 'Do you experience pain in any additional areas?',
    description: 'Select all other areas where you experience pain or discomfort.',
    options: ['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Hips', 'Knees', 'Ankles/Feet', 'Wrists/Hands', 'Elbows', 'Only my primary area'],
    required: true, otherOption: true,
    category: 'Pain Location', questionNum: 3,
  },
  {
    index: 3, type: 'single',
    question: 'How long have you been experiencing this pain?',
    description: "Select the timeframe that best represents how long you've been experiencing your primary pain.",
    options: ['Less than 1 week', '1-4 weeks', '1-3 months', '3-6 months', '6-12 months', 'More than 1 year'],
    required: true,
    category: 'Duration', questionNum: 4,
  },
  {
    index: 4, type: 'single',
    question: 'How would you describe your pain intensity?',
    description: 'On a scale of 1–10, with 10 being the worst pain imaginable, how would you rate your typical pain level?',
    options: ['Mild (1-3)', 'Moderate (4-6)', 'Severe (7-10)'],
    required: true,
    category: 'Severity', questionNum: 5,
  },
  {
    index: 5, type: 'multi',
    question: 'When do you typically experience pain?',
    description: 'Select all times when you typically experience pain.',
    options: ['In the morning, right after waking up', 'During the day, while active', 'After physical activity', 'After sitting for long periods', 'At night, when trying to sleep', 'The pain is constant throughout the day'],
    required: true, otherOption: true,
    category: 'Timing', questionNum: 6,
  },
  {
    index: 6, type: 'multi',
    question: 'What type of pain are you experiencing?',
    description: 'Select all words that describe the quality of your pain.',
    options: ['Sharp or stabbing', 'Dull or achy', 'Tight or stiff', 'Burning', 'Shooting down arm/leg', 'Tingling or numbness', 'Throbbing', 'Pinching'],
    required: true, otherOption: true,
    category: 'Pain Quality', questionNum: 7,
  },
  {
    index: 7, type: 'multi',
    question: 'What activities make your pain worse?',
    description: 'Select all activities that tend to worsen your pain.',
    options: ['Walking/Running', 'Sitting', 'Standing for long periods', 'Bending forward', 'Bending backward', 'Twisting or rotating', 'Lifting or carrying objects', 'Going up/down stairs', 'Repetitive movements', 'Specific exercise/sports', 'Nothing specific, pain is constant'],
    required: true, otherOption: true,
    category: 'Aggravating Factors', questionNum: 8,
  },
  {
    index: 8, type: 'multi',
    question: 'Does your pain affect any of the following aspects of your life?',
    description: 'Select all areas of life that are impacted by your pain.',
    options: ['Sleep quality', 'Work performance', 'Ability to exercise', 'Social activities', 'Household chores', 'Hobbies/Recreation', 'Mood and mental health', 'Relationships', 'Driving', 'No significant daily impact'],
    required: true, otherOption: true,
    category: 'Daily Impact', questionNum: 9,
  },
  {
    index: 9, type: 'multi',
    question: 'Have you tried any treatments for your pain?',
    description: 'Select all treatments you have tried for your pain.',
    options: ['Physical therapy', 'Chiropractic care', 'Massage therapy', 'Acupuncture', 'Pain medication', 'Anti-inflammatory medication', 'Injections (cortisone, etc.)', 'Surgery', 'Exercise/Stretching', 'Heat/Ice therapy', "I haven't tried any treatments"],
    required: true, otherOption: true,
    category: 'Treatment History', questionNum: 10,
  },
  {
    index: 10, type: 'single',
    question: 'How would you describe your results from previous treatments?',
    description: 'Select the option that best describes your overall experience with previous treatments.',
    options: ['No improvement', 'Slight improvement', 'Moderate improvement', 'Significant improvement but not complete', 'Temporary relief, but pain returned'],
    required: true,
    category: 'Treatment Results', questionNum: 11,
  },
  {
    index: 11, type: 'multi',
    question: 'Do you have any other health conditions?',
    description: 'Select any health conditions you have been diagnosed with.',
    options: ['Arthritis', 'Fibromyalgia', 'Sciatica', 'Disc herniation/bulge', 'Scoliosis', 'Previous injury/trauma', 'Previous surgery', 'Diabetes', 'Autoimmune condition', 'Depression/Anxiety', 'Chronic fatigue', 'None of the above'],
    required: true, otherOption: true,
    category: 'Health Background', questionNum: 12,
  },
];

type QuizStackProps = {
  onNext: () => void;
  onPrev: () => void;
  isSubmitting: boolean;
  validationError: string | null;
};

export default function QuizStack({ onNext, onPrev, isSubmitting, validationError }: QuizStackProps) {
  const {
    currentStep,
    totalSteps,
    answers,
    setAnswer,
    goToNextStep,
    jumpToStep,
  } = useQuiz();

  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (currentStep > 11) return;
    const el = questionRefs.current[currentStep];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentStep]);

  const showQ10 = Boolean(
    answers[9]?.answer &&
    (answers[9].answer as string[]).length > 0 &&
    !(answers[9].answer as string[]).includes("I haven't tried any treatments")
  );

  // Active-question-only presentation (mockup). Past rows stay jumpable above.
  const activeQ = QUIZ_QUESTIONS[currentStep];
  const pastQuestions = QUIZ_QUESTIONS.filter((q) => {
    if (q.index >= currentStep) return false;
    if (q.index === 10 && !showQ10) return false;
    return true;
  });

  if (!activeQ || currentStep > 11) return null;

  const isLast = currentStep === 11;

  return (
    <div>
      {pastQuestions.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          {pastQuestions.map((q) => {
            const pastAns = answers[q.index]?.answer;
            const summary = Array.isArray(pastAns)
              ? pastAns.slice(0, 2).join(', ') + (pastAns.length > 2 ? ` +${pastAns.length - 2}` : '')
              : (pastAns as string) || '—';
            return (
              <button
                key={q.index}
                type="button"
                className="stack-past"
                onClick={() => jumpToStep(q.index)}
              >
                <span className="num" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', flexShrink: 0 }}>
                  {String(q.questionNum).padStart(2, '0')}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.92rem' }}>
                  {q.question}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summary}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={(el) => { questionRefs.current[currentStep] = el; }}
        style={{ scrollMarginTop: '110px' }}
        className="quiz-step-enter"
      >
        <div className="q-head">
          <span className="num">{String(activeQ.questionNum).padStart(2, '0')} / 12</span>
          <span className="cat">{activeQ.category}</span>
        </div>
        <h2 className="q-title">{activeQ.question}</h2>
        {activeQ.description && <p className="q-desc">{activeQ.description}</p>}
        {activeQ.type === 'multi' && <p className="q-hint">Select all that apply.</p>}

        {activeQ.type === 'single' ? (
          <SingleSelectQuestion
            question={activeQ.question}
            options={activeQ.options}
            selectedOption={answers[activeQ.index]?.answer as string}
            onChange={(option) => setAnswer(activeQ.index, option)}
            required={activeQ.required}
            otherOption={activeQ.otherOption}
            onAutoAdvance={goToNextStep}
            hideHeading
          />
        ) : (
          <MultiSelectQuestion
            question={activeQ.question}
            options={activeQ.options}
            selectedOptions={(answers[activeQ.index]?.answer as string[]) || []}
            onChange={(opts) => setAnswer(activeQ.index, opts)}
            otherOption={activeQ.otherOption}
            hideHeading
          />
        )}

        <div className="q-nav" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onPrev}
            className="q-back"
            disabled={currentStep === 0}
            aria-label="Back"
          >
            ←
          </button>

          <span className="q-count">
            {currentStep + 1} / {totalSteps}
          </span>

          <button
            type="button"
            onClick={onNext}
            disabled={isSubmitting}
            className="btn"
          >
            {isSubmitting ? (
              'Processing'
            ) : isLast ? (
              <>Continue <span className="arrow">→</span></>
            ) : (
              <>Next <span className="arrow">›</span></>
            )}
          </button>
        </div>

        {validationError && (
          <p className="q-err" style={{ textAlign: 'center', marginTop: 14 }} role="alert">
            {validationError}
          </p>
        )}
      </div>
    </div>
  );
}
