import { Activity, BookOpen, CalendarDays, ChevronLeft, CircleDollarSign, ClipboardPlus, Database, Kanban, Loader2, MapPinned, MessageSquare, ShoppingBag, Sparkles, TrendingUp, UsersRound, Wallet, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getAutomationWatchAccessUrl, getCrmMirrorAccessUrl, getOpsSystemsBoard, type OpsSystemsBoard } from '../lib/api';

type OpsTab = 'overview' | 'systems' | 'crm' | 'automation';

const TABS: { id: OpsTab; label: string; detail: string; Icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', detail: 'What needs attention', Icon: Activity },
  { id: 'systems', label: 'Systems', detail: 'Paths · heartbeats · fix', Icon: Activity },
  { id: 'crm', label: 'CRM Mirror', detail: 'GHL + Stripe import', Icon: Database },
  { id: 'automation', label: 'Automation Watch', detail: 'Would-send vs GHL', Icon: Workflow },
];

const SYSTEMS_SRC = 'https://www.amarimethod.com/ops?embed=1';

type Workspace = {
  label: string;
  detail: string;
  Icon: typeof Activity;
  to?: string;
  tab?: OpsTab;
};

const WORKSPACE_GROUPS: { label: string; items: Workspace[] }[] = [
  {
    label: 'Care and relationships',
    items: [
      { label: 'Today', detail: 'Schedule and session work', Icon: CalendarDays, to: '/today' },
      { label: 'Practice members', detail: 'Relationship history', Icon: MessageSquare, to: '/client-desk' },
      { label: 'Follow-up', detail: 'Replies and next moves', Icon: UsersRound, to: '/follow-up' },
      { label: 'Balances', detail: 'Session entitlements', Icon: Wallet, to: '/balances' },
      { label: 'Care pipeline', detail: 'Current client flow', Icon: Kanban, to: '/pipeline' },
    ],
  },
  {
    label: 'Revenue and growth',
    items: [
      { label: 'Revenue', detail: 'Sales and payment record', Icon: CircleDollarSign, to: '/revenue' },
      { label: 'Staff POS', detail: 'Draft checkout', Icon: ShoppingBag, to: '/pos' },
      { label: 'Funnel', detail: 'Lead flow and pace', Icon: TrendingUp, to: '/funnel' },
      { label: 'Field studies', detail: 'Study sessions', Icon: ClipboardPlus, to: '/field-studies' },
      { label: 'Community', detail: 'Field relationships', Icon: MapPinned, to: '/community' },
    ],
  },
  {
    label: 'Control and reference',
    items: [
      { label: 'CRM mirror', detail: 'Imported GHL and Stripe record', Icon: Database, tab: 'crm' },
      { label: 'Automation watch', detail: 'What would send and why', Icon: Workflow, tab: 'automation' },
      { label: 'Ask Amari', detail: 'Chief of Staff', Icon: Sparkles, to: '/cos' },
      { label: 'Playbooks', detail: 'Practice reference', Icon: BookOpen, to: '/playbook' },
    ],
  },
];

