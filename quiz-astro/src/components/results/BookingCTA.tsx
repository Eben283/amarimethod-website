import React from 'react';
import { PatternSignature } from '@/types/quiz';
import { useQuiz } from '@/contexts/QuizContext';
import { getConditionContent } from '@/lib/conditionContent';

type BookingCTAProps = {
  patternSignature: PatternSignature;
  /** Builds a booking URL with the visitor's pain location appended as
   *  ?pain=… so booking pages can render the right intro copy. */
  buildBookingUrl: (base: string) => string;
};

const BookingCTA = ({ buildBookingUrl }: BookingCTAProps) => {
  const { answers } = useQuiz();
  const painLocation = (answers[0]?.answer as string) || null;
  const conditionContent = getConditionContent(painLocation);
  const testimonial = conditionContent?.matchedTestimonial;

  return (
    <div id="booking-cta">

      {/* ─── OFFER CARD ─── */}
      <article className="offer">
        <header className="offer-head">
          <span>Initial Session · 60 min · In person or virtual</span>
          <span className="pill">Recommended</span>
        </header>

        <div className="offer-body">
          {/* Left pane — price */}
          <div className="offer-pane">
            <div className="offer-price-num">$225</div>
            <div className="offer-price-lbl">One session · No package required</div>
            <p className="offer-price-meta">
              HSA / FSA accepted. Pay for one session — your $225 carries forward if you continue.
            </p>
          </div>

          {/* Right pane — what's included + path */}
          <div className="offer-pane">
            <div className="offer-included">
              <span className="eyebrow">What's included</span>
              <ul className="offer-list">
                <li>Full assessment with Garrett</li>
                <li>Your first guided protocol — most clients feel a shift</li>
                <li>Take-home practice you can do tonight</li>
                <li>Satisfaction guarantee</li>
              </ul>
            </div>

            <div className="offer-path">
              <span className="eyebrow">How the path works</span>
              <div className="row">
                <span className="lbl">Today:</span>
                <span className="body">Book your first session — $225.</span>
              </div>
              <div className="row">
                <span className="lbl">After session 1:</span>
                <span className="body">Decide whether to continue. No pressure.</span>
              </div>
              <div className="row">
                <span className="lbl">Before session 2:</span>
                <span className="body">If you continue, upgrade for the difference — your $225 counts toward the 4-pack (+$495) or 8-pack (+$1,070).</span>
              </div>
            </div>
          </div>
        </div>

        <div className="offer-cta">
          <a
            href={buildBookingUrl('/book/initial-in-person')}
            className="btn-ink"
          >
            <span>Book your session</span>
            <span className="arrow">→</span>
          </a>
          <span className="fine">In person or virtual · HSA / FSA accepted</span>
          <p className="guarantee">
            <b>Satisfaction guaranteed.</b> If you don't experience noticeable relief, we keep working with you until you do, at no additional charge.
          </p>
        </div>
      </article>

      {/* ─── TESTIMONIAL ─── */}
      {testimonial ? (
        <section className="testimonial">
          <blockquote>
            {testimonial.quote}
          </blockquote>
          <cite>— {testimonial.name} · {testimonial.attribution}</cite>
        </section>
      ) : null}

    </div>
  );
};

export default BookingCTA;
