
import React from 'react';

type ScoreCardProps = {
  title: string;
  subtitle?: string;
  score: number;
  description: string;
  compact?: boolean;
};

const ScoreCard = ({ title, subtitle, score, description, compact = false }: ScoreCardProps) => {
  const isCompensationSystem = title === 'Active System' || title === 'Passive System';
  const isRecoveryPotential  = title === 'Recovery Potential';

  // Category label
  let categoryText = '';
  if (score < 25)       categoryText = 'Minimal';
  else if (score < 50)  categoryText = 'Mild';
  else if (score < 75)  categoryText = 'Moderate';
  else                  categoryText = 'Significant';

  // Category label color
  let categoryColor = '';
  if (isCompensationSystem) {
    categoryColor = 'text-gray-600';
  } else if (isRecoveryPotential) {
    categoryColor = score >= 75 ? 'text-green-600' : score >= 50 ? 'text-emerald-600' : score >= 25 ? 'text-amber-600' : 'text-red-600';
  } else {
    categoryColor = score < 25 ? 'text-green-600' : score < 50 ? 'text-emerald-600' : score < 75 ? 'text-amber-600' : 'text-red-600';
  }

  // Progress bar color
  const progressColor = isCompensationSystem
    ? (score < 25 ? 'bg-gray-300' : score < 50 ? 'bg-gray-400' : score < 75 ? 'bg-gray-500' : 'bg-gray-600')
    : isRecoveryPotential
    ? (score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-emerald-500' : score >= 25 ? 'bg-amber-500' : 'bg-red-500')
    : (score < 25 ? 'bg-green-500' : score < 50 ? 'bg-emerald-500' : score < 75 ? 'bg-amber-500' : 'bg-red-500');

  if (compact) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-amari-border hover:shadow-md transition-shadow duration-200">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-serif text-base text-amari-charcoal leading-tight">{title}</h3>
          <span className="text-2xl font-serif font-bold text-amari-charcoal ml-3 leading-none flex-shrink-0">
            {score}%
          </span>
        </div>
        <div className="w-full bg-amari-oat rounded-full h-2 mb-2 overflow-hidden">
          <div className={`h-2 rounded-full ${progressColor} transition-all duration-700 ease-out`}
            style={{ width: `${score}%` }} />
        </div>
        <span className={`text-xs font-semibold font-sans ${categoryColor}`}>{categoryText}</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6 md:p-8 shadow-md hover:shadow-lg transition-shadow duration-200 border border-amari-border">
      {/* Big score number — leads the card */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="font-serif text-xl md:text-2xl text-amari-charcoal mb-0.5">{title}</h3>
          {subtitle && <p className="text-amari-text-light text-sm font-sans">{subtitle}</p>}
        </div>
        <div className="text-right ml-4 flex-shrink-0">
          <span className="text-4xl md:text-5xl font-serif font-bold text-amari-charcoal leading-none block">
            {score}%
          </span>
          <span className={`text-sm font-semibold font-sans ${categoryColor} block mt-0.5`}>
            {categoryText}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-amari-oat rounded-full h-2.5 mb-4 mt-4 overflow-hidden">
        <div className={`h-2.5 rounded-full ${progressColor} transition-all duration-700 ease-out`}
          style={{ width: `${score}%` }} />
      </div>

      <p className="text-amari-text-light text-sm md:text-base font-sans leading-relaxed">
        {description}
      </p>
    </div>
  );
};

export default ScoreCard;
