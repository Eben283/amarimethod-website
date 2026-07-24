import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { getFunnel, getPipeline, type PipelineCard, type PipelineColumns } from '../lib/api';
import { useApiCall } from '../hooks/useApiCall';

const COLUMNS: { id: keyof PipelineColumns; label: string; sub: string }[] = [
  { id: 'touch-1', label: 'Touch 1', sub: '1 outreach' },
  { id: 'touch-2', label: 'Touch 2', sub: '2 outreaches' },
  { id: 'touch-3', label: 'Touch 3', sub: '3 outreaches' },
  { id: 'touch-4', label: 'Touch 4', sub: '4 outreaches' },
  { id: 'touch-5', label: 'Touch 5', sub: '5 outreaches' },
  { id: 'touch-6', label: 'Touch 6+', sub: '6+ outreaches' },
  { id: 'discovery-noshow', label: 'No-Show', sub: 'cancelled / ghosted' },
  { id: 'discovery', label: 'Discovery', sub: 'call attended' },
  { id: 'session-noshow', label: 'Session No-Show', sub: 'initial not attended' },
  { id: 'first-session', label: 'First Session', sub: 'session attended' },
  { id: 'multipack-1', label: 'Pack 1', sub: 'first series' },
  { id: 'multipack-2', label: 'Pack 2+', sub: 'repurchased' },
  { id: 'referred', label: 'Referred', sub: 'sent us a client' },
];

// Column accent colors — warm left→right gradient from cold → loyal client
const COL_COLORS: Record<keyof PipelineColumns, { bg: string; ring: string; dot: string }> = {
  'touch-1': { bg: '#F5F0EB', ring: '#D9CFC5', dot: '#B0A899' },
  'touch-2': { bg: '#F3EDE4', ring: '#D5C9BB', dot: '#A89985' },
  'touch-3': { bg: '#F0E8DC', ring: '#D0C1AE', dot: '#A08B73' },
  'touch-4': { bg: '#EDE3D3', ring: '#CBB99E', dot: '#977C61' },
  'touch-5': { bg: '#E9DCC8', ring: '#C6AF8E', dot: '#8D6D4E' },
  'touch-6': { bg: '#E5D5BC', ring: '#C0A47D', dot: '#855F3B' },
  'discovery-noshow': { bg: '#F5E8E8', ring: '#DEB8B8', dot: '#A04040' },
  'session-noshow': { bg: '#F5E8E8', ring: '#DEB8B8', dot: '#A04040' },
  discovery: { bg: '#EAE0EE', ring: '#C9B5D8', dot: '#8B5DA8' },
  'first-session': { bg: '#E4EEE6', ring: '#B4D3B9', dot: '#4A8C56' },
  'multipack-1': { bg: '#EBE8D8', ring: '#C8C09A', dot: '#8B7A3A' },
  'multipack-2': { bg: '#E8E0C8', ring: '#C4B880', dot: '#8A7020' },
  referred: { bg: '#E8EEF0', ring: '#A8C4CC', dot: '#2E7D92' },
};

function sessionLabel(card: PipelineCard): string {
  if (!card.seriesType || card.seriesType === 'none') {
    return card.sessionsCompleted > 0 ? `${card.sessionsCompleted} session${card.sessionsCompleted !== 1 ? 's' : ''}` : '';
  }
  const total = card.sessionsCompleted + card.sessionsRemaining;
  return total > 0 ? `${card.sessionsCompleted} of ${total}` : `${card.sessionsCompleted} done`;
}

function touchLabel(card: PipelineCard): string {
  return card.touchCount > 0 ? `${card.touchCount} touch${card.touchCount !== 1 ? 'es' : ''}` : '';
}

