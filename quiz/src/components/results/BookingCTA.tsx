
import React from 'react';
import { PatternSignature } from '@/types/quiz';
import { useQuiz } from '@/contexts/QuizContext';

type BookingCTAProps = {
  patternSignature: PatternSignature;
};

const CheckIcon = () => (
  <svg className="w-6 h-6 text-amari-pine-teal flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const StarIcon = () => (
  <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

// Build a booking URL with ?pain= param based on quiz Q0 answer
function buildBookingUrl(base: string, painLocation: string | null): string {
  if (!painLocation) return base;
  const normalized = painLocation.toLowerCase().replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}pain=${encodeURIComponent(normalized)}`;
}

const BookingCTA = ({ patternSignature: _ }: BookingCTAProps) => {
  const { referralSource, answers } = useQuiz();
  const painLocation = (answers[0]?.answer as string) || null;

  // Capitalize first letter of referral name for display
  const referralName = referralSource
    ? referralSource.charAt(0).toUpperCase() + referralSource.slice(1)
    : null;

  return (
    <section className="px-6 py-12 bg-amari-bone-white">
      <div className="max-w-2xl mx-auto">

        {/* Main headline */}
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-serif text-amari-charcoal leading-tight mb-4">
            You're not broken.<br />You're out of balance.
          </h2>
          <p className="text-lg font-sans text-amari-text-light max-w-xl mx-auto mb-5">
            The pain you feel isn't a failure—it's your body asking for a reset. The Amari Method shows you how to respond with precision, not guesswork.
          </p>
          {/* Social proof pill */}
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold font-sans bg-green-50 text-green-700 border border-green-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Most clients feel noticeable change within one session
          </span>
        </div>

        {/* Booking card */}
        <div className="bg-amari-light-sand p-8 md:p-10 rounded-xl shadow-lg border-2 border-amari-pine-teal mb-10">
          <h3 className="text-2xl md:text-3xl font-serif text-amari-charcoal text-center mb-6">
            What's Included in Your Private Session
          </h3>
          <ul className="space-y-3 mb-8 text-base md:text-lg">
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">60-minute Initial Amari Method session (virtual or in-person)</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">Immediate pain relief strategies tailored to your pattern</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">Personalized tools for long-term alignment</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">Follow-up care options and take-home kit available</span>
            </li>
          </ul>

          <div className="text-center mb-6">
            <div className="text-3xl font-serif text-amari-charcoal mb-1">$225</div>
            <p className="text-sm text-amari-text-light font-sans">
              <strong>Satisfaction guaranteed:</strong> If you don't feel a real shift, we'll keep working at no extra charge.
            </p>
          </div>

          {referralName ? (
            <div className="flex justify-center mb-4">
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold font-sans bg-amari-pine-teal bg-opacity-10 text-amari-pine-teal border border-amari-pine-teal border-opacity-20">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
                Referred by {referralName}
              </span>
            </div>
          ) : null}

          <div className="flex gap-3" style={{ width: '100%' }}>
            <a
              href={buildBookingUrl("https://amarimethodbooking.amarimethod.com/amari-method-funnel", painLocation)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-center"
              style={{ flex: 1, display: 'block' }}
            >
              <span>Book In-Person<span className="arrow">→</span></span>
            </a>
            <a
              href={buildBookingUrl("https://introsessionvirtual.amarimethod.com/is-virtual-info", painLocation)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-center"
              style={{ flex: 1, display: 'block' }}
            >
              <span>Book Virtual<span className="arrow">→</span></span>
            </a>
          </div>
          <p className="text-sm text-amari-text-light mt-3 text-center font-sans">
            San Francisco in-person or virtual from anywhere · HSA/FSA accepted
          </p>
        </div>

        {/* Testimonial */}
        <div className="bg-white p-8 rounded-xl shadow-md border border-amari-border mb-10">
          <div className="flex gap-1 mb-4 justify-center">
            {[...Array(5)].map((_, i) => <StarIcon key={i} />)}
          </div>
          <p className="text-lg text-amari-charcoal italic mb-4 text-center font-sans leading-relaxed">
            "After years of chronic back pain, one session completely changed my relationship with my body. I finally understand what's been causing it — and more importantly, how to fix it."
          </p>
          <p className="text-sm text-amari-text-light text-center font-medium font-sans">
            — Sarah M., San Francisco
          </p>
        </div>

        {/* Discovery call secondary CTA */}
        <div className="text-center border-t border-amari-border pt-8">
          <p className="text-lg text-amari-charcoal font-semibold mb-4 font-sans">
            {referralName ? 'Have questions? Book a free discovery call' : 'Not ready to book? Start with a free call'}
          </p>
          <a
            href={buildBookingUrl("https://discoverycall.amarimethod.com/discovery-call-booking", painLocation)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            <span>Schedule Free 15-Min Discovery Call<span className="arrow">→</span></span>
          </a>
          <p className="text-sm text-amari-text-light mt-3 font-sans">
            No pressure. Just answers to your questions.
          </p>
        </div>

      </div>
    </section>
  );
};

export default BookingCTA;