function tabFromSearch(value: string | null): OpsTab {
  if (value === 'crm' || value === 'crm-mirror') return 'crm';
  if (value === 'automation' || value === 'automation-watch') return 'automation';
  return value === 'systems' ? 'systems' : 'overview';
}

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = tabFromSearch(params.get('tab'));
  const [board, setBoard] = useState<OpsSystemsBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [crmSrc, setCrmSrc] = useState<string | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [automationSrc, setAutomationSrc] = useState<string | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'overview' || board) return;
    let cancelled = false;
    void getOpsSystemsBoard()
      .then((data) => { if (!cancelled) setBoard(data); })
      .catch((err) => { if (!cancelled) setBoardError(err instanceof Error ? err.message : 'Could not load system status'); });
    return () => { cancelled = true; };
  }, [tab, board]);

  useEffect(() => {
    if (tab !== 'crm') return;
    if (crmSrc) return;
    let cancelled = false;
    setCrmLoading(true);
    setCrmError(null);
    void getCrmMirrorAccessUrl()
      .then(({ url }) => {
        if (cancelled) return;
        const joined = url.includes('?') ? `${url}&embed=1` : `${url}?embed=1`;
        setCrmSrc(joined);
      })
      .catch((err) => {
        if (cancelled) return;
        setCrmError(err instanceof Error ? err.message : 'Could not open CRM Mirror');
      })
      .finally(() => {
        if (!cancelled) setCrmLoading(false);
      });
    return () => { cancelled = true; };
  // Loading state is deliberately not a dependency. Setting it starts this
  // request; including it would run the cleanup immediately and mark the
  // pending request as cancelled before it can set the protected iframe URL.
  }, [tab, crmSrc]);

  useEffect(() => {
    if (tab !== 'automation') return;
    if (automationSrc) return;
    let cancelled = false;
    setAutomationLoading(true);
    setAutomationError(null);
    void getAutomationWatchAccessUrl()
      .then(({ url }) => {
        if (cancelled) return;
        const joined = url.includes('?') ? `${url}&embed=1` : `${url}?embed=1`;
        setAutomationSrc(joined);
      })
      .catch((err) => {
        if (cancelled) return;
        setAutomationError(err instanceof Error ? err.message : 'Could not open Automation Watch');
      })
      .finally(() => {
        if (!cancelled) setAutomationLoading(false);
      });
    return () => { cancelled = true; };
  // See the CRM handoff above: this effect must outlive its own loading-state
  // update so the resolved one-time access URL can be rendered.
  }, [tab, automationSrc]);

  function selectTab(next: OpsTab) {
    setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  }

  const frameSrc = tab === 'systems' ? SYSTEMS_SRC : tab === 'automation' ? automationSrc : tab === 'crm' ? crmSrc : null;
  const attention = (board?.systems || []).filter((system) => ['red', 'sick', 'stuck', 'map_bad'].includes(system.state));

  return (
    <main className="ops-hub">
      <header className="ops-hub__head">
        <Link to="/" className="ops-hub__back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div>
          <p>Operator surfaces</p>
          <h1>Operations</h1>
          <span>The working picture of the practice, with a direct route into each workspace.</span>
        </div>
      </header>

      <nav className="ops-hub__tabs" aria-label="Operator surfaces">
        {TABS.map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'is-active' : undefined}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => selectTab(id)}
          >
            <Icon aria-hidden="true" />
            <span><strong>{label}</strong><small>{detail}</small></span>
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <section className="ops-overview" aria-label="Operations overview">
          <div className={`ops-overview__signal ops-overview__signal--${board?.overall || 'unknown'}`}>
            <span>{board ? board.attentionCount : '—'}</span>
            <div><strong>{board?.attentionCount ? 'systems need attention' : board ? 'systems are clear' : 'checking systems'}</strong><small>{board?.generatedAt ? `Updated ${new Date(board.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Live read-only status'}</small></div>
          </div>
          {boardError ? <p className="ops-overview__error" role="alert">{boardError}</p> : null}
          {attention.length ? (
            <div className="ops-overview__attention"><p>Needs attention</p>{attention.slice(0, 4).map((system) => <button key={system.id} type="button" onClick={() => selectTab('systems')}><i aria-hidden="true" /><span><strong>{system.label}</strong><small>{system.note || system.state}</small></span></button>)}</div>
          ) : null}
          <div className="ops-overview__workspace-groups">
            {WORKSPACE_GROUPS.map((group) => (
              <section key={group.label} className="ops-overview__workspace-group" aria-label={group.label}>
                <p>{group.label}</p>
                <div className="ops-overview__workspaces">
                  {group.items.map(({ label, detail, Icon, to, tab: targetTab }) => (
                    <button key={label} type="button" onClick={() => targetTab ? selectTab(targetTab) : navigate(to!)}>
                      <Icon aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {tab !== 'overview' ? <section className="ops-hub__frame" aria-label={TABS.find((item) => item.id === tab)?.label}>
        {tab === 'crm' && crmLoading ? (
          <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected CRM session…</div>
        ) : null}
        {tab === 'crm' && crmError ? (
          <div className="ops-hub__status ops-hub__status--error" role="alert">{crmError}</div>
        ) : null}
        {tab === 'automation' && automationLoading ? (
          <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected Automation Watch…</div>
        ) : null}
        {tab === 'automation' && automationError ? (
          <div className="ops-hub__status ops-hub__status--error" role="alert">{automationError}</div>
        ) : null}
        {frameSrc ? (
          <iframe title={TABS.find((item) => item.id === tab)?.label} src={frameSrc} />
        ) : (tab === 'crm' && !crmLoading && !crmError) || (tab === 'automation' && !automationLoading && !automationError) ? (
          <div className="ops-hub__status">Loading…</div>
        ) : null}
      </section>
      : null}
    </main>
  );
}
