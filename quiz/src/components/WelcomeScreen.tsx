import React from 'react';

type WelcomeScreenProps = {
  onStart: () => void;
};

const WelcomeScreen = ({ onStart }: WelcomeScreenProps) => {
  return (
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center px-4 py-12 bg-amari-bone-white">
      <div className="w-full max-w-xl">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-amari-border p-8 md:p-12 text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amari-light-sand rounded-full text-xs font-semibold uppercase tracking-widest text-amari-text-light mb-6 font-sans">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Pain Pattern Assessment
          </div>

          {/* Headline */}
          <h1 className="text-3xl md:text-4xl font-serif text-amari-charcoal leading-tight mb-4">
            Find the Root Cause<br />of Your Pain
          </h1>

          <p className="text-base md:text-lg text-amari-text-light font-sans leading-relaxed mb-8 max-w-sm mx-auto">
            Most people manage symptoms for years without ever addressing the real pattern. This 3-minute assessment changes that.
          </p>

          {/* What you'll discover */}
          <ul className="text-left space-y-3 mb-8 max-w-xs mx-auto">
            {[
              'Identifies your exact pain pattern',
              'Shows which systems are out of balance',
              'Reveals why past treatments may not have worked',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm font-sans text-amari-charcoal">
                <svg className="w-5 h-5 text-amari-pine-teal flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>

          {/* Meta info */}
          <div className="flex items-center justify-center gap-4 text-xs text-amari-text-light font-sans mb-8">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ~3 minutes
            </span>
            <span className="text-amari-oat">·</span>
            <span>12 questions</span>
            <span className="text-amari-oat">·</span>
            <span>Free</span>
          </div>

          {/* CTA */}
          <button
            onClick={onStart}
            className="btn-primary w-full"
          >
            <span>Start My Assessment<span className="arrow">→</span></span>
          </button>

          {/* Trust line */}
          <p className="text-xs text-amari-text-light font-sans mt-4">
            200+ clients helped · Personalized results · No spam
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
