
import React from 'react';
import { PatternSignature } from '@/types/quiz';
import { useQuiz } from '@/contexts/QuizContext';
import { getConditionContent } from '@/lib/conditionContent';

type BookingCTAProps = {
  patternSignature: PatternSignature;
};

const CheckIcon = () => (
  <svg className="w-5 h-5 text-amari-pine-teal flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const { referralSource, answers, audience } = useQuiz();
  const painLocation = (answers[0]?.answer as string) || null;
  const conditionContent = getConditionContent(painLocation);
  const testimonial = conditionContent?.matchedTestimonial;

  // In-person is the preferred experience; remote users default to virtual
  // because in-person isn't realistic for them. Both buttons remain visible
  // (Bay Area users may prefer virtual for convenience; remote users
  // sometimes travel to SF) — only the visual emphasis flips.
  const remotePreferred = audience === 'remote';

  // Capitalize first letter of referral name for display
  const referralName = referralSource
    ? referralSource.charAt(0).toUpperCase() + referralSource.slice(1)
    : null;

  return (
    <section id="booking-cta" className="px-6 py-12 bg-amari-bone-white">
      <div className="max-w-2xl mx-auto">

        {/* Headline that bridges from the diagnostic → the offer */}
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-serif text-amari-charcoal leading-tight mb-4">
            You're not broken.<br />
            <em className="italic" style={{ color: '#C56B4E' }}>You're out of balance.</em>
          </h2>
          <p className="text-lg font-sans text-amari-text-light max-w-xl mx-auto mb-5">
            Most people manage symptoms for years. The Amari Method finds where your body is out of balance and teaches you how to correct it yourself.
          </p>
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold font-sans bg-green-50 text-green-700 border border-green-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Most clients feel a noticeable shift in their first session
          </span>
        </div>

        {/* Pricebox — $225 as ENTRY, not a wall */}
        <div className="bg-amari-light-sand p-8 md:p-10 rounded-xl shadow-lg border-2 border-amari-pine-teal mb-10">

          {/* Eyebrow + price */}
          <p className="text-xs uppercase tracking-widest font-semibold font-sans text-amari-pine-teal text-center mb-2">
            Start with one session
          </p>
          <div className="text-center mb-1">
            <span className="text-5xl md:text-6xl font-serif text-amari-charcoal" style={{ fontWeight: 300, letterSpacing: '-0.02em' }}>$225</span>
          </div>
          <p className="text-xs uppercase tracking-widest font-sans text-amari-text-light text-center mb-7">
            60 min · in person or virtual
          </p>

          {/* What's in the session */}
          <ul className="space-y-2.5 mb-7">
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">Full assessment with Garrett</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">Your first guided protocol</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span className="font-sans text-amari-charcoal">Take-home practice you can do tonight</span>
            </li>
          </ul>

          {/* Path explainer — same logic as the booking page */}
          <div className="bg-white rounded-lg p-5 mb-6 border border-amari-border">
            <p className="text-xs uppercase tracking-widest font-semibold font-sans text-amari-pine-teal mb-3">
              How the path works
            </p>
            <ol className="space-y-2.5 text-sm text-amari-charcoal font-sans leading-relaxed">
              <li><span className="font-semibold">Today:</span> Book your first session — $225.</li>
              <li><span className="font-semibold">After session 1:</span> Decide whether to continue. No pressure.</li>
              <li><span className="font-semibold">Before session 2:</span> If you continue, upgrade for the difference — your $225 counts toward the 4-pack (+$495) or 8-pack (+$1,070).</li>
            </ol>
          </div>

          {/* Guarantee */}
          <p className="text-sm text-amari-text-light font-sans text-center mb-6 leading-relaxed">
            <strong className="text-amari-charcoal">Satisfaction guaranteed.</strong> If you don't experience noticeable relief, we keep working with you until you do, at no additional charge.
          </p>

          {/* Referral pill (existing logic) */}
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

          {/* Booking buttons */}
          <div className="flex gap-3" style={{ width: '100%' }}>
            <a
              href={buildBookingUrl("/book-initial-in-person", painLocation)}
              className={`${remotePreferred ? 'btn-secondary' : 'btn-primary'} text-center`}
              style={{ flex: 1, display: 'block', order: remotePreferred ? 2 : 1 }}
            >
              <span>Book In-Person<span className="arrow">→</span></span>
            </a>
            <a
              href={buildBookingUrl("/book-initial-virtual", painLocation)}
              className={`${remotePreferred ? 'btn-primary' : 'btn-secondary'} text-center`}
              style={{ flex: 1, display: 'block', order: remotePreferred ? 1 : 2 }}
            >
              <span>Book Virtual<span className="arrow">→</span></span>
            </a>
          </div>
          <p className="text-sm text-amari-text-light mt-3 text-center font-sans">
            {remotePreferred
              ? 'Virtual from anywhere · In-person available if you visit SF'
              : 'San Francisco in-person or virtual from anywhere'}
          </p>
        </div>

        {/* Testimonial — pain-location-matched. Falls back to Sarah's
            back-pain quote for locations without a specific match
            (handled in conditionContent.ts → TESTIMONIAL_BY_LOCATION). */}
        {testimonial ? (
          <div className="bg-white p-8 rounded-xl shadow-md border border-amari-border mb-10">
            <div className="flex gap-1 mb-4 justify-center">
              {[...Array(5)].map((_, i) => <StarIcon key={i} />)}
            </div>
            <p className="text-lg text-amari-charcoal italic mb-4 text-center font-sans leading-relaxed">
              "{testimonial.quote}"
            </p>
            <p className="text-sm text-amari-text-light text-center font-medium font-sans">
              — {testimonial.name} · {testimonial.attribution}
            </p>
          </div>
        ) : null}

        {/* Discovery call secondary CTA */}
        <div className="text-center border-t border-amari-border pt-8">
          <p className="text-lg text-amari-charcoal font-semibold mb-4 font-sans">
            {referralName ? 'Have questions? Book a free discovery call' : 'Not ready to book? Start with a free call'}
          </p>
          <a
            href={buildBookingUrl("/book-discovery-call", painLocation)}
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
