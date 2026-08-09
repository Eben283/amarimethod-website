import { Activity, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardPlus, Database, Kanban, Loader2, Mail, MapPinned, MessageSquare, ShoppingBag, Sparkles, TrendingUp, UsersRound, Wallet, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getAutomationWatchAccessUrl,
  getCrmMirrorAccessUrl,
  getOpsSystemsBoard,
  getStaffAmariMailReadiness,
  startStaffAmariMailAuthorization,
  type OpsSystemsBoard,
  type StaffAmariMailReadiness,
} from '../lib/api';

type OpsTab = 'overview' | 'systems' | 'crm' | 'automation';

const TABS: { id: OpsTab; label: string; detail: string; Icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', detail: 'What needs attention', Icon: Activity },
  { id: 'systems', label: 'Systems', detail: 'Paths · heartbeats · fix', Icon: Activity },
  { id: 'crm', label: 'CRM Mirror', detail: 'GHL + Stripe import', Icon: Database },
  { id: 'automation', label: 'Automation Watch', detail: 'Technical cutover diagnostics', Icon: Workflow },
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
      { label: 'Calendar', detail: 'Schedule, services, and booking rules', Icon: CalendarDays, to: '/calendar' },
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
      { label: 'Automation watch', detail: 'Cutover delivery checks, not daily work', Icon: Workflow, tab: 'automation' },
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

function authorizationDestination(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') {
    throw new Error('Amari mailbox authorization returned an unexpected destination');
  }
  return url.toString();
}

function MailboxReadiness({ callbackState }: { callbackState: string | null }) {
  const [readiness, setReadiness] = useState<StaffAmariMailReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getStaffAmariMailReadiness()
      .then((result) => {
        if (!cancelled) setReadiness(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Mailbox readiness could not be checked');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [callbackState]);

  async function connectMailbox() {
    if (connecting || !readiness?.oauthConfigured) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await startStaffAmariMailAuthorization();
      window.location.assign(authorizationDestination(result.authorizationUrl));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mailbox authorization could not be started');
      setConnecting(false);
    }
  }

  const configured = readiness?.oauthConfigured === true;
  const verified = readiness?.grantVerified === true;
  const reconnectRequired = readiness?.connectionStatus === 'invalid';
  const connectionLabel = loading
    ? 'Checking connection'
    : !readiness
      ? 'Status unavailable'
      : verified
        ? 'Stored grant verified'
        : reconnectRequired
          ? 'Reconnect required'
          : configured
            ? 'Not connected'
            : 'Setup unavailable';
  const callbackMessage = callbackState === 'failed'
    ? 'Mailbox connection was not completed. Nothing was enabled.'
    : callbackState === 'connected' && verified
      ? 'Google verified this Amari mailbox. Reply mirroring and sending remain off.'
      : callbackState === 'connected' && readiness && !loading
        ? 'Google returned, but this Amari mailbox is not verified.'
        : null;
  const route = [
    { label: 'Identity', value: readiness ? readiness.actor : loading ? 'Checking' : 'Unknown', state: readiness ? 'ready' : 'pending' },
    { label: 'Google grant', value: verified ? 'Stored' : reconnectRequired ? 'Needs reconnect' : readiness ? configured ? 'Not connected' : 'Unavailable' : loading ? 'Checking' : 'Unknown', state: verified ? 'ready' : 'pending' },
    { label: 'Reply mirror', value: 'Off', state: 'off' },
    { label: 'Sending', value: 'Off', state: 'off' },
  ];

  return (
    <section className="ops-mailbox" aria-labelledby="ops-mailbox-title">
      <div className="ops-mailbox__topline">
        <div className="ops-mailbox__title">
          <span className="ops-mailbox__icon" aria-hidden="true"><Mail /></span>
          <div>
            <p>Staff mailbox</p>
            <h2 id="ops-mailbox-title">Your Amari mailbox</h2>
          </div>
        </div>
        <span className={`ops-mailbox__status${verified ? ' is-verified' : ''}`} role="status">
          {verified ? <Check aria-hidden="true" /> : null}{connectionLabel}
        </span>
      </div>

      <div className="ops-mailbox__identity">
        <span>Required identity</span>
        <strong>{readiness?.mailbox || (loading ? 'Checking your assigned mailbox…' : 'Mailbox unavailable')}</strong>
        <small>This address is assigned by your signed-in Staff account. It cannot be changed here.</small>
      </div>

      <ol className="ops-mailbox__route" aria-label="Amari mailbox readiness path">
        {route.map((step, index) => (
          <li key={step.label} className={`is-${step.state}`}>
            <span className="ops-mailbox__route-marker" aria-hidden="true">{step.state === 'ready' ? <Check /> : null}</span>
            <span><small>{step.label}</small><strong>{step.value}</strong></span>
            {index < route.length - 1 ? <ChevronRight className="ops-mailbox__route-arrow" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>

      <div className="ops-mailbox__foot">
        <p>Connecting verifies the mailbox only. Client replies are not mirrored, and Staff email sending is off.</p>
        {!loading && configured && !verified ? (
          <button type="button" onClick={connectMailbox} disabled={connecting}>
            {connecting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Mail aria-hidden="true" />}
            {connecting ? 'Opening Google…' : reconnectRequired ? 'Reconnect my Amari mailbox' : 'Connect my Amari mailbox'}
          </button>
        ) : null}
      </div>

      {!loading && readiness && !configured ? (
        <p className="ops-mailbox__notice" role="alert">Amari mail authorization is not configured. The connection cannot be started yet.</p>
      ) : null}
      {callbackMessage ? <p className="ops-mailbox__notice" role="status">{callbackMessage}</p> : null}
      {error ? <p className="ops-mailbox__notice ops-mailbox__notice--error" role="alert">{error}</p> : null}
    </section>
  );
}

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const [mailCallbackState] = useState<'connected' | 'failed' | null>(() => {
    const value = params.get('amariMail');
    return value === 'connected' || value === 'failed' ? value : null;
  });
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
    if (!mailCallbackState) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('amariMail');
      return next;
    }, { replace: true });
  }, [mailCallbackState, setParams]);

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
          <MailboxReadiness callbackState={mailCallbackState} />
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
