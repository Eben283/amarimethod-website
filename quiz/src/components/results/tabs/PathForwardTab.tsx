// src/components/PathForwardTab.tsx
import React from 'react';
import { PatternSignature } from '@/types/quiz';

type PathForwardTabProps = {
  patternSignature: PatternSignature;
};

const PathForwardTab = ({ patternSignature }: PathForwardTabProps) => {
  const getPatternRecommendation = (pattern: PatternSignature): string => {
    switch (pattern) {
      case 'Protective Tension':
        return "What you're feeling isn't dysfunction—it's your body's way of holding on for safety. Let's help it begin to let go.";
      case 'Structural Adaptation':
        return "Your body has found a way to cope. Now, let's guide it back into alignment—and into ease.";
      case 'Established Pattern':
        return "Your pain pattern has been deeply rehearsed over time. But healing is possible—through new neural pathways.";
      case 'Functional Limitation':
        return "Pain has narrowed what you can do. Let's widen your range by retraining the way your body supports you.";
      case 'Compensatory Movement':
        return "Your body has been making up for lost function. Now it's time to balance the equation at its source.";
      default:
        return "Your body is doing its best to adapt. The Amari Method meets it there—and begins the shift toward lasting change.";
    }
  };

  return (
    <div className="px-6 py-12 bg-amari-bone-white font-sans text-amari-charcoal">
      {/* Social proof banner */}
      <div className="text-center mb-8 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amari-pine-teal bg-opacity-10 rounded-full text-sm text-amari-pine-teal font-medium mb-4">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/>
          </svg>
          <span>Join 200+ clients who found lasting relief</span>
        </div>
      </div>

      {/* Main headline */}
      <div className="text-center mb-16 max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-serif leading-tight mb-6 text-amari-charcoal">
          You're not broken.<br />You're out of balance.
        </h2>
        <p className="text-xl font-sans text-amari-text-light max-w-2xl mx-auto mb-4">
          The pain you feel isn't a failure—it's your body asking for a reset. The Amari Method shows you how to respond with precision, not guesswork.
        </p>
        <p className="text-base text-amari-pine-teal font-medium">
          ✓ Most clients feel noticeable change within one session
        </p>
      </div>

      {/* Pattern-specific message */}
      <div className="bg-amari-light-sand border-l-4 border-amari-pine-teal p-6 rounded-r-lg max-w-3xl mx-auto mb-12">
        <p className="text-lg font-sans text-amari-charcoal italic">
          {getPatternRecommendation(patternSignature)}
        </p>
      </div>

      {/* Primary CTA - Book Session */}
      <div className="max-w-2xl mx-auto mb-12">
        <div className="bg-amari-light-sand p-8 md:p-10 rounded-xl shadow-lg border-2 border-amari-pine-teal">
          <h3 className="text-2xl md:text-3xl font-serif text-amari-charcoal text-center mb-6">
            What's Included in Your Private Session
          </h3>
          <ul className="text-base md:text-lg space-y-3 mb-8">
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 text-amari-pine-teal flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>60-minute Initial Amari Method session (virtual or in-person)</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 text-amari-pine-teal flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Immediate pain relief strategies tailored to your pattern</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 text-amari-pine-teal flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Personalized tools for long-term alignment</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-6 h-6 text-amari-pine-teal flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Follow-up care options and take-home kit available</span>
            </li>
          </ul>

          <div className="text-center mb-6">
            <div className="text-3xl font-serif text-amari-charcoal mb-2">$225</div>
            <p className="text-sm text-amari-text-light">
              <strong>Satisfaction guaranteed:</strong> If you don't feel a real shift, we'll keep working at no extra charge.
            </p>
          </div>

          <a
            href="https://www.amarimethod.com/booking"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full text-center"
            style={{ display: 'block' }}
          >
            <span>Book Your Amari Session<span className="arrow">→</span></span>
          </a>
          <p className="text-sm text-amari-text-light mt-3 text-center">
            Book your initial session to get started
          </p>
        </div>
      </div>

      {/* Testimonial */}
      <div className="max-w-2xl mx-auto mb-12">
        <div className="bg-white p-8 rounded-xl shadow-md border border-amari-border">
          <div className="flex gap-1 mb-4 justify-center">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <p className="text-lg text-amari-charcoal italic mb-4 text-center">
            "After years of chronic back pain, one session with Dr. Garrett completely changed my relationship with my body. I finally understand what's been causing my pain—and more importantly, how to fix it."
          </p>
          <p className="text-sm text-amari-text-light text-center font-medium">
            — Sarah M., San Francisco
          </p>
        </div>
      </div>

      {/* Secondary CTA - Free Call */}
      <div className="text-center max-w-xl mx-auto">
        <div className="border-t border-amari-border pt-8">
          <p className="text-lg text-amari-charcoal font-semibold mb-4">
            Not ready to book? Start with a free call
          </p>
          <a
            href="https://discoverycall.amarimethod.com/discovery-call-booking"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            <span>Schedule Free 15-Min Discovery Call<span className="arrow">→</span></span>
          </a>
          <p className="text-sm text-amari-text-light mt-3">
            No pressure. Just answers to your questions.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PathForwardTab;

