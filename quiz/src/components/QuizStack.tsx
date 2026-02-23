
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
  showSkipButton?: boolean;
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
    options: ['Sudden injury or accident', 'Gradual onset over time (no specific event)', 'After starting a new activity/exercise', 'Stress or emotional factors', 'After a major life change (pregnancy, new job, etc.)', "I'm not sure"],
    required: true,
    category: 'Pain History', questionNum: 2,
  },
  {
    index: 2, type: 'multi',
    question: 'Do you experience pain in any additional areas?',
    description: 'Select all other areas where you experience pain or discomfort. (Optional)',
    options: ['Neck', 'Shoulders', 'Upper back', 'Lower back', 'Hips', 'Knees', 'Ankles/Feet', 'Wrists/Hands', 'Elbows'],
    otherOption: true, showSkipButton: true,
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
    description: 'Select all times when you typically experience pain. (Optional)',
    options: ['In the morning, right after waking up', 'During the day, while active', 'After physical activity', 'After sitting for long periods', 'At night, when trying to sleep', 'The pain is constant throughout the day'],
    otherOption: true, showSkipButton: true,
    category: 'Timing', questionNum: 6,
  },
  {
    index: 6, type: 'multi',
    question: 'What type of pain are you experiencing?',
    description: 'Select all words that describe the quality of your pain. (Optional)',
    options: ['Sharp or stabbing', 'Dull or achy', 'Tight or stiff', 'Burning', 'Shooting down arm/leg', 'Tingling or numbness', 'Throbbing', 'Pinching'],
    otherOption: true, showSkipButton: true,
    category: 'Pain Quality', questionNum: 7,
  },
  {
    index: 7, type: 'multi',
    question: 'What activities make your pain worse?',
    description: 'Select all activities that tend to worsen your pain. (Optional)',
    options: ['Walking/Running', 'Sitting', 'Standing for long periods', 'Bending forward', 'Bending backward', 'Twisting or rotating', 'Lifting or carrying objects', 'Going up/down stairs', 'Repetitive movements', 'Specific exercise/sports'],
    otherOption: true, showSkipButton: true,
    category: 'Aggravating Factors', questionNum: 8,
  },
  {
    index: 8, type: 'multi',
    question: 'Does your pain affect any of the following aspects of your life?',
    description: 'Select all areas of life that are impacted by your pain. (Optional)',
    options: ['Sleep quality', 'Work performance', 'Ability to exercise', 'Social activities', 'Household chores', 'Hobbies/Recreation', 'Mood and mental health', 'Relationships', 'Driving'],
    otherOption: true, showSkipButton: true,
    category: 'Daily Impact', questionNum: 9,
  },
  {
    index: 9, type: 'multi',
    question: 'Have you tried any treatments for your pain?',
    description: 'Select all treatments you have tried for your pain. (Optional)',
    options: ['Physical therapy', 'Chiropractic care', 'Massage therapy', 'Acupuncture', 'Pain medication', 'Anti-inflammatory medication', 'Injections (cortisone, etc.)', 'Surgery', 'Exercise/Stretching', 'Heat/Ice therapy', "I haven't tried any treatments"],
    otherOption: true, showSkipButton: true,
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
    description: 'Select any health conditions you have been diagnosed with. (Optional)',
    options: ['Arthritis', 'Fibromyalgia', 'Sciatica', 'Disc herniation/bulge', 'Scoliosis', 'Previous injury/trauma', 'Previous surgery', 'Diabetes', 'Autoimmune condition', 'Depression/Anxiety', 'Chronic fatigue', 'None of the above'],
    otherOption: true, showSkipButton: true,
    category: 'Health Background', questionNum: 12,
  },
];

// ─── Answer summary (shown in past rows) ─────────────────────────────────────

