
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
};

const MultiSelectQuestion = ({
  question,
  options,
  selectedOptions,
  onChange,
  description,
  otherOption = false,
  otherValue = '',
  onOtherChange,
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
    <div className="quiz-card">
      <h2 className="text-2xl font-freight mb-2">{question}</h2>
      {description && (
        <p className="text-sm text-amari-text-light font-sans mb-1">{description}</p>
      )}
      <p className="text-xs text-amari-text-light font-sans mb-5 opacity-70">Select all that apply</p>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selectedOptions.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggleOption(option)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium font-sans border-2 transition-all duration-200 leading-tight
                ${isSelected
                  ? 'border-amari-pine-teal bg-amari-pine-teal text-white shadow-sm'
                  : 'border-amari-oat bg-white text-gray-700 hover:border-amari-pine-teal hover:bg-amari-light-sand'
                }`}
            >
              {isSelected && (
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {option}
            </button>
          );
        })}

        {otherOption && (
          <button
            type="button"
            onClick={toggleOther}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium font-sans border-2 transition-all duration-200
              ${selectedOptions.includes('Other')
                ? 'border-amari-pine-teal bg-amari-pine-teal text-white shadow-sm'
                : 'border-amari-oat bg-white text-gray-700 hover:border-amari-pine-teal hover:bg-amari-light-sand'
              }`}
          >
            {selectedOptions.includes('Other') && (
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Other
          </button>
        )}
      </div>

      {/* Other text input — appears below chips when "Other" is selected */}
      {otherOption && selectedOptions.includes('Other') && onOtherChange && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Please specify…"
          autoFocus
          className="mt-4 px-4 py-2.5 w-full border-2 border-amari-pine-teal rounded-xl text-sm font-sans focus:outline-none bg-white"
          onClick={(e) => e.stopPropagation()}
        />
      )}


    </div>
  );
};

export default MultiSelectQuestion;
