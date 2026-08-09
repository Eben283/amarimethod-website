import React from 'react';
import { PatternSignature } from '@/types/quiz';

type ResultsHeroProps = {
  /** firstName is accepted to keep the prop contract stable with QuizContainer
   *  but the editorial headline is universal — we don't render it. */
  firstName?: string;
  patternSignature: PatternSignature;
};

const ResultsHero = ({ patternSignature }: ResultsHeroProps) => {
  return (
    <section className="hero-finding doc-narrow">
      {/* Real pattern signature — no roman numerals, no fake confidence */}
      <span className="hero-stamp">
        <span className="glyph">§</span>
        <span>{patternSignature}</span>
      </span>

      <h1 className="hero-headline">
        Your body is working around something.<br />
        It may not need to keep working that way.
      </h1>

      <p className="hero-sub">
        This is a starting read, not a diagnosis. The Assessment is where Garrett can see what is actually present and guide the work with you.
      </p>

      <div className="hero-meta">
        <div className="cell">
          <span className="lbl">Primary observation</span>
          <span className="val">{patternSignature}</span>
        </div>
      </div>
    </section>
  );
};

export default ResultsHero;
