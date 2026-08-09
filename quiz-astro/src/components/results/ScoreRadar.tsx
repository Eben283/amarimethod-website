import React from 'react';
import { ScoreCategories } from '@/types/quiz';

type ScoreRadarProps = {
  scores: ScoreCategories;
};

const themes = [
  { key: 'softTissueTension' as keyof ScoreCategories, label: 'Protective tension' },
  { key: 'jointBoneAlignment' as keyof ScoreCategories, label: 'Structural adaptation' },
  { key: 'patternDuration' as keyof ScoreCategories, label: 'Time present' },
  { key: 'dailyActivitiesImpact' as keyof ScoreCategories, label: 'Daily life' },
  { key: 'bodyAdaptations' as keyof ScoreCategories, label: 'Compensatory movement' },
];

const center = 150;
const radius = 92;

const pointAt = (distance: number, index: number) => {
  const angle = (-90 + index * (360 / themes.length)) * (Math.PI / 180);
  return {
    x: center + Math.cos(angle) * distance,
    y: center + Math.sin(angle) * distance,
  };
};

const polygonAt = (distance: number) =>
  themes.map((_, index) => {
    const { x, y } = pointAt(distance, index);
    return `${x},${y}`;
  }).join(' ');

const ScoreRadar = ({ scores }: ScoreRadarProps) => {
  const responsePoints = themes.map(({ key }, index) => {
    const { x, y } = pointAt(Math.max(16, (scores[key] as number) / 100 * radius), index);
    return `${x},${y}`;
  }).join(' ');

  return (
    <section className="response-profile" aria-labelledby="response-profile-heading">
      <div className="section-head" style={{ paddingTop: 0 }}>
        <span className="eyebrow">Answer map</span>
        <h2 id="response-profile-heading">The themes in your answers.</h2>
        <p className="lede">A visual starting point for the Assessment—not a diagnosis.</p>
      </div>

      <div className="response-map-grid">
        <div className="response-map" aria-label="Answer theme map">
          <svg viewBox="0 0 300 300" role="img" aria-labelledby="response-map-title response-map-description">
            <title id="response-map-title">Answer theme map</title>
            <desc id="response-map-description">A five-part visual summary of themes from your quiz answers.</desc>
            {[.38, .69, 1].map((level) => (
              <polygon key={level} points={polygonAt(radius * level)} className="response-map-gridline" />
            ))}
            {themes.map((_, index) => {
              const end = pointAt(radius, index);
              return <line key={index} x1={center} y1={center} x2={end.x} y2={end.y} className="response-map-axis" />;
            })}
            <polygon points={responsePoints} className="response-map-shape" />
            {themes.map(({ key }, index) => {
              const score = scores[key] as number;
              const { x, y } = pointAt(Math.max(16, score / 100 * radius), index);
              return <circle key={key} cx={x} cy={y} r="4.5" className="response-map-point" />;
            })}
          </svg>
        </div>

        <div className="response-map-key">
          {themes.map(({ key, label }) => (
            <div className="response-map-key-row" key={key}>
              <span className="response-map-key-dot" aria-hidden="true" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ScoreRadar;
