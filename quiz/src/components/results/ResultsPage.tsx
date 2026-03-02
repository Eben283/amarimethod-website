import React, { useRef } from 'react';
import { ScoreCategories, PatternSignature, QuizInsight } from '@/types/quiz';
import ResultsHero from './ResultsHero';
import ScoreCard from './ScoreCard';
import ScoreRadar from './ScoreRadar';
import InsightCards from './InsightCards';
import BookingCTA from './BookingCTA';
import ShareCard from './ShareCard';
import { useShareResults } from '@/hooks/useShareResults';

type ResultsPageProps = {
  firstName: string;
  patternSignature: PatternSignature;
  scores: ScoreCategories;
  insights: QuizInsight[];
};

const Divider = () => (
  <div className="max-w-3xl mx-auto px-6">
    <hr className="border-amari-oat" />
  </div>
);

const ResultsPage = ({ firstName, patternSignature, scores, insights }: ResultsPageProps) => {
  const shareCardRef = useRef<HTMLDivElement>(null);
  const { share, state: shareState } = useShareResults(shareCardRef);

  const shareButtonLabel =
    shareState === 'capturing' ? 'Creating image…'
    : shareState === 'sharing'  ? 'Opening share sheet…'
    : shareState === 'downloaded' ? 'Image saved to Downloads'
    : shareState === 'error'    ? 'Something went wrong'
    : 'Share Your Results';

  return (
    <div className="bg-amari-bone-white font-sans text-amari-charcoal">

      {/* Off-screen share card — captured by html2canvas on share click */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        <ShareCard ref={shareCardRef} patternSignature={patternSignature} scores={scores} />
      </div>

      {/* 1 — Hero: pattern badge + recovery ring */}
      <ResultsHero
        firstName={firstName}
        patternSignature={patternSignature}
        scores={scores}
      />

      {/* Share strip */}
      <section className="px-6 py-5 bg-amari-bone-white text-center">
        <button
          onClick={share}
          disabled={shareState === 'capturing' || shareState === 'sharing'}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-amari-border text-sm font-medium text-amari-charcoal bg-white hover:bg-amari-light-sand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {/* Share icon */}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          {shareButtonLabel}
        </button>
        <p className="text-xs text-amari-text-light mt-2 font-sans">
          Save or share your pattern card
        </p>
      </section>

      <Divider />

      {/* 2 — Personalized insights (what we discovered) */}
      <InsightCards insights={insights} />

      <Divider />

      {/* 3 — CTA: booking + testimonial (early placement for high-intent visitors) */}
      <BookingCTA patternSignature={patternSignature} />

      <Divider />

      {/* 4 — Radar chart + score bars */}
      <ScoreRadar scores={scores} />

      <Divider />

      {/* 5 — Primary score cards (Active / Passive systems) */}
      <section className="px-6 py-10 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-serif text-amari-charcoal mb-2">
              The Balance Equation
            </h2>
            <p className="text-base text-amari-text-light font-sans max-w-xl mx-auto">
              Pain emerges when some parts work <strong className="text-amari-pine-teal">too hard</strong> because
              other parts aren't working <strong className="text-amari-pine-teal">enough</strong>. This is the
              definition of imbalance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <ScoreCard
              title="Active System"
              subtitle="Muscles & Tendons"
              score={scores.softTissueTension}
              description="Your muscular system works to provide active support and protection. Higher scores indicate your muscles are working overtime to create stability."
            />
            <ScoreCard
              title="Passive System"
              subtitle="Bones & Ligaments"
              score={scores.jointBoneAlignment}
              description="Your skeletal system provides your structural foundation. Higher scores suggest alignment adaptations that affect how force transfers through your body."
            />
          </div>

          {/* Secondary scores — 3-column compact grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ScoreCard
              title="Pattern Duration"
              score={scores.patternDuration}
              description="How long your pattern has been developing affects how established it is in your nervous system."
              compact
            />
            <ScoreCard
              title="Daily Impact"
              score={scores.dailyActivitiesImpact}
              description="How your pain affects your daily activities reveals functional limitations and compensations."
              compact
            />
            <ScoreCard
              title="Body Adaptations"
              score={scores.bodyAdaptations}
              description="The degree to which your body has developed compensatory strategies around pain."
              compact
            />
          </div>

          {/* Bottom booking prompt */}
          <div className="mt-10 text-center">
            <p className="text-base font-sans text-amari-charcoal font-semibold mb-4">
              Ready to address your pattern?
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <a
                href="https://amarimethodbooking.amarimethod.com/amari-method-funnel"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                <span>Book In-Person<span className="arrow">→</span></span>
              </a>
              <a
                href="https://introsessionvirtual.amarimethod.com/is-virtual-info"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                <span>Book Virtual<span className="arrow">→</span></span>
              </a>
            </div>
            <p className="text-sm text-amari-text-light mt-3 font-sans">
              San Francisco in-person or virtual from anywhere · HSA/FSA accepted
            </p>
          </div>
        </div>
      </section>

    </div>
  );
};

export default ResultsPage;
