import React from 'react';
import { PatternSignature, ScoreCategories } from '@/types/quiz';

type ResultsHeroProps = {
  /** firstName is accepted to keep the prop contract stable with QuizContainer
   *  but the editorial headline is universal — we don't render it. */
  firstName?: string;
  patternSignature: PatternSignature;
  scores: ScoreCategories;
  /** Pre-computed recovery word (High / Good / Moderate / Limited) — passed
   *  in by ResultsPage so the same word appears in the meta row and any
   *  downstream copy without recalculating. */
  recoveryWord: string;
};

const ResultsHero = ({ patternSignature, scores, recoveryWord }: ResultsHeroProps) => {
  return (
    <section className="hero-finding doc-narrow">
      {/* Real pattern signature — no roman numerals, no fake confidence */}
      <span className="hero-stamp">
        <span className="glyph">§</span>
        <span>{patternSignature}</span>
      </span>

      <h1 className="hero-headline">
        You're not broken.<br />
        You're <em>out of balance.</em>
      </h1>

      <p className="hero-sub">
        Your readings show a body that <em>can rebalance</em> — it just hasn't been given the right input to start.
      </p>

      <div className="hero-meta">
        <div className="cell">
          <span className="lbl">Primary observation</span>
          <span className="val">{patternSignature}</span>
        </div>
        <div className="cell">
          <span className="lbl">Recovery potential</span>
          <span className="val">
            <em>{recoveryWord}</em> · {scores.recoveryPotential}%
          </span>
        </div>
      </div>
    </section>
  );
};

export default ResultsHero;
