import React from 'react';

type MultiSelectQuestionProps = {
  question: string;
  options: string[];
  selectedOptions: string[];
  onChange: (options: string[]) => void;
  description?: string;
  otherOption?: boolean;
  otherValue?: string;
  onOtherChange?: (value: string) => void;
  /** When true, heading/desc/hint are omitted (QuizStack renders them). */
  hideHeading?: boolean;
};

const CheckMark = () => (
  <span className="mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  </span>
);

const MultiSelectQuestion = ({
  question,
  options,
  selectedOptions,
  onChange,
  description,
  otherOption = false,
  otherValue = '',
  onOtherChange,
  hideHeading = false,
}: MultiSelectQuestionProps) => {
  const toggleOption = (option: string) => {
    if (selectedOptions.includes(option)) {
      onChange(selectedOptions.filter((item) => item !== option));
    } else {
      onChange([...selectedOptions, option]);
    }
  };

  const toggleOther = () => {
    if (selectedOptions.includes('Other')) {
      onChange(selectedOptions.filter((item) => item !== 'Other'));
    } else {
      onChange([...selectedOptions, 'Other']);
    }
  };

  return (
    <div>
      {!hideHeading && (
        <>
          <h2 className="q-title">{question}</h2>
          {description && <p className="q-desc">{description}</p>}
          <p className="q-hint">Select all that apply.</p>
        </>
      )}

      <div className="options" role="group" aria-label={question}>
        {options.map((option) => {
          const isSelected = selectedOptions.includes(option);
          return (
            <button
              key={option}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => toggleOption(option)}
              className={`opt check${isSelected ? ' sel' : ''}`}
            >
              <CheckMark />
              <span className="txt">{option}</span>
            </button>
          );
        })}

        {otherOption && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selectedOptions.includes('Other')}
            onClick={toggleOther}
            className={`opt check${selectedOptions.includes('Other') ? ' sel' : ''}`}
          >
            <CheckMark />
            <span className="txt">Other</span>
          </button>
        )}
      </div>

      {otherOption && selectedOptions.includes('Other') && onOtherChange && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Please specify…"
          autoFocus
          className="mt-4 w-full"
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
  );
};

export default MultiSelectQuestion;
