
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
};

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
        onClick={() => handleClick(label)}
        className={`w-full text-left px-5 py-3.5 rounded-xl border-2 transition-all duration-200 flex items-center justify-between group
          ${isSelected
            ? 'border-amari-pine-teal bg-amari-pine-teal bg-opacity-[7%] shadow-sm'
            : 'border-amari-oat bg-white hover:border-amari-pine-teal hover:border-opacity-40 hover:bg-amari-light-sand hover:shadow-sm'
          }`}
      >
        <span className={`font-sans text-sm font-medium leading-snug ${isSelected ? 'text-amari-charcoal' : 'text-gray-700'}`}>
          {label}
        </span>
        <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ml-3 transition-all duration-200
          ${isSelected ? 'border-amari-pine-teal bg-amari-pine-teal' : 'border-amari-oat group-hover:border-amari-pine-teal'}`}
        >
          {isSelected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </button>
    );
  };

  return (
    <div>
      <h2 className="text-2xl font-freight mb-2">
        {question}
        {required && <span className="text-red-500 ml-1">*</span>}
      </h2>
      {description && <p className="mb-4 text-sm text-amari-text-light font-sans">{description}</p>}

      <div className="space-y-2.5 mt-5">
        {options.map((option) => (
          <OptionButton key={option} label={option} />
        ))}

        {otherOption && (
          <div>
            <button
              type="button"
              onClick={() => handleClick('Other')}
              className={`w-full text-left px-5 py-3.5 rounded-xl border-2 transition-all duration-200 flex items-center justify-between group
                ${selectedOption === 'Other'
                  ? 'border-amari-pine-teal bg-amari-pine-teal bg-opacity-[7%] shadow-sm'
                  : 'border-amari-oat bg-white hover:border-amari-pine-teal hover:border-opacity-40 hover:bg-amari-light-sand hover:shadow-sm'
                }`}
            >
              <span className={`font-sans text-sm font-medium ${selectedOption === 'Other' ? 'text-amari-charcoal' : 'text-gray-700'}`}>
                Other
              </span>
              <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ml-3 transition-all duration-200
                ${selectedOption === 'Other' ? 'border-amari-pine-teal bg-amari-pine-teal' : 'border-amari-oat group-hover:border-amari-pine-teal'}`}
              >
                {selectedOption === 'Other' && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
            {selectedOption === 'Other' && onOtherChange && (
              <input
                type="text"
                value={otherValue}
                onChange={(e) => onOtherChange(e.target.value)}
                placeholder="Please specify"
                autoFocus
                className="mt-2 px-4 py-2.5 w-full border-2 border-amari-pine-teal rounded-xl text-sm font-sans focus:outline-none focus:border-amari-pine-teal bg-white"
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
