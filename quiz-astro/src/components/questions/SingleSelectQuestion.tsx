import React from 'react';

type SingleSelectQuestionProps = {
  question: string;
  options: string[];
  selectedOption: string | null;
  onChange: (option: string) => void;
  description?: string;
  otherOption?: boolean;
  otherValue?: string;
  onOtherChange?: (value: string) => void;
  required?: boolean;
  onAutoAdvance?: () => void;
  /** When true, heading/desc are omitted (QuizStack renders q-head / q-title). */
  hideHeading?: boolean;
};

const CheckMark = () => (
  <span className="mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  </span>
);

const SingleSelectQuestion = ({
  question,
  options,
  selectedOption,
  onChange,
  description,
  otherOption = false,
  otherValue = '',
  onOtherChange,
  required = false,
  onAutoAdvance,
  hideHeading = false,
}: SingleSelectQuestionProps) => {
  const handleClick = (option: string) => {
    onChange(option);
    if (onAutoAdvance) setTimeout(onAutoAdvance, 400);
  };

  const OptionButton = ({ label }: { label: string }) => {
    const isSelected = selectedOption === label;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={isSelected}
        onClick={() => handleClick(label)}
        className={`opt radio${isSelected ? ' sel' : ''}`}
      >
        <CheckMark />
        <span className="txt">{label}</span>
      </button>
    );
  };

  return (
    <div>
      {!hideHeading && (
        <>
          <h2 className="q-title">
            {question}
            {required && <span style={{ color: 'var(--rust)' }}> *</span>}
          </h2>
          {description && <p className="q-desc">{description}</p>}
        </>
      )}

      <div className="options" role="radiogroup" aria-label={question}>
        {options.map((option) => (
          <OptionButton key={option} label={option} />
        ))}

        {otherOption && (
          <div>
            <button
              type="button"
              role="radio"
              aria-checked={selectedOption === 'Other'}
              onClick={() => handleClick('Other')}
              className={`opt radio${selectedOption === 'Other' ? ' sel' : ''}`}
            >
              <CheckMark />
              <span className="txt">Other</span>
            </button>
            {selectedOption === 'Other' && onOtherChange && (
              <input
                type="text"
                value={otherValue}
                onChange={(e) => onOtherChange(e.target.value)}
                placeholder="Please specify"
                autoFocus
                className="mt-2 w-full"
                style={{
                  border: '1px solid var(--line)',
                  background: 'var(--paper)',
                  borderRadius: 3,
                  padding: '14px 16px',
                  fontFamily: 'var(--sans)',
                  fontSize: '1rem',
                  color: 'var(--ink)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SingleSelectQuestion;
