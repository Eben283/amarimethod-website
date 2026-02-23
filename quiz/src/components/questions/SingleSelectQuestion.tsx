
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
  return (
    <div className="quiz-card">
      <h2 className="text-2xl font-freight mb-2">
        {question}
        {required && <span className="text-red-500 ml-1">*</span>}
      </h2>
      {description && <p className="mb-6 text-gray-600">{description}</p>}
      
      <div className="space-y-3 mt-6">
        {options.map((option) => (
          <div
            key={option}
            className={`radio-container ${selectedOption === option ? 'selected' : ''}`}
            onClick={() => {
              onChange(option);
              if (onAutoAdvance) setTimeout(onAutoAdvance, 400);
            }}
          >
            <div className="flex items-center h-5">
              <div className={`w-5 h-5 rounded-full border-2 border-amari-pine-teal flex items-center justify-center ${selectedOption === option ? 'bg-amari-pine-teal' : 'bg-white'}`}>
                {selectedOption === option && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
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
            className={`radio-container ${selectedOption === 'Other' ? 'selected' : ''}`}
            onClick={() => onChange('Other')}
          >
            <div className="flex items-center h-5">
              <div className={`w-5 h-5 rounded-full border-2 border-amari-pine-teal flex items-center justify-center ${selectedOption === 'Other' ? 'bg-amari-pine-teal' : 'bg-white'}`}>
                {selectedOption === 'Other' && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
            </div>
            <div className="ml-3 text-sm flex-grow">
              <label className="font-medium text-gray-900 cursor-pointer">Other</label>
              {selectedOption === 'Other' && onOtherChange && (
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
    </div>
  );
};

export default SingleSelectQuestion;
