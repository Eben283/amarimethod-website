interface Props {
  seriesType: string;
  sessionsCompleted: number;
  sessionsRemaining: number;
  tags: string[];
}

export default function SessionStats({ seriesType, sessionsCompleted, sessionsRemaining, tags }: Props) {
  const totalSessions = seriesType === '8-session' ? 8 : seriesType === '4-session' ? 4 : 0;
  const progressPct = totalSessions > 0 ? Math.min(100, ((totalSessions - sessionsRemaining) / totalSessions) * 100) : 0;

  const isPartner = tags.includes('affiliate-partner');

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
          <p className="text-2xl font-serif text-amari-charcoal">{sessionsCompleted}</p>
          <p className="text-xs text-amari-text-muted">Completed</p>
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
    </div>
  );
}
