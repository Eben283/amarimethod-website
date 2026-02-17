
import React from 'react';

type ScoreCardProps = {
  title: string;
  subtitle?: string;
  score: number;
  description: string;
  compact?: boolean;
};

const ScoreCard = ({
  title,
  subtitle,
  score,
  description,
  compact = false,
}: ScoreCardProps) => {
  // Determine score category text and color
  let categoryText = '';
  let categoryColor = '';

  // Active and Passive systems are neutral (data points, not good/bad)
  const isCompensationSystem = title === 'Active System' || title === 'Passive System';
  const isRecoveryPotential = title === 'Recovery Potential';

  if (score < 25) {
    categoryText = 'Minimal';
    categoryColor = isCompensationSystem ? 'text-gray-600' : 'text-green-600';
  } else if (score < 50) {
    categoryText = 'Mild';
    categoryColor = isCompensationSystem ? 'text-gray-600' : 'text-emerald-600';
  } else if (score < 75) {
    categoryText = 'Moderate';
    categoryColor = isCompensationSystem ? 'text-gray-700' : 'text-amber-600';
  } else {
    categoryText = 'Significant';
    categoryColor = isCompensationSystem ? 'text-gray-800' : 'text-red-600';
  }

  // Progress bar colors:
  // - Recovery Potential: higher is better (green at high scores)
  // - Compensation Systems: neutral gray (just data)
  // - Other scores: lower is better (green at low scores)
  const progressColor = isCompensationSystem
    ? (score < 25 ? 'bg-gray-300' :        // Minimal compensation = light gray
       score < 50 ? 'bg-gray-400' :        // Mild = medium gray
       score < 75 ? 'bg-gray-500' :        // Moderate = darker gray
       'bg-gray-600')                       // Significant = darkest gray
    : isRecoveryPotential
    ? (score >= 75 ? 'bg-green-500' :      // High recovery = green
       score >= 50 ? 'bg-emerald-500' :    // Moderate recovery = teal
       score >= 25 ? 'bg-amber-500' :      // Low recovery = amber
       'bg-red-500')                        // Very low = red
    : (score < 25 ? 'bg-green-500' :       // Low dysfunction = green
       score < 50 ? 'bg-emerald-500' :     // Moderate = teal
       score < 75 ? 'bg-amber-500' :       // High = amber
       'bg-red-500');                       // Very high = red

  return (
    <div className={`bg-white rounded-xl p-6 md:p-8 shadow-md hover:shadow-lg transition-shadow duration-300 border border-amari-border ${compact ? 'text-center' : ''}`}>
      <div className={`${compact ? '' : 'flex justify-between items-start mb-4'}`}>
        <div>
          <h3 className={`font-serif text-xl md:text-2xl mb-1 text-amari-charcoal ${compact ? 'text-center' : ''}`}>
            {title}
          </h3>
          {subtitle && <p className="text-amari-text-light text-sm font-sans">{subtitle}</p>}
        </div>

        {!compact && (
          <div className="text-right">
            <span className={`${categoryColor} font-semibold font-ui`}>{categoryText}</span>
            <span className="text-amari-text-light ml-1">({score}%)</span>
          </div>
        )}
      </div>

      {compact && (
        <div className="text-center mb-4">
          <span className={`${categoryColor} font-semibold font-ui text-lg`}>{categoryText}</span>
          <span className="text-amari-text-light ml-1">({score}%)</span>
        </div>
      )}

      <div className="w-full bg-amari-oat rounded-full h-3 mb-4 overflow-hidden">
        <div
          className={`h-3 rounded-full ${progressColor} transition-all duration-500 ease-out`}
          style={{ width: `${score}%` }}
        ></div>
      </div>

      <p className={`text-amari-text-light text-sm md:text-base font-sans leading-relaxed ${compact ? 'text-center' : ''}`}>
        {description}
      </p>
    </div>
  );
};

export default ScoreCard;