function AnswerSummary({ answer }: { answer: string | string[] | null | undefined }) {
  if (!answer || (Array.isArray(answer) && answer.length === 0)) {
    return <span className="text-xs text-gray-400 italic font-sans">—</span>;
  }
  if (Array.isArray(answer)) {
    const shown = answer.slice(0, 2);
    const extra = answer.length - 2;
    return (
      <div className="flex flex-wrap gap-1 justify-end">
        {shown.map(item => (
          <span key={item} className="px-2 py-0.5 rounded-full text-xs bg-white border border-amari-oat text-gray-600 font-sans whitespace-nowrap">
            {item}
          </span>
        ))}
        {extra > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-white border border-amari-oat text-gray-400 font-sans">
            +{extra}
          </span>
        )}
      </div>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs bg-white border border-amari-oat text-gray-600 font-sans whitespace-nowrap">
      {answer}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QuizStack() {
  const {
    currentStep,
    answers,
    setAnswer,
    goToNextStep,
    goToPrevStep,
    skipStep,
    validationError,
    jumpToStep,
  } = useQuiz();

  // One ref per question slot for scroll targeting
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll active question into view whenever currentStep changes
  useEffect(() => {
    if (currentStep > 11) return; // contact form handled separately
    const el = questionRefs.current[currentStep];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentStep]);

  // Q10 (treatment results) only shows when treatments were actually selected
  const showQ10 = Boolean(
    answers[9]?.answer &&
    (answers[9].answer as string[]).length > 0 &&
    !(answers[9].answer as string[]).includes("I haven't tried any treatments")
  );

  return (
    <div className="space-y-2">
      {QUIZ_QUESTIONS.map((q) => {
        // Hide Q10 in future/past states when not applicable — active state
        // is still rendered briefly while the auto-skip useEffect fires.
        if (q.index === 10 && !showQ10 && q.index !== currentStep) return null;

        const isPast   = q.index < currentStep;
        const isActive = q.index === currentStep;
        const isFuture = q.index > currentStep;

        // For past rows: distinguish answered vs skipped
        const pastAns = answers[q.index]?.answer;
        const isAnswered = pastAns !== null && pastAns !== undefined &&
          !(Array.isArray(pastAns) && pastAns.length === 0);

        return (
          <div
            key={q.index}
            ref={(el) => { questionRefs.current[q.index] = el; }}
            style={{ scrollMarginTop: '90px' }}
          >

            {/* ── PAST: compact answered row ─────────────────────────── */}
            {isPast && (
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-amari-light-sand border border-amari-oat cursor-pointer hover:border-gray-400 transition-all group text-left"
                onClick={() => jumpToStep(q.index)}
              >
                {/* Check (answered) or empty circle (skipped) */}
                {isAnswered ? (
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-amari-charcoal flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-300" />
                )}
                {/* Question number */}
                <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                  {String(q.questionNum).padStart(2, '0')}
                </span>
                {/* Question text (truncated) */}
                <span className="text-sm text-gray-600 font-sans flex-1 truncate min-w-0">
                  {q.question}
                </span>
                {/* Answer badges */}
                <div className="flex-shrink-0 ml-2 max-w-[220px]">
                  <AnswerSummary answer={pastAns} />
                </div>
                {/* Edit icon */}
                <svg
                  className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}

            {/* ── ACTIVE: full question card ─────────────────────────── */}
            {isActive && (
              <div className="quiz-step-enter">
                {/* Category + question number chip */}
                <div className="flex items-center gap-2.5 mb-3 pl-1">
                  <span className="text-xs font-semibold text-gray-400 font-sans tabular-nums">
                    {q.questionNum} / 12
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-widest text-amari-charcoal bg-amari-charcoal bg-opacity-10 px-3 py-1 rounded-full font-sans">
                    {q.category}
                  </span>
                </div>

                {/* Question component renders its own quiz-card wrapper */}
                {q.type === 'single' ? (
                  <SingleSelectQuestion
                    question={q.question}
                    options={q.options}
                    selectedOption={answers[q.index]?.answer as string}
                    onChange={(option) => setAnswer(q.index, option)}
                    description={q.description}
                    required={q.required}
                    otherOption={q.otherOption}
                    onAutoAdvance={goToNextStep}
                  />
                ) : (
                  <MultiSelectQuestion
                    question={q.question}
                    options={q.options}
                    selectedOptions={(answers[q.index]?.answer as string[]) || []}
                    onChange={(opts) => setAnswer(q.index, opts)}
                    description={q.description}
                    otherOption={q.otherOption}
                    showSkipButton={q.showSkipButton}
                    onSkip={skipStep}
                  />
                )}

                {/* Validation + navigation */}
                <div className="mt-5">
                  {validationError && (
                    <p className="text-sm text-red-500 text-center mb-3" role="alert">
                      {validationError}
                    </p>
                  )}
                  <div className="flex justify-between">
                    {q.index > 0 ? (
                      <button onClick={goToPrevStep} className="btn-secondary">
                        <span>← Back</span>
                      </button>
                    ) : (
                      <div />
                    )}
                    <button onClick={goToNextStep} className="btn-primary">
                      <span>Next<span className="arrow">→</span></span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── FUTURE: faded preview row ──────────────────────────── */}
            {isFuture && (
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-amari-oat cursor-pointer hover:border-gray-400 transition-all text-left"
                style={{ opacity: 0.38 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.6'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.38'; }}
                onClick={() => jumpToStep(q.index)}
              >
                <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                  {String(q.questionNum).padStart(2, '0')}
                </span>
                <span className="text-sm text-gray-600 font-sans flex-1">
                  {q.question}
                </span>
                <svg
                  className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

          </div>
        );
      })}
    </div>
  );
}
