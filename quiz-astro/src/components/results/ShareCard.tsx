import React from 'react';
import { PatternSignature, ScoreCategories } from '@/types/quiz';

type ShareCardProps = {
  patternSignature: PatternSignature;
  scores: ScoreCategories;
};

const patternAccents: Record<PatternSignature, { bg: string; text: string }> = {
  'Protective Tension':    { bg: '#fef3c7', text: '#92400e' },
  'Structural Adaptation': { bg: '#dbeafe', text: '#1e40af' },
  'Established Pattern':   { bg: '#f3e8ff', text: '#7e22ce' },
  'Functional Limitation': { bg: '#ffe4e6', text: '#9f1239' },
  'Compensatory Movement': { bg: '#ccfbf1', text: '#134e4a' },
};

// SVG ring — no CSS animation so html2canvas captures the final state immediately
const StaticRecoveryRing = ({ score }: { score: number }) => {
  const r = 54;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const ringColor =
    score >= 75 ? '#4ade80'
    : score >= 60 ? '#EBA584'
    : '#f97316';

  return (
    <svg width="160" height="160" viewBox="0 0 140 140">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth="11" />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={ringColor}
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle"
        fontSize="22" fontWeight="700" fill="#f9fafb" fontFamily="serif">
        {score}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
        fontSize="9" fill="#9ca3af" fontFamily="sans-serif" letterSpacing="0.5">
        RECOVERY
      </text>
    </svg>
  );
};

// All styles are inline so html2canvas renders them reliably without needing to
// resolve external stylesheets or Tailwind classes.
const ShareCard = React.forwardRef<HTMLDivElement, ShareCardProps>(
  ({ patternSignature, scores }, ref) => {
    const accent = patternAccents[patternSignature];
    const recovery = scores.recoveryPotential;

    return (
      <div
        ref={ref}
        style={{
          width: '1200px',
          height: '630px',
          background: '#1c1c1c',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          fontFamily: 'Georgia, serif',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle decorative circle (top-right) */}
        <div style={{
          position: 'absolute',
          right: '-140px',
          top: '-140px',
          width: '520px',
          height: '520px',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)',
          pointerEvents: 'none',
        }} />

        {/* Main row: text left, ring right */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flex: 1 }}>

          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingRight: '60px' }}>
            {/* Brand label */}
            <p style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '13px',
              fontWeight: '600',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#6b7280',
              margin: '0 0 20px 0',
            }}>
              Amari Method
            </p>

            {/* Headline */}
            <h1 style={{
              fontFamily: 'Georgia, serif',
              fontSize: '54px',
              fontWeight: '700',
              color: '#f9fafb',
              lineHeight: '1.1',
              margin: '0 0 36px 0',
            }}>
              Pain Pattern<br />Report
            </h1>

            {/* Pattern badge */}
            <span style={{
              display: 'inline-block',
              padding: '10px 24px',
              borderRadius: '100px',
              background: accent.bg,
              color: accent.text,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '20px',
              fontWeight: '600',
              alignSelf: 'flex-start',
            }}>
              {patternSignature}
            </span>
          </div>

          {/* Right column: recovery ring */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            paddingTop: '20px',
          }}>
            <StaticRecoveryRing score={recovery} />
            <p style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '13px',
              color: '#9ca3af',
              margin: 0,
              letterSpacing: '0.05em',
            }}>
              Recovery Potential
            </p>
          </div>
        </div>

        {/* Bottom row: URL strip */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid #2d2d2d',
          paddingTop: '24px',
          marginTop: '32px',
        }}>
          <p style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '14px',
            color: '#4b5563',
            margin: 0,
          }}>
            Find your pattern at
          </p>
          <p style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '16px',
            fontWeight: '600',
            color: '#9ca3af',
            margin: 0,
          }}>
            amarimethod.com/quiz
          </p>
        </div>
      </div>
    );
  }
);

ShareCard.displayName = 'ShareCard';

export default ShareCard;
