interface Props {
  seriesType: string;
  sessionsCompleted: number;
  sessionsRemaining: number;
  tags: string[];
}

export default function SessionStats({ seriesType, sessionsCompleted, sessionsRemaining, tags }: Props) {
  const totalSessions = seriesType === '8-session' ? 8 : seriesType === '4-session' ? 4 : 0;
  const currentSeriesCompleted = totalSessions > 0 ? Math.max(0, totalSessions - sessionsRemaining) : 0;
  const progressPct = totalSessions > 0 ? Math.min(100, (currentSeriesCompleted / totalSessions) * 100) : 0;

  const isPartner = tags.includes('affiliate-partner');
  const isReturning = sessionsCompleted > currentSeriesCompleted;

  return (
    <div className="staff-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-amari-charcoal">Session Progress</h3>
        {isPartner && (
          <span className="text-xs bg-amari-accent-warm-light text-amari-charcoal px-2 py-0.5 rounded-full">
            Partner
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <p className="text-2xl font-serif text-amari-charcoal">{currentSeriesCompleted}</p>
          <p className="text-xs text-amari-text-muted">This Series</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-serif text-amari-charcoal">{sessionsRemaining}</p>
          <p className="text-xs text-amari-text-muted">Remaining</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-serif text-amari-charcoal capitalize">
            {seriesType === 'none' ? '-' : seriesType.replace('-session', '')}
          </p>
          <p className="text-xs text-amari-text-muted">Package</p>
        </div>
      </div>

      {totalSessions > 0 && (
        <div className="h-2 bg-amari-light-sand rounded-full overflow-hidden">
          <div
            className="h-full bg-amari-accent-warm rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {isReturning && (
        <p className="text-xs text-amari-text-muted mt-2 text-center">
          {sessionsCompleted} lifetime sessions
        </p>
      )}
    </div>
  );
}
