import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { getPipeline, type PipelineCard, type PipelineColumns } from '../lib/api';
import { useApiCall } from '../hooks/useApiCall';
import { memberWorkspacePath } from '../lib/member-workspace';
import './PipelinePage.css';

type StageId = keyof PipelineColumns;
type PhaseId = 'outreach' | 'discovery' | 'care' | 'clients';

const STAGES: Record<StageId, { label: string; detail: string }> = {
  'touch-1': { label: 'First touch', detail: 'One recorded outreach' },
  'touch-2': { label: 'Second touch', detail: 'Two recorded outreaches' },
  'touch-3': { label: 'Third touch', detail: 'Three recorded outreaches' },
  'touch-4': { label: 'Fourth touch', detail: 'Four recorded outreaches' },
  'touch-5': { label: 'Fifth touch', detail: 'Five recorded outreaches' },
  'touch-6': { label: 'Sixth touch+', detail: 'Six or more outreaches' },
  'discovery-noshow': { label: 'Discovery missed', detail: 'Call cancelled or missed' },
  discovery: { label: 'Discovery complete', detail: 'Call attended' },
  'session-noshow': { label: 'First session missed', detail: 'Initial session not attended' },
  'first-session': { label: 'First session complete', detail: 'Initial session attended' },
  'multipack-1': { label: 'First purchase', detail: 'One completed purchase' },
  'multipack-2': { label: 'Repeat purchase', detail: 'Two or more purchases' },
};

const PHASES: Array<{ id: PhaseId; label: string; detail: string; stages: StageId[] }> = [
  { id: 'outreach', label: 'Outreach', detail: 'People moving through proactive contact', stages: ['touch-1', 'touch-2', 'touch-3', 'touch-4', 'touch-5', 'touch-6'] },
  { id: 'discovery', label: 'Discovery', detail: 'Calls booked and completed', stages: ['discovery-noshow', 'discovery'] },
  { id: 'care', label: 'Care', detail: 'First-session outcomes', stages: ['session-noshow', 'first-session'] },
  { id: 'clients', label: 'Clients', detail: 'Purchase progression', stages: ['multipack-1', 'multipack-2'] },
];

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—';
}

function monthLabel(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
}

function cardDetail(card: PipelineCard, stage: StageId) {
  if (stage === 'first-session' || stage === 'multipack-1' || stage === 'multipack-2') {
    if (card.seriesType && card.seriesType !== 'none') return `${card.sessionsCompleted} complete · ${card.sessionsRemaining} remaining`;
    if (card.sessionsCompleted) return `${card.sessionsCompleted} session${card.sessionsCompleted === 1 ? '' : 's'} complete`;
    return 'Care record';
  }
  return `${card.touchCount || 0} recorded touch${card.touchCount === 1 ? '' : 'es'}`;
}

