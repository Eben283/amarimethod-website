import React from 'react';

type ScoreCardProps = {
  title: string;
  subtitle?: string;
  score: number;
  description: string;
  compact?: boolean;
};

// Editorial palette — no green/blue/purple status colors. Score severity is
// communicated via the word label (Minimal / Mild / Moderate / Significant),
// not via a chromatic system.
const PALETTE = {
  ink: '#1F1D1A',
  ink2: '#3A3733',
  mute: '#7A746B',
  line: '#E0D7C2',
  accent: '#C56B4E',
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 14,
  },
  title: {
    fontFamily: 'var(--sans)',
    fontSize: 20,
    fontWeight: 300,
    letterSpacing: '-0.02em',
    lineHeight: 1.15,
    color: PALETTE.ink,
  },
  titleCompact: {
    fontFamily: 'var(--sans)',
    fontSize: 16,
    fontWeight: 300,
    letterSpacing: '-0.015em',
    color: PALETTE.ink,
  },
  subtitle: {
    fontFamily: 'var(--sans)',
    fontSize: 10,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: PALETTE.mute,
    marginTop: 4,
  },
  scoreNum: {
    fontFamily: 'var(--sans)',
    fontSize: 36,
    fontWeight: 300,
    fontStyle: 'normal',
    color: PALETTE.ink,
    lineHeight: 1,
  },
  scoreNumCompact: {
    fontFamily: 'var(--sans)',
    fontSize: 24,
    fontWeight: 300,
    fontStyle: 'normal',
    color: PALETTE.ink,
    lineHeight: 1,
  },
  bar: {
    height: 2,
    width: '100%',
    background: PALETTE.line,
    overflow: 'hidden',
    margin: '6px 0 10px',
  },
  barFill: {
    height: '100%',
    background: PALETTE.accent,
    transition: 'width 700ms ease-out',
  },
  category: {
    fontFamily: 'var(--sans)',
    fontSize: 10,
    letterSpacing: '0.24em',
    textTransform: 'uppercase',
    color: PALETTE.accent,
  },
  desc: {
    fontFamily: 'var(--sans)',
    fontSize: 14,
    lineHeight: 1.55,
    color: PALETTE.ink2,
  },
};

const ScoreCard = ({ title, subtitle, score, description, compact = false }: ScoreCardProps) => {
  // Category label
  let categoryText = '';
  if (score < 25) categoryText = 'Minimal';
  else if (score < 50) categoryText = 'Mild';
  else if (score < 75) categoryText = 'Moderate';
  else categoryText = 'Significant';

  if (compact) {
    return (
      <div style={styles.card}>
        <div style={styles.head}>
          <span style={styles.titleCompact}>{title}</span>
          <span style={styles.scoreNumCompact}>{score}%</span>
        </div>
        <div style={styles.bar}>
          <div style={{ ...styles.barFill, width: `${score}%` }} />
        </div>
        <span style={styles.category}>{categoryText}</span>
        <p style={styles.desc}>{description}</p>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.head}>
        <div>
          <h3 style={styles.title}>{title}</h3>
          {subtitle ? <p style={styles.subtitle}>{subtitle}</p> : null}
        </div>
        <span style={styles.scoreNum}>{score}%</span>
      </div>
      <div style={styles.bar}>
        <div style={{ ...styles.barFill, width: `${score}%` }} />
      </div>
      <span style={styles.category}>{categoryText}</span>
      <p style={styles.desc}>{description}</p>
    </div>
  );
};

export default ScoreCard;
