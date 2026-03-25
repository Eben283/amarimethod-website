import type { QuizResults as QuizResultsType } from '../types/staff';

interface Props {
  results: QuizResultsType;
}

export default function QuizResults({ results }: Props) {
  const score = results.recoveryPotentialScore
    ? parseInt(String(results.recoveryPotentialScore), 10)
    : null;

  const scoreColor = score !== null
    ? score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600'
    : '';

  const items = [
    { label: 'Location', value: results.primaryPainLocation },
    { label: 'Trigger', value: results.painTrigger },
    { label: 'Duration', value: results.painDuration },
    { label: 'Intensity', value: results.painIntensity },
    { label: 'Pain Type', value: results.painType },
    { label: 'Additional Areas', value: results.additionalPainAreas },
    { label: 'Makes It Worse', value: results.aggravatingActivities },
    { label: 'Daily Impact', value: results.dailyImpact },
    { label: 'Treatments Tried', value: results.treatmentsTried },
    { label: 'Treatment Results', value: results.treatmentResults },
  ].filter(item => item.value);

  return (
    <div className="staff-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-amari-charcoal">Pain Assessment</h3>
        {results.patternSignature && (
          <span className="text-xs font-medium bg-amari-light-sand px-2 py-1 rounded-full">
            {results.patternSignature}
          </span>
        )}
      </div>

      {score !== null && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-amari-text-muted">Recovery Potential</span>
            <span className={`font-medium ${scoreColor}`}>{score}%</span>
          </div>
          <div className="h-1.5 bg-amari-light-sand rounded-full overflow-hidden">
            <div
              className="h-full bg-amari-accent-warm rounded-full"
              style={{ width: `${Math.min(score, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {items.map(({ label, value }) => (
          <div key={label} className="flex text-xs">
            <span className="text-amari-text-muted w-28 flex-shrink-0">{label}</span>
            <span className="text-amari-charcoal">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
