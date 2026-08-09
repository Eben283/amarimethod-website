import React from 'react';
import { QuizInsight } from '@/types/quiz';

type InsightCardsProps = {
  insights: QuizInsight[];
};

// Inline styles keep this component self-contained inside the appendix.
// Editorial palette (paper / ink / accent / mute) — no blue / green / purple.
const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: '0' },
  head: { textAlign: 'center', marginBottom: 32 },
  list: { display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid #E0D7C2' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: 24,
    alignItems: 'baseline',
    padding: '24px 0',
    borderBottom: '1px solid #E0D7C2',
  },
  num: {
    fontFamily: 'var(--sans)',
    fontSize: 11,
    letterSpacing: '0.24em',
    color: '#C56B4E',
    textTransform: 'uppercase',
  },
  body: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: {
    fontFamily: 'var(--sans)',
    fontSize: 22,
    fontWeight: 300,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    color: '#1F1D1A',
  },
  desc: {
    fontFamily: 'var(--sans)',
    fontSize: 15,
    lineHeight: 1.6,
    color: '#3A3733',
  },
};

const InsightCards = ({ insights }: InsightCardsProps) => {
  return (
    <div style={styles.wrap}>
      <div className="section-head" style={{ paddingTop: 0 }}>
        <span className="eyebrow">Personalised insights</span>
        <h2>What we read in your answers.</h2>
        <p className="lede">Patterns specific to the way you answered.</p>
      </div>

      <div style={styles.list}>
        {insights.map((insight, index) => (
          <div key={index} style={styles.row}>
            <span style={styles.num}>{String(index + 1).padStart(2, '0')}</span>
            <div style={styles.body}>
              <h3 style={styles.title}>{insight.title}</h3>
              <p style={styles.desc}>{insight.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InsightCards;
