
import React from 'react';
import { Loader2 } from 'lucide-react';

type ContactInfoFormProps = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  setFirstName: (name: string) => void;
  setLastName: (name: string) => void;
  setEmail: (email: string) => void;
  setPhone: (phone: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  validationError: string;
};

const ContactInfoForm = ({
  firstName,
  lastName,
  email,
  phone,
  setFirstName,
  setLastName,
  setEmail,
  setPhone,
  onSubmit,
  onBack,
  isSubmitting,
  validationError,
}: ContactInfoFormProps) => {
  return (
    <div className="quiz-card">
      <h2 className="text-2xl font-serif mb-3">Your Pain Pattern Report Is Ready</h2>
      <p className="mb-6 text-gray-600">One last step: enter your email to see your pattern signature, recovery score, and personalized insights.</p>
      
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amari-pine-teal"
              required
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amari-pine-teal"
              required
            />
          </div>
        </div>
        
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amari-pine-teal"
            required
          />
        </div>
        
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone Number <span className="text-gray-400">(Optional)</span>
          </label>
          <input
            type="tel"
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amari-pine-teal"
          />
        </div>
      </div>
      
      <div className="mt-6 text-sm text-gray-500">
        By submitting this form, you agree to our{' '}
        <a href="https://www.amarimethod.com/privacy-policy" className="text-amari-pine-teal underline">
          Privacy Policy
        </a>{' '}
        and{' '}
        <a href="https://www.amarimethod.com/terms-of-use" className="text-amari-pine-teal underline">
          Terms of Use
        </a>.
      </div>

      <div className="quiz-card-nav" onClick={(e) => e.stopPropagation()}>
        {validationError && (
          <p className="text-xs text-red-500 text-center mb-2" role="alert">{validationError}</p>
        )}
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBack} className="quiz-nav-back">←</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className="btn-primary"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing
              </>
            ) : (
              <>See My Results <span className="arrow">→</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContactInfoForm;
