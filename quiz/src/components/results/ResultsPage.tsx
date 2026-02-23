import React from 'react';
import { ScoreCategories, PatternSignature, QuizInsight } from '@/types/quiz';
import ResultsHero from './ResultsHero';
import ScoreCard from './ScoreCard';
import ScoreRadar from './ScoreRadar';
import InsightCards from './InsightCards';
import BookingCTA from './BookingCTA';

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
  return (
    <div className="bg-amari-bone-white font-sans text-amari-charcoal">

      {/* 1 — Hero: pattern badge + recovery ring */}
      <ResultsHero
        firstName={firstName}
        patternSignature={patternSignature}
        scores={scores}
      />

      <Divider />

      {/* 2 — Personalized insights (what we discovered) */}
      <InsightCards insights={insights} />

      <Divider />

      {/* 3 — Radar chart + score bars */}
      <ScoreRadar scores={scores} />

      <Divider />

      {/* 4 — Primary score cards (Active / Passive systems) */}
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
        </div>
      </section>

      <Divider />

      {/* 5 — CTA: booking + testimonial */}
      <BookingCTA patternSignature={patternSignature} />

    </div>
  );
};

export default ResultsPage;
