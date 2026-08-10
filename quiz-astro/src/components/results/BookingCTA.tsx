import React from 'react';
import { useQuiz } from '@/contexts/QuizContext';
import { getConditionContent } from '@/lib/conditionContent';

type BookingCTAProps = {
  /** Builds a booking URL with the visitor's pain location appended as
   *  ?pain=… so booking pages can render the right intro copy. */
  buildBookingUrl: (base: string) => string;
};

const BookingCTA = ({ buildBookingUrl }: BookingCTAProps) => {
  const { answers, referralSource } = useQuiz();
  const painLocation = (answers[0]?.answer as string) || null;
  const conditionContent = getConditionContent(painLocation);
  const testimonial = conditionContent?.matchedTestimonial;
  const referralName = referralSource
    ? referralSource.charAt(0).toUpperCase() + referralSource.slice(1)
    : null;

  return (
    <div id="booking-cta">

      {/* ─── OFFER CARD ─── */}
      <article className="offer">
        <header className="offer-head">
          <span>Amari Assessment · 50 minutes · San Francisco</span>
          <span className="pill">Recommended</span>
        </header>

        <div className="offer-body">
          {/* Left pane — price */}
          <div className="offer-pane">
            <div className="offer-price-num">$29</div>
            <div className="offer-price-lbl">Private, in-person Assessment</div>
            <p className="offer-price-meta">
              Start with an Assessment and experience the work in person.
            </p>
          </div>

          {/* Right pane — what's included + path */}
          <div className="offer-pane">
            <div className="offer-included">
              <span className="eyebrow">What's included</span>
              <ul className="offer-list">
                <li>A focused look at what you are noticing in your body</li>
                <li>One-on-one, hands-on guided movement with Garrett</li>
                <li>Space to experience the work before deciding on a longer practice</li>
              </ul>
            </div>

          </div>
        </div>

        <div className="offer-cta">
          {referralName ? <p className="referral-note">Referred by {referralName}</p> : null}
          <div className="booking-options">
            <a href={buildBookingUrl('/assessment-booking')} className="btn-ink">
              <span>Book your $29 Assessment</span>
              <span className="arrow">→</span>
            </a>
          </div>
          <span className="fine">
            50 minutes · Private · In person in San Francisco
          </span>
        </div>
      </article>

      {/* ─── TESTIMONIAL ─── */}
      {testimonial ? (
        <section className="testimonial">
          <blockquote>
            {testimonial.quote}
          </blockquote>
          <cite>{testimonial.name} · {testimonial.attribution}</cite>
        </section>
      ) : null}

    </div>
  );
};

export default BookingCTA;
