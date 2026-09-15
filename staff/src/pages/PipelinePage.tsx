import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { getPipeline, type PipelineCard, type PipelineColumns } from '../lib/api';
import { useApiCall } from '../hooks/useApiCall';
import { memberWorkspacePath } from '../lib/member-workspace';
import './PipelinePage.css';

type StageId = keyof PipelineColumns;
type PhaseId = 'outreach' | 'discovery' | 'care' | 'clients';

const PHASES: Array<{ id: PhaseId; label: string }> = [
  { id: 'outreach', label: 'Outreach' }, { id: 'discovery', label: 'Discovery' },
  { id: 'care', label: 'Care' }, { id: 'clients', label: 'Clients' },
];

const STAGES: Array<{ id: StageId; phase: PhaseId; label: string; detail: string }> = [
  { id: 'touch-1', phase: 'outreach', label: 'First touch', detail: 'One recorded outreach' },
  { id: 'touch-2', phase: 'outreach', label: 'Second touch', detail: 'Two recorded outreaches' },
  { id: 'touch-3', phase: 'outreach', label: 'Third touch', detail: 'Three recorded outreaches' },
  { id: 'touch-4', phase: 'outreach', label: 'Fourth touch', detail: 'Four recorded outreaches' },
  { id: 'touch-5', phase: 'outreach', label: 'Fifth touch', detail: 'Five recorded outreaches' },
  { id: 'touch-6', phase: 'outreach', label: 'Sixth touch+', detail: 'Six or more outreaches' },
  { id: 'discovery-noshow', phase: 'discovery', label: 'Discovery missed', detail: 'Call cancelled or missed' },
  { id: 'discovery', phase: 'discovery', label: 'Discovery complete', detail: 'Call attended' },
  { id: 'session-noshow', phase: 'care', label: 'First session missed', detail: 'Initial session not attended' },
  { id: 'first-session', phase: 'care', label: 'First session complete', detail: 'Initial session attended' },
  { id: 'multipack-1', phase: 'clients', label: 'First purchase', detail: 'One completed purchase' },
  { id: 'multipack-2', phase: 'clients', label: 'Repeat purchase', detail: 'Two or more purchases' },
];

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—';
}
function monthLabel(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date) : 'Date unavailable';
}
function cardDetail(card: PipelineCard, stage: StageId) {
  if (stage === 'first-session' || stage === 'multipack-1' || stage === 'multipack-2') {
    if (card.seriesType && card.seriesType !== 'none') return `${card.sessionsCompleted} complete · ${card.sessionsRemaining} remaining`;
    return card.sessionsCompleted ? `${card.sessionsCompleted} session${card.sessionsCompleted === 1 ? '' : 's'} complete` : 'Care record';
  }
  return `${card.touchCount || 0} recorded touch${card.touchCount === 1 ? '' : 'es'}`;
}

export default function PipelinePage() {
  const navigate = useNavigate();
  const fetcher = useCallback(() => getPipeline(), []);
  const { data: pipeline, isLoading, error, refetch } = useApiCall(fetcher);
  const [query, setQuery] = useState('');
  const columns = pipeline?.columns;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const counts = useMemo(() => {
    const phaseCount = (phase: PhaseId) => STAGES.filter((stage) => stage.phase === phase).reduce((sum, stage) => sum + (columns?.[stage.id]?.length || 0), 0);
    return { total: columns ? Object.values(columns).reduce((sum, cards) => sum + cards.length, 0) : 0, outreach: phaseCount('outreach'), discovery: phaseCount('discovery'), care: phaseCount('care'), clients: phaseCount('clients') };
  }, [columns]);
  const cohort = pipeline?.cohortMetrics;
  const metrics: Partial<Record<StageId, string>> = cohort ? {
    discovery: `${pct(cohort.discoveryAttended, cohort.reachedOut)} attended`,
    'session-noshow': `${pct(cohort.initialNoShows, cohort.initialResolved)} missed`,
    'first-session': `${pct(cohort.initialAttended, cohort.initialResolved)} attended`,
    'multipack-1': `${pct(cohort.firstPurchasers, cohort.initialAttended)} purchased`,
    'multipack-2': `${pct(cohort.repeatPurchasers, cohort.firstPurchasers)} returned`,
  } : {};

  return <main className="staff-pipeline">
    <header className="staff-pipeline__opening">
      <div><p>Care flow</p><h1>Pipeline</h1></div>
      <div className="staff-pipeline__tools">
        <label><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person" aria-label="Find anyone in Pipeline" /></label>
        <button type="button" onClick={() => { void refetch(); }} disabled={isLoading} aria-label="Refresh Pipeline data"><RefreshCw className={isLoading ? 'is-spinning' : ''} aria-hidden="true" /><span>Refresh</span></button>
      </div>
    </header>
    {isLoading ? <div className="staff-pipeline__state"><Loader2 aria-hidden="true" /> Loading Pipeline…</div>
      : error ? <div className="staff-pipeline__state staff-pipeline__state--error" role="alert"><AlertCircle aria-hidden="true" /><strong>Pipeline could not be loaded</strong><span>{error}</span><button type="button" onClick={() => { void refetch(); }}>Try again</button></div>
        : columns ? <>
          <section className="staff-pipeline__summary" aria-label="Pipeline totals"><strong>{counts.total} people</strong>{PHASES.map((phase) => <span key={phase.id}>{phase.label} <b>{counts[phase.id]}</b></span>)}{normalizedQuery ? <em>Showing matches for “{query.trim()}”</em> : null}</section>
          <section className="staff-pipeline__board" aria-label="All Pipeline stages">
            {STAGES.map((stage, index) => {
              const cards = (columns[stage.id] || []).filter((card) => !normalizedQuery || card.name.toLocaleLowerCase().includes(normalizedQuery));
              const phase = PHASES.find((item) => item.id === stage.phase)!;
              const phaseStart = index === 0 || STAGES[index - 1].phase !== stage.phase;
              return <section key={stage.id} className={`staff-pipeline__stage${phaseStart ? ' is-phase-start' : ''}`}>
                <header><span>{phase.label}</span><div><h2>{stage.label}</h2><strong>{cards.length}</strong></div><p>{stage.detail}{metrics[stage.id] ? ` · ${metrics[stage.id]}` : ''}</p></header>
                <div className="staff-pipeline__rows">{cards.map((card) => <button type="button" className="staff-pipeline__card" key={card.id} onClick={() => navigate(memberWorkspacePath(card.id, 'record'))}><span className="staff-pipeline__avatar" aria-hidden="true">{card.name?.trim()?.charAt(0)?.toUpperCase() || '—'}</span><span className="staff-pipeline__card-copy"><strong>{card.name || 'Unnamed person'}</strong><small>{cardDetail(card, stage.id)}</small><time>{monthLabel(card.lastActivity || card.dateAdded)}</time></span><ChevronRight aria-hidden="true" /></button>)}{!cards.length ? <p className="staff-pipeline__empty">No one here</p> : null}</div>
              </section>;
            })}
          </section>
        </> : null}
  </main>;
}
