
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
  onSkip?: () => void;
  showSkipButton?: boolean;
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
  onSkip,
  showSkipButton = false,
}: MultiSelectQuestionProps) => {
  const toggleOption = (option: string) => {
    const newSelectedOptions = [...selectedOptions];
    
    if (newSelectedOptions.includes(option)) {
      // Remove the option if already selected
      onChange(newSelectedOptions.filter((item) => item !== option));
    } else {
      // Add the option if not already selected
      onChange([...newSelectedOptions, option]);
    }
  };

  const toggleOtherOption = () => {
    const hasOther = selectedOptions.includes('Other');
    
    if (hasOther) {
      onChange(selectedOptions.filter(item => item !== 'Other'));
    } else {
      onChange([...selectedOptions, 'Other']);
    }
  };

  return (
    <div className="quiz-card">
      <h2 className="text-2xl font-freight mb-2">{question}</h2>
      {description && <p className="mb-6 text-gray-600">{description}</p>}
      
      <div className="space-y-3 mt-6">
        {options.map((option) => (
          <div
            key={option}
            className={`checkbox-container ${selectedOptions.includes(option) ? 'selected' : ''}`}
            onClick={() => toggleOption(option)}
          >
            <div className="flex items-center h-5">
              <div className={`w-5 h-5 rounded border-2 border-amari-pine-teal flex items-center justify-center ${selectedOptions.includes(option) ? 'bg-amari-pine-teal' : 'bg-white'}`}>
                {selectedOptions.includes(option) && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </div>
            <div className="ml-3 text-sm">
              <label className="font-medium text-gray-900 cursor-pointer">{option}</label>
            </div>
          </div>
        ))}
        
        {otherOption && (
          <div
            className={`checkbox-container ${selectedOptions.includes('Other') ? 'selected' : ''}`}
            onClick={toggleOtherOption}
          >
            <div className="flex items-center h-5">
              <div className={`w-5 h-5 rounded border-2 border-amari-pine-teal flex items-center justify-center ${selectedOptions.includes('Other') ? 'bg-amari-pine-teal' : 'bg-white'}`}>
                {selectedOptions.includes('Other') && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </div>
            <div className="ml-3 text-sm flex-grow">
              <label className="font-medium text-gray-900 cursor-pointer">Other</label>
              {selectedOptions.includes('Other') && onOtherChange && (
                <input
                  type="text"
                  value={otherValue}
                  onChange={(e) => onOtherChange(e.target.value)}
                  placeholder="Please specify"
                  className="mt-2 p-2 w-full border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amari-pine-teal"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {showSkipButton && selectedOptions.length === 0 && (
        <div className="mt-6 text-center">
          <button
            onClick={onSkip}
            className="text-amari-pine-teal hover:text-amari-forest-green font-medium transition-colors duration-200 flex items-center justify-center mx-auto gap-2 group"
          >
            <span>Skip this question</span>
            <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default MultiSelectQuestion;