function PipelineCardRow({ card, stage, onOpen }: { card: PipelineCard; stage: StageId; onOpen: () => void }) {
  return (
    <button type="button" className="staff-pipeline__card" onClick={onOpen}>
      <span className="staff-pipeline__avatar" aria-hidden="true">{card.name?.trim()?.charAt(0)?.toUpperCase() || '—'}</span>
      <span className="staff-pipeline__card-copy"><strong>{card.name || 'Unnamed person'}</strong><small>{cardDetail(card, stage)}</small></span>
      <span className="staff-pipeline__card-meta">
        <time>{monthLabel(card.lastActivity || card.dateAdded)}</time>
        {card.hasSentReferral ? <small>Sent referral</small> : card.purchaseCount > 0 ? <small>{card.purchaseCount} purchase{card.purchaseCount === 1 ? '' : 's'}</small> : null}
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

export default function PipelinePage() {
  const navigate = useNavigate();
  const fetcher = useCallback(() => getPipeline(), []);
  const { data: pipeline, isLoading, error, refetch } = useApiCall(fetcher);
  const [phase, setPhase] = useState<PhaseId>('outreach');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Partial<Record<StageId, boolean>>>({});
  const columns = pipeline?.columns;
  const currentPhase = PHASES.find((item) => item.id === phase) || PHASES[0];

  const counts = useMemo(() => {
    const count = (stages: StageId[]) => stages.reduce((sum, stage) => sum + (columns?.[stage]?.length || 0), 0);
    return {
      total: columns ? Object.values(columns).reduce((sum, cards) => sum + cards.length, 0) : 0,
      outreach: count(PHASES[0].stages), discovery: count(PHASES[1].stages),
      care: count(PHASES[2].stages), clients: count(PHASES[3].stages),
    };
  }, [columns]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingCount = currentPhase.stages.reduce((sum, stage) => sum + (columns?.[stage] || [])
    .filter((card) => !normalizedQuery || card.name.toLocaleLowerCase().includes(normalizedQuery)).length, 0);
  const cohort = pipeline?.cohortMetrics;

  return (
    <main className="staff-pipeline">
      <header className="staff-pipeline__opening">
        <div><p>Care flow</p><h1>Pipeline</h1><span>See where every relationship stands without turning the whole practice into one endless board.</span></div>
        <button type="button" onClick={() => { void refetch(); }} disabled={isLoading} aria-label="Refresh Pipeline data"><RefreshCw className={isLoading ? 'is-spinning' : ''} aria-hidden="true" />Refresh</button>
      </header>

      {isLoading ? <div className="staff-pipeline__state"><Loader2 aria-hidden="true" /> Loading the care flow…</div>
        : error ? <div className="staff-pipeline__state staff-pipeline__state--error" role="alert"><AlertCircle aria-hidden="true" /><strong>Pipeline could not be loaded</strong><span>{error}</span><button type="button" onClick={() => { void refetch(); }}>Try again</button></div>
          : columns ? <>
            <section className="staff-pipeline__totals" aria-label="Pipeline totals">
              <div><span>People tracked</span><strong>{counts.total}</strong><small>Complete care flow</small></div>
              <div><span>In outreach</span><strong>{counts.outreach}</strong><small>Proactive contact</small></div>
              <div><span>In discovery</span><strong>{counts.discovery}</strong><small>Discovery outcomes</small></div>
              <div><span>In care</span><strong>{counts.care + counts.clients}</strong><small>Sessions and clients</small></div>
            </section>

            <section className="staff-pipeline__workspace" aria-labelledby="pipeline-phase-title">
              <nav className="staff-pipeline__tabs" aria-label="Pipeline phases">
                {PHASES.map((item) => <button key={item.id} type="button" className={phase === item.id ? 'is-active' : ''} onClick={() => { setPhase(item.id); setExpanded({}); }}><span>{item.label}</span><strong>{counts[item.id]}</strong></button>)}
              </nav>
              <header className="staff-pipeline__workspace-head">
                <div><h2 id="pipeline-phase-title">{currentPhase.label}</h2><p>{currentPhase.detail}</p></div>
                <label><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person" aria-label="Find a person in this phase" /></label>
              </header>
              {normalizedQuery ? <p className="staff-pipeline__results">{matchingCount} {matchingCount === 1 ? 'person' : 'people'} match “{query.trim()}”</p> : null}
              <div className={`staff-pipeline__board staff-pipeline__board--${phase}`}>
                {currentPhase.stages.map((stage) => {
                  const cards = (columns[stage] || []).filter((card) => !normalizedQuery || card.name.toLocaleLowerCase().includes(normalizedQuery));
                  const shown = expanded[stage] || normalizedQuery ? cards : cards.slice(0, 8);
                  return <section key={stage} className="staff-pipeline__stage">
                    <header><div><h3>{STAGES[stage].label}</h3><p>{STAGES[stage].detail}</p></div><strong>{cards.length}</strong></header>
                    <div className="staff-pipeline__rows">{shown.map((card) => <PipelineCardRow key={card.id} card={card} stage={stage} onOpen={() => navigate(memberWorkspacePath(card.id, 'record'))} />)}{!cards.length ? <p className="staff-pipeline__empty">No one is in this stage.</p> : null}</div>
                    {!normalizedQuery && cards.length > 8 ? <button type="button" className="staff-pipeline__more" onClick={() => setExpanded((current) => ({ ...current, [stage]: !current[stage] }))}>{expanded[stage] ? 'Show fewer' : `Show ${cards.length - 8} more`}</button> : null}
                  </section>;
                })}
              </div>
            </section>

            {cohort ? <section className="staff-pipeline__conversion" aria-labelledby="pipeline-conversion-title">
              <header><div><p>Current cohort</p><h2 id="pipeline-conversion-title">Conversion snapshot</h2></div><span>Directional practice signals</span></header>
              <div>
                <article><span>Discovery attended</span><strong>{pct(cohort.discoveryAttended, cohort.reachedOut)}</strong><small>{cohort.discoveryAttended} of {cohort.reachedOut} reached</small></article>
                <article><span>First session attended</span><strong>{pct(cohort.initialAttended, cohort.initialResolved)}</strong><small>{cohort.initialAttended} of {cohort.initialResolved} resolved</small></article>
                <article><span>First purchase</span><strong>{pct(cohort.firstPurchasers, cohort.initialAttended)}</strong><small>{cohort.firstPurchasers} of {cohort.initialAttended} attendees</small></article>
                <article><span>Purchased again</span><strong>{pct(cohort.repeatPurchasers, cohort.firstPurchasers)}</strong><small>{cohort.repeatPurchasers} of {cohort.firstPurchasers} purchasers</small></article>
              </div>
            </section> : null}
          </> : null}
    </main>
  );
}
