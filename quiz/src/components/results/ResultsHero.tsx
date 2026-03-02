
import React, { useState, useEffect } from 'react';
import { PatternSignature, ScoreCategories } from '@/types/quiz';

type ResultsHeroProps = {
  firstName: string;
  patternSignature: PatternSignature;
  scores: ScoreCategories;
};

const patternDescriptions: Record<PatternSignature, string> = {
  'Protective Tension':
    'Your body is using muscular tension to create stability and protection around areas it perceives as vulnerable.',
  'Structural Adaptation':
    'Your skeletal system has shifted its alignment to reduce stress—creating its own patterns over time.',
  'Established Pattern':
    'Your pain pattern has had time to become well-practiced. Long-standing patterns often feel inevitable—but the body remains adaptable, and a targeted approach can create real, lasting change.',
  'Functional Limitation':
    'Pain is meaningfully affecting your daily activities, prompting your body to find workarounds.',
  'Compensatory Movement':
    'Your body has developed alternative movement strategies to work around areas of discomfort.',
};

const patternColors: Record<PatternSignature, string> = {
  'Protective Tension':    'bg-amber-100 text-amber-800 border-amber-200',
  'Structural Adaptation': 'bg-blue-100 text-blue-800 border-blue-200',
  'Established Pattern':   'bg-purple-100 text-purple-800 border-purple-200',
  'Functional Limitation': 'bg-rose-100 text-rose-800 border-rose-200',
  'Compensatory Movement': 'bg-teal-100 text-teal-800 border-teal-200',
};

const RecoveryRing = ({ score }: { score: number }) => {
  const r = 54;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;

  // Animate on mount: start at full offset (0% filled), transition to real value
  const [offset, setOffset] = useState(circumference);
  useEffect(() => {
    const id = setTimeout(() => {
      setOffset(circumference * (1 - score / 100));
    }, 120); // short delay so the transition is visible after first paint
    return () => clearTimeout(id);
  }, [score, circumference]);

  const ringColor =
    score >= 75 ? '#4ade80'
    : score >= 60 ? '#EBA584'
    : score >= 45 ? '#f97316'
    : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="11" />
        {/* Animated progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
        {/* Center score */}
        <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle"
          fontSize="22" fontWeight="700" fill="#2d3748" fontFamily="serif">
          {score}%
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
          fontSize="9" fill="#718096" fontFamily="sans-serif" letterSpacing="0.5">
          RECOVERY
        </text>
      </svg>
      <p className="text-xs text-amari-text-light text-center font-sans">Recovery Potential</p>
    </div>
  );
};

const ResultsHero = ({ firstName, patternSignature, scores }: ResultsHeroProps) => {
  const badgeClass = patternColors[patternSignature] ?? 'bg-amari-light-sand text-amari-charcoal border-amari-border';

  return (
    <section className="px-6 pt-10 pb-12 bg-amari-bone-white text-center">
      {/* Social proof chip */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amari-pine-teal bg-opacity-10 rounded-full text-sm text-amari-pine-teal font-medium mb-6">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
        <span>Join 200+ clients who found lasting relief</span>
      </div>

      {/* Headline */}
      <h1 className="text-3xl md:text-4xl font-serif text-amari-charcoal mb-2">
        Your Results Are Ready{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="text-base text-amari-text-light font-sans mb-8 max-w-lg mx-auto">
        Here's your personalized Amari Method pain pattern assessment.
      </p>

      {/* Hero card */}
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg border border-amari-border p-8 md:p-10">
        <div className="flex flex-col md:flex-row items-center gap-8">
          {/* Left: pattern info */}
          <div className="flex-1 text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-amari-text-light font-sans mb-3">
              Your Pattern Signature
            </p>
            <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold border mb-4 ${badgeClass}`}>
              {patternSignature}
            </span>
            <p className="text-base text-amari-charcoal font-sans leading-relaxed">
              {patternDescriptions[patternSignature]}
            </p>
          </div>
          {/* Right: recovery ring */}
          <div className="flex-shrink-0">
            <RecoveryRing score={scores.recoveryPotential} />
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="mt-8 flex flex-col items-center gap-1 text-amari-text-light">
        <p className="text-sm font-sans">Scroll to see your full assessment</p>
        <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
};

export default ResultsHero;