function Card({ card, colId, onClick }: {
  card: PipelineCard;
  colId: keyof PipelineColumns;
  onClick: () => void;
}) {
  const colors = COL_COLORS[colId];
  const isClient = ['first-session', 'multipack-1', 'multipack-2', 'multipack-3'].includes(colId);
  const subLabel = isClient ? sessionLabel(card) : touchLabel(card);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg px-3 py-2.5 mb-2 last:mb-0 transition-opacity active:opacity-70"
      style={{ background: 'white', border: `1px solid ${colors.ring}` }}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 flex-shrink-0 w-2 h-2 rounded-full"
          style={{ background: colors.dot }}
        />
        <div className="min-w-0">
          {card.dateAdded ? (
            <p className="text-[10px] text-amari-text-muted mb-0.5">
              {new Date(card.dateAdded).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </p>
          ) : null}
          <p className="text-sm font-medium text-amari-charcoal leading-snug truncate">
            {card.name}
          </p>
          {subLabel ? (
            <p className="text-[11px] text-amari-text-muted mt-0.5">{subLabel}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function KanbanColumn({
  col,
  cards,
  metric,
  onCardClick,
}: {
  col: typeof COLUMNS[number];
  cards: PipelineCard[];
  metric?: string;
  onCardClick: (id: string) => void;
}) {
  const colors = COL_COLORS[col.id];
  return (
    <div
      className="flex-shrink-0 flex flex-col rounded-xl overflow-hidden"
      style={{
        width: 188,
        background: colors.bg,
        border: `1px solid ${colors.ring}`,
      }}
    >
      {/* Column header */}
      <div className="px-3 pt-3 pb-2" style={{ borderBottom: `1px solid ${colors.ring}` }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-amari-charcoal leading-tight">
            {col.label}
          </span>
          <span
            className="text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full"
            style={{ background: colors.ring, color: colors.dot }}
          >
            {cards.length}
          </span>
        </div>
        <p className="text-[10px] text-amari-text-muted mt-0.5">{col.sub}</p>
        {metric && (
          <p className="mt-1 text-[10px] font-semibold tabular-nums" style={{ color: colors.dot }}>
            {metric}
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <p className="text-[11px] text-amari-text-muted text-center py-4 px-1">Empty</p>
        ) : (
          cards.map((card) => (
            <Card
              key={card.id}
              card={card}
              colId={col.id}
              onClick={() => onCardClick(card.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const navigate = useNavigate();
  const fetcher = useCallback(() => getPipeline(), []);
  const { data: columns, isLoading, error, refetch } = useApiCall(fetcher);
  const funnelFetcher = useCallback(() => getFunnel(), []);
  const { data: funnel } = useApiCall(funnelFetcher);

  const total = columns
    ? Object.values(columns).reduce((s, arr) => s + arr.length, 0)
    : 0;
  const sessions = funnel?.sessions || [];
  const attended = sessions.filter((s) => s.status === 'attended' || (!s.status && s.showed)).length;
  const noShows = sessions.filter((s) => s.status === 'noshow').length;
  const eightSeries = sessions.filter((s) => (s.status === 'attended' || (!s.status && s.showed)) && s.eightSeries).length;
  const pct = (numerator: number, denominator: number) => denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—';
  const downstream = funnel?.cohort;
  const columnMetrics: Partial<Record<keyof PipelineColumns, string>> = funnel ? {
    'session-noshow': `${pct(noShows, attended + noShows)} no-show rate · ${noShows} of ${attended + noShows}`,
    'first-session': `${pct(attended, attended + noShows)} attended · ${attended} of ${attended + noShows}`,
    'multipack-1': `${pct(eightSeries, attended)} of attendees buy 8-series`,
    'multipack-2': `${pct(downstream?.downstreamBuyers || 0, downstream?.firstSeriesBuyers || 0)} of first-series buyers repurchase`,
  } : {};

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Page header */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
        <div>
          <h1 className="text-xl font-serif text-amari-charcoal">Pipeline</h1>
          {!isLoading && columns && (
            <p className="text-xs text-amari-text-muted mt-0.5">{total} people tracked</p>
          )}
        </div>
        <button
          onClick={refetch}
          disabled={isLoading}
          className="p-2 rounded-full text-amari-text-muted disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-amari-charcoal animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <p className="text-sm text-amari-text-muted">{error}</p>
          <button onClick={refetch} className="text-sm text-amari-charcoal underline mt-1">
            Try again
          </button>
        </div>
      ) : columns ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 px-4 pb-4 h-full" style={{ minWidth: 'max-content' }}>
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                col={col}
                cards={columns[col.id] ?? []}
                metric={columnMetrics[col.id]}
                onCardClick={(id) => navigate(`/client/${id}`)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
