import React from 'react';
import { ScoreCategories } from '@/types/quiz';

type ScoreRadarProps = {
  scores: ScoreCategories;
};

const themes = [
  { key: 'softTissueTension' as keyof ScoreCategories, label: 'Protective tension' },
  { key: 'jointBoneAlignment' as keyof ScoreCategories, label: 'Structural adaptation' },
  { key: 'patternDuration' as keyof ScoreCategories, label: 'How long it has been present' },
  { key: 'dailyActivitiesImpact' as keyof ScoreCategories, label: 'Effect on daily life' },
  { key: 'bodyAdaptations' as keyof ScoreCategories, label: 'Compensatory movement' },
];

const ScoreRadar = ({ scores }: ScoreRadarProps) => (
  <section className="response-profile" aria-labelledby="response-profile-heading">
    <div className="section-head" style={{ paddingTop: 0 }}>
      <span className="eyebrow">Response overview</span>
      <h2 id="response-profile-heading">What your answers point to.</h2>
      <p className="lede">A starting point for the Assessment—not a diagnosis.</p>
    </div>

    <div className="response-profile-list">
      {themes.map(({ key, label }) => {
        const score = scores[key] as number;
        return (
          <div className="response-profile-row" key={key}>
            <span>{label}</span>
            <div className="response-profile-track" aria-hidden="true">
              <div className="response-profile-fill" style={{ width: `${score}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  </section>
);

export default ScoreRadar;
