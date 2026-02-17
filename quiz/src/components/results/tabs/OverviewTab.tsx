
import React from 'react';
import { ScoreCategories, PatternSignature } from '@/types/quiz';
import ScoreCard from '../ScoreCard';

type OverviewTabProps = {
  patternSignature: PatternSignature;
  scores: ScoreCategories;
};

const OverviewTab = ({ patternSignature, scores }: OverviewTabProps) => {
  const getPatternDescription = (pattern: PatternSignature): string => {
    switch (pattern) {
      case 'Protective Tension':
        return 'Your body is using muscular tension to create stability and protection. This is a sign your body is working to support areas it perceives as vulnerable.';
      case 'Structural Adaptation':
        return 'Your skeletal system has adapted its alignment to reduce stress on certain areas. These changes in bone and joint positioning create their own patterns over time.';
      case 'Established Pattern':
        return 'Your pain pattern has become established in your nervous system over time. The duration suggests your brain and body have created strong neural pathways.';
      case 'Functional Limitation':
        return 'Your pain is significantly affecting your daily activities. These limitations create additional adaptation patterns as your body finds workarounds.';
      case 'Compensatory Movement':
        return 'Your body has developed compensatory movement patterns to work around areas of pain or discomfort. These alternative movement strategies create their own stress.';
      default:
        return 'Your individual pain pattern reveals important clues about how your body is adapting to stress and movement challenges.';
    }
  };

  return (
    <div className="px-6 py-8 bg-amari-bone-white">
      {/* Pattern Signature Header */}
      <div className="text-center mb-12 max-w-3xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-serif mb-6 text-amari-charcoal">
          Your Pattern Signature: <br className="md:hidden" />
          <span className="text-amari-pine-teal">{patternSignature}</span>
        </h2>
        <p className="text-lg font-sans text-amari-text-light leading-relaxed">
          {getPatternDescription(patternSignature)}
        </p>
      </div>

      {/* Primary Systems */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-12 max-w-5xl mx-auto">
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

      {/* The Balance Equation - Enhanced */}
      <div className="max-w-4xl mx-auto mb-12">
        <div className="bg-gradient-to-br from-amari-light-sand to-amari-oat p-8 md:p-10 rounded-xl shadow-lg border-2 border-amari-pine-teal text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <svg className="w-8 h-8 text-amari-pine-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
            <h3 className="text-2xl md:text-3xl font-serif text-amari-charcoal">The Balance Equation</h3>
          </div>

          <p className="text-lg font-sans text-amari-charcoal leading-relaxed">
            Pain and dysfunction are actually signs that your body is working for you... some parts are working <strong className="text-amari-pine-teal">too hard</strong> BECAUSE other parts aren't working <strong className="text-amari-pine-teal">enough</strong>.
            <span className="block mt-4 text-xl font-medium">This is the definition of imbalance.</span>
          </p>
        </div>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        <ScoreCard
          title="Pattern Duration"
          score={scores.patternDuration}
          description="How long your pattern has been developing affects how established it is in your nervous system."
          compact
        />
        <ScoreCard
          title="Daily Impact"
          score={scores.dailyActivitiesImpact}
          description="How your pain affects your daily activities reveals functional limitations and adaptations."
          compact
        />
        <ScoreCard
          title="Recovery Potential"
          score={scores.recoveryPotential}
          description="Your body's natural healing capacity based on history, treatments, and other factors."
          compact
        />
      </div>
    </div>
  );
};

export default OverviewTab;
