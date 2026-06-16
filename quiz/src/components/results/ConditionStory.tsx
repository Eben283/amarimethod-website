// Pain-location-specific story for the results page.
//
// Lifts the "why your X keeps hurting" + "where X actually comes from"
// blocks from the live condition pages (Garrett-approved copy) and shows
// them on the quiz result, scoped to the visitor's Q0 answer. This is
// what makes the diagnosis actually different per visitor — back-pain
// person and knee-pain person now see different cards, different chain
// explanations.
//
// Falls back to a generic block for pain locations without a condition
// page (upper back, ankles/feet, wrists/hands, elbows).

import React from 'react';
import { ConditionContent } from '@/lib/conditionContent';

type Props = {
  content: ConditionContent;
};

const ConditionStory = ({ content }: Props) => {
  const stepCount = content.chainSteps.length;

  return (
    <section className="px-6 py-14 bg-amari-bone-white border-t border-amari-border">
      <div className="max-w-5xl mx-auto">

        {/* ─── WHY YOUR X KEEPS HURTING ─── */}
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <p className="text-xs uppercase tracking-widest font-semibold font-sans text-amari-pine-teal mb-3">
            Why it keeps hurting
          </p>
          <h2 className="text-3xl md:text-4xl font-serif text-amari-charcoal leading-tight mb-3">
            {content.whyHeading}
          </h2>
          <p className="text-base font-sans text-amari-text-light leading-relaxed">
            {content.whySubline}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
          {content.whyCards.map((card) => (
            <div key={card.num} className="bg-white border border-amari-border rounded-xl p-6">
              <div
                className="font-serif text-3xl mb-3"
                style={{ color: '#C56B4E', fontStyle: 'italic', fontWeight: 300 }}
              >
                {card.num}
              </div>
              <h3 className="font-serif text-lg text-amari-charcoal mb-3 leading-snug">
                {card.title}
              </h3>
              <p className="text-sm font-sans text-amari-text-light leading-relaxed">
                {card.body}
              </p>
            </div>
          ))}
        </div>

        {/* ─── PROTOCOL INTRO VIDEO ─── */}
        {/* Garrett introduces the protocol that matches this pain pattern. The
            actual exercise demo lives in the $225 session or Living Practice —
            this is the framing-only intro, builds appetite without satiating. */}
        {content.protocolIntro ? (
          <div className="mb-16">
            <div className="text-center mb-6 max-w-2xl mx-auto">
              <p className="text-xs uppercase tracking-widest font-semibold font-sans text-amari-pine-teal mb-3">
                A taste of the work
              </p>
              <h2 className="text-3xl md:text-4xl font-serif text-amari-charcoal leading-tight mb-3">
                {content.protocolIntro.name}
              </h2>
              <p className="text-base md:text-lg font-serif italic text-amari-text-light leading-relaxed">
                {content.protocolIntro.framingLine}
              </p>
            </div>

            <div className="max-w-3xl mx-auto rounded-xl overflow-hidden bg-black border border-amari-border shadow-lg">
              <video
                src={content.protocolIntro.introVideoUrl}
                controls
                preload="metadata"
                playsInline
                className="w-full h-auto block"
                style={{ aspectRatio: '16 / 9' }}
              />
            </div>

            <p className="text-center mt-4 text-xs font-sans uppercase tracking-widest text-amari-text-light">
              {content.protocolIntro.durationLabel} · Garrett introducing the protocol
            </p>

            <p className="text-center mt-6 text-sm font-sans text-amari-text-light max-w-xl mx-auto leading-relaxed">
              The actual hands-on guidance lives in your first session, where Garrett adapts the protocol to your specific body. <a href="#booking-cta" className="text-amari-charcoal underline underline-offset-4 decoration-amari-border hover:decoration-amari-pine-teal transition-colors">See what session 1 covers ↓</a>
            </p>
          </div>
        ) : null}

        {/* ─── WHERE IT ACTUALLY COMES FROM ─── */}
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <p className="text-xs uppercase tracking-widest font-semibold font-sans text-amari-pine-teal mb-3">
            The pattern
          </p>
          <h2 className="text-3xl md:text-4xl font-serif text-amari-charcoal leading-tight mb-3">
            {content.chainHeading}
          </h2>
          <p className="text-base font-sans text-amari-text-light leading-relaxed">
            {content.chainSubline}
          </p>
        </div>

        <div
          className={`grid grid-cols-1 ${stepCount === 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'} gap-0 border-t border-amari-charcoal`}
        >
          {content.chainSteps.map((step, i) => (
            <div
              key={step.num}
              className={`p-6 md:p-8 flex flex-col gap-3 ${i < stepCount - 1 ? 'md:border-r border-amari-border' : ''} ${i > 0 ? 'border-t md:border-t-0' : ''} border-amari-border`}
            >
              <div
                className="font-serif text-4xl"
                style={{ color: '#C56B4E', fontStyle: 'italic', fontWeight: 300, lineHeight: 1 }}
              >
                {step.num}
              </div>
              <div
                className="font-mono text-[10px] tracking-widest uppercase text-amari-text-light"
                style={{ letterSpacing: '0.14em' }}
              >
                {step.flow}
              </div>
              <h3 className="font-serif text-lg text-amari-charcoal leading-snug">
                {step.title}
              </h3>
              <p className="text-sm font-sans text-amari-text-light leading-relaxed mt-auto">
                {step.body}
              </p>
            </div>
          ))}
        </div>

        {/* Optional link to full condition page for visitors who want depth */}
        {content.conditionPageSlug ? (
          <p className="text-center mt-10 text-sm font-sans text-amari-text-light">
            Want the full breakdown?{' '}
            <a
              href={`https://www.amarimethod.com/${content.conditionPageSlug}`}
              className="text-amari-charcoal underline underline-offset-4 decoration-amari-border hover:decoration-amari-pine-teal transition-colors"
            >
              Read the full {content.displayName.toLowerCase()} page →
            </a>
          </p>
        ) : null}

      </div>
    </section>
  );
};

export default ConditionStory;
