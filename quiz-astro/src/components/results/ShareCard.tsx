import React from 'react';
import { PatternSignature } from '@/types/quiz';

type ShareCardProps = {
  patternSignature: PatternSignature;
};

const patternAccents: Record<PatternSignature, { bg: string; text: string }> = {
  'Protective Tension':    { bg: '#fef3c7', text: '#92400e' },
  'Structural Adaptation': { bg: '#dbeafe', text: '#1e40af' },
  'Established Pattern':   { bg: '#f3e8ff', text: '#7e22ce' },
  'Functional Limitation': { bg: '#ffe4e6', text: '#9f1239' },
  'Compensatory Movement': { bg: '#ccfbf1', text: '#134e4a' },
};

// All styles are inline so html2canvas renders them reliably without needing to
// resolve external stylesheets or Tailwind classes.
const ShareCard = React.forwardRef<HTMLDivElement, ShareCardProps>(
  ({ patternSignature }, ref) => {
    const accent = patternAccents[patternSignature];

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
          fontFamily: 'ABC Diatype, Arial, sans-serif',
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

        {/* Main row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flex: 1 }}>

          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingRight: '60px' }}>
            {/* Brand label */}
            <p style={{
              fontFamily: 'ABC Diatype, Arial, sans-serif',
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
              fontFamily: 'ABC Diatype, Arial, sans-serif',
              fontSize: '54px',
              fontWeight: '700',
              color: '#f9fafb',
              lineHeight: '1.1',
              margin: '0 0 36px 0',
            }}>
              Amari<br />Assessment
            </h1>

            {/* Pattern badge */}
            <span style={{
              display: 'inline-block',
              padding: '10px 24px',
              borderRadius: '100px',
              background: accent.bg,
              color: accent.text,
              fontFamily: 'ABC Diatype, Arial, sans-serif',
              fontSize: '20px',
              fontWeight: '600',
              alignSelf: 'flex-start',
            }}>
              {patternSignature}
            </span>
          </div>

          {/* Right column */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            paddingTop: '20px',
          }}>
            <p style={{
              fontFamily: 'ABC Diatype, Arial, sans-serif',
              fontSize: '25px',
              color: '#f9fafb',
              margin: 0,
              lineHeight: '1.25',
              maxWidth: '240px',
              textAlign: 'right',
            }}>
              A starting point for what changes in person.
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
            fontFamily: 'ABC Diatype, Arial, sans-serif',
            fontSize: '14px',
            color: '#4b5563',
            margin: 0,
          }}>
            Explore Amari at
          </p>
          <p style={{
            fontFamily: 'ABC Diatype, Arial, sans-serif',
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
