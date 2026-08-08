import React from 'react';
import { ScoreCategories } from '@/types/quiz';

type ScoreRadarProps = {
  scores: ScoreCategories;
};

// Editorial palette
const PALETTE = {
  ink: '#1F1D1A',
  ink2: '#3A3733',
  mute: '#7A746B',
  paper: '#F7F2E8',
  paper2: '#F0E9D8',
  line: '#E0D7C2',
  line2: '#CCC1A8',
  accent: '#C56B4E',
};

const axes = [
  { key: 'softTissueTension' as keyof ScoreCategories, label: 'Soft Tissue', shortLabel: 'Soft Tissue' },
  { key: 'jointBoneAlignment' as keyof ScoreCategories, label: 'Joint & Bone', shortLabel: 'Joint / Bone' },
  { key: 'patternDuration' as keyof ScoreCategories, label: 'Duration', shortLabel: 'Duration' },
  { key: 'dailyActivitiesImpact' as keyof ScoreCategories, label: 'Daily Impact', shortLabel: 'Impact' },
  { key: 'bodyAdaptations' as keyof ScoreCategories, label: 'Adaptations', shortLabel: 'Adaptations' },
  { key: 'recoveryPotential' as keyof ScoreCategories, label: 'Recovery', shortLabel: 'Recovery' },
];

const CX = 160;
const CY = 160;
const MAX_R = 110;
const LABEL_R = MAX_R + 28;

function toRadians(deg: number) {
  return (deg * Math.PI) / 180;
}

function axisAngle(index: number) {
  return toRadians(-90 + index * 60);
}

function polarPoint(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: '0' },
  body: { display: 'grid', gridTemplateColumns: '1fr', gap: 32, alignItems: 'center' },
  bodyRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 360px) 1fr', gap: 48, alignItems: 'center' },
  radarOuter: {
    border: `1px dotted ${PALETTE.line2}`,
    padding: 18,
    background: PALETTE.paper2,
    width: '100%',
  },
  legend: { display: 'flex', flexDirection: 'column', gap: 14 },
  legendRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  legendHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  legendLabel: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 10.5,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: PALETTE.ink2,
  },
  legendVal: {
    fontFamily: "'Bona Nova', Georgia, serif",
    fontSize: 16,
    fontStyle: 'normal',
    color: PALETTE.ink,
    fontWeight: 400,
  },
  bar: {
    height: 2,
    width: '100%',
    background: PALETTE.line,
    position: 'relative',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: PALETTE.accent,
    transition: 'width 700ms ease-out',
  },
};

const ScoreRadar = ({ scores }: ScoreRadarProps) => {
  const dataPoints = axes
    .map(({ key }, i) => {
      const score = scores[key] as number;
      const r = (score / 100) * MAX_R;
      const { x, y } = polarPoint(CX, CY, r, axisAngle(i));
      return `${x},${y}`;
    })
    .join(' ');

  const gridLevels = [25, 50, 75, 100];

  return (
    <div style={styles.wrap}>
      <div className="section-head" style={{ paddingTop: 0 }}>
        <span className="eyebrow">Pattern profile</span>
        <h2>Plotted on six dimensions.</h2>
        <p className="lede">How your readings distribute across the axes the instrument measures.</p>
      </div>

      <div style={styles.body}>
        <div style={styles.bodyRow} className="radar-grid">
          {/* SVG radar */}
          <div style={styles.radarOuter}>
            <svg
              viewBox="0 0 320 320"
              style={{ width: '100%', height: 'auto', display: 'block' }}
              overflow="visible"
              aria-label="Pain pattern radar chart"
            >
              {/* Grid hexagons */}
              {gridLevels.map((level) => (
                <polygon
                  key={level}
                  points={axes
                    .map((_, i) => {
                      const { x, y } = polarPoint(CX, CY, (level / 100) * MAX_R, axisAngle(i));
                      return `${x},${y}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke={PALETTE.line2}
                  strokeWidth="1"
                />
              ))}

              {/* Axis lines */}
              {axes.map((_, i) => {
                const end = polarPoint(CX, CY, MAX_R, axisAngle(i));
                return (
                  <line
                    key={i}
                    x1={CX}
                    y1={CY}
                    x2={end.x}
                    y2={end.y}
                    stroke={PALETTE.line2}
                    strokeWidth="1"
                  />
                );
              })}

              {/* Data polygon */}
              <polygon
                points={dataPoints}
                fill={PALETTE.accent}
                fillOpacity="0.18"
                stroke={PALETTE.accent}
                strokeWidth="2"
                strokeLinejoin="round"
              />

              {/* Data dots */}
              {axes.map(({ key }, i) => {
                const score = scores[key] as number;
                const r = (score / 100) * MAX_R;
                const { x, y } = polarPoint(CX, CY, r, axisAngle(i));
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r="4"
                    fill={PALETTE.accent}
                    stroke={PALETTE.paper}
                    strokeWidth="1.5"
                  />
                );
              })}

              {/* Axis labels */}
              {axes.map(({ shortLabel }, i) => {
                const angle = axisAngle(i);
                const { x, y } = polarPoint(CX, CY, LABEL_R, angle);
                const anchor =
                  Math.cos(angle) > 0.3
                    ? 'start'
                    : Math.cos(angle) < -0.3
                    ? 'end'
                    : 'middle';

                return (
                  <text
                    key={i}
                    x={x}
                    y={y}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    fontSize="9"
                    fill={PALETTE.mute}
                    fontFamily="JetBrains Mono, monospace"
                    letterSpacing="1.5"
                  >
                    {shortLabel.toUpperCase()}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Legend */}
          <div style={styles.legend}>
            {axes.map(({ key, label }) => {
              const score = scores[key] as number;
              return (
                <div key={key} style={styles.legendRow}>
                  <div style={styles.legendHead}>
                    <span style={styles.legendLabel}>{label}</span>
                    <span style={styles.legendVal}>{score}%</span>
                  </div>
                  <div style={styles.bar}>
                    <div style={{ ...styles.barFill, width: `${score}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 720px) {
          [data-results] .radar-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
        }
      `}} />
    </div>
  );
};

export default ScoreRadar;
