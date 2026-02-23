import React from 'react';
import { ScoreCategories } from '@/types/quiz';

type ScoreRadarProps = {
  scores: ScoreCategories;
};

const axes = [
  { key: 'softTissueTension' as keyof ScoreCategories, label: 'Soft Tissue', shortLabel: 'Active' },
  { key: 'jointBoneAlignment' as keyof ScoreCategories, label: 'Joint & Bone', shortLabel: 'Passive' },
  { key: 'patternDuration' as keyof ScoreCategories, label: 'Duration', shortLabel: 'Duration' },
  { key: 'dailyActivitiesImpact' as keyof ScoreCategories, label: 'Daily Impact', shortLabel: 'Impact' },
  { key: 'bodyAdaptations' as keyof ScoreCategories, label: 'Adaptations', shortLabel: 'Adapt.' },
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
  // Start at top (-90°), go clockwise every 60°
  return toRadians(-90 + index * 60);
}

function polarPoint(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const { x, y } = polarPoint(cx, cy, r, axisAngle(i));
    return `${x},${y}`;
  }).join(' ');
}

const ScoreRadar = ({ scores }: ScoreRadarProps) => {
  // Data polygon
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
    <section className="px-6 py-10 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-serif text-amari-charcoal mb-2">
            Your Pattern Profile
          </h2>
          <p className="text-base text-amari-text-light font-sans max-w-xl mx-auto">
            How each dimension of your pain pattern scores across all six categories.
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
          {/* SVG Radar */}
          <div className="flex-shrink-0 w-full max-w-xs mx-auto md:mx-0">
            <svg
              viewBox="0 0 320 320"
              className="w-full h-auto"
              overflow="visible"
              aria-label="Pain pattern radar chart"
            >
              {/* Grid hexagons */}
              {gridLevels.map((level) => (
                <polygon
                  key={level}
                  points={hexPoints(CX, CY, (level / 100) * MAX_R)}
                  fill="none"
                  stroke="#e5e7eb"
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
                    stroke="#e5e7eb"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Data polygon fill */}
              <polygon
                points={dataPoints}
                fill="#EBA584"
                fillOpacity="0.25"
                stroke="#EBA584"
                strokeWidth="2.5"
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
                    r="4.5"
                    fill="#EBA584"
                    stroke="white"
                    strokeWidth="1.5"
                  />
                );
              })}

              {/* Axis labels */}
              {axes.map(({ shortLabel }, i) => {
                const angle = axisAngle(i);
                const { x, y } = polarPoint(CX, CY, LABEL_R, angle);
                // Adjust text-anchor based on position
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
                    fontSize="10.5"
                    fill="#718096"
                    fontFamily="sans-serif"
                    fontWeight="500"
                  >
                    {shortLabel}
                  </text>
                );
              })}

              {/* Grid level labels (25, 50, 75) at top axis */}
              {[25, 50, 75].map((level) => {
                const { x, y } = polarPoint(CX, CY, (level / 100) * MAX_R - 2, axisAngle(0));
                return (
                  <text
                    key={level}
                    x={x + 6}
                    y={y}
                    fontSize="8"
                    fill="#9ca3af"
                    fontFamily="sans-serif"
                    dominantBaseline="middle"
                  >
                    {level}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Score legend */}
          <div className="flex-1 w-full">
            <div className="space-y-3">
              {axes.map(({ key, label }) => {
                const score = scores[key] as number;
                const isRecovery = key === 'recoveryPotential';
                const isSystem = key === 'softTissueTension' || key === 'jointBoneAlignment';

                let barColor = '#EBA584';
                let scoreLabel = '';

                if (isSystem) {
                  barColor = score >= 75 ? '#6b7280' : score >= 50 ? '#9ca3af' : '#d1d5db';
                  scoreLabel = score >= 75 ? 'High' : score >= 50 ? 'Moderate' : 'Low';
                } else if (isRecovery) {
                  barColor = score >= 75 ? '#4ade80' : score >= 60 ? '#EBA584' : score >= 45 ? '#f97316' : '#ef4444';
                  scoreLabel = score >= 75 ? 'Strong' : score >= 60 ? 'Good' : score >= 45 ? 'Moderate' : 'Limited';
                } else {
                  barColor = score < 35 ? '#4ade80' : score < 60 ? '#EBA584' : score < 80 ? '#f97316' : '#ef4444';
                  scoreLabel = score < 35 ? 'Minimal' : score < 60 ? 'Moderate' : score < 80 ? 'Significant' : 'High';
                }

                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-sans font-medium text-amari-charcoal">{label}</span>
                      <span className="text-xs font-sans text-amari-text-light">
                        {scoreLabel} &nbsp;·&nbsp; {score}%
                      </span>
                    </div>
                    <div className="w-full bg-amari-oat rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${score}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ScoreRadar;
