import { Activity, AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDollarSign, ClipboardPlus, Database, GitBranch, GraduationCap, History, Kanban, ListChecks, Loader2, Mail, MapPinned, MessageSquare, RotateCcw, ShieldCheck, ShoppingBag, Sparkles, TrendingUp, UsersRound, Wallet, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getAutomationWatchAccessUrl,
  getCrmMirrorAccessUrl,
  getOpsLedger,
  getOpsSystemsBoard,
  getStaffAmariMailReadiness,
  getStaffGoogleCalendarReadiness,
  getStaffGmailReplyReadiness,
  startStaffAmariMailAuthorization,
  startStaffGoogleCalendarAuthorization,
  type GmailReplySyncGapReason,
  type OpsLedger,
  type OpsLedgerActivity,
  type OpsLedgerChange,
  type OpsLedgerIncident,
  type OpsSystemsBoard,
  type StaffAmariMailReadiness,
  type StaffGoogleCalendarReadiness,
  type StaffGmailReplyReadiness,
} from '../lib/api';
import { currentStaffBuildIdentity } from '../lib/staff-release';

type OpsTab = 'overview' | 'activity' | 'changes' | 'incidents' | 'systems' | 'crm' | 'automation';

const TABS: { id: OpsTab; label: string; detail: string; Icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', detail: 'What needs attention', Icon: Activity },
  { id: 'activity', label: 'Activity', detail: 'Tasks and outcomes', Icon: ListChecks },
  { id: 'changes', label: 'Changes', detail: 'Releases and config', Icon: GitBranch },
  { id: 'incidents', label: 'Incidents', detail: 'Open and resolved', Icon: CircleAlert },
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
      { label: 'Outreach', detail: 'Proactive calls, messages and future contact', Icon: UsersRound, to: '/outreach' },
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
      { label: 'Training', detail: 'Sharpen, scripts, and playbooks', Icon: GraduationCap, to: '/training' },
    ],
  },
];

function tabFromSearch(value: string | null): OpsTab {
  if (value === 'crm' || value === 'crm-mirror') return 'crm';
  if (value === 'automation' || value === 'automation-watch') return 'automation';
  if (value === 'activity') return 'activity';
  if (value === 'changes') return 'changes';
  if (value === 'incidents') return 'incidents';
  return value === 'systems' ? 'systems' : 'overview';
}

function authorizationDestination(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') {
    throw new Error('Amari mailbox authorization returned an unexpected destination');
  }
  return url.toString();
}

function PractitionerCalendarReadiness({ callbackState }: { callbackState: string | null }) {
  const [readiness, setReadiness] = useState<StaffGoogleCalendarReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getStaffGoogleCalendarReadiness()
      .then((result) => { if (!cancelled) setReadiness(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Calendar readiness could not be checked'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [callbackState]);

  async function connectCalendar() {
    if (connecting || !readiness?.oauthConfigured) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await startStaffGoogleCalendarAuthorization();
      window.location.assign(authorizationDestination(result.authorizationUrl));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Calendar authorization could not be started');
      setConnecting(false);
    }
  }

  const verified = readiness?.grantVerified === true;
  const callbackMessage = callbackState === 'failed'
    ? 'Calendar connection was not completed. Staff booking stayed on its current provider.'
    : callbackState === 'connected' && verified
      ? 'Google verified this practitioner calendar. Staff booking activation is still off.'
      : callbackState === 'connected' && readiness && !loading
        ? 'Google returned, but the practitioner calendar identity was not verified.'
        : null;
  const primary = readiness?.calendars.find((calendar) => calendar.primary);

  return (
    <section className="ops-mailbox" aria-labelledby="ops-practitioner-calendar-title">
      <div className="ops-mailbox__topline">
        <div className="ops-mailbox__title">
          <span className="ops-mailbox__icon" aria-hidden="true"><CalendarDays /></span>
          <div><p>Practitioner calendar</p><h2 id="ops-practitioner-calendar-title">Your appointment calendar</h2></div>
        </div>
        <span className={`ops-mailbox__status${verified ? ' is-verified' : ''}`} role="status">
          {verified ? <Check aria-hidden="true" /> : null}{loading ? 'Checking connection' : verified ? 'Writer grant verified' : readiness?.connectionStatus === 'invalid' ? 'Reconnect required' : 'Not connected'}
        </span>
      </div>
      <div className="ops-mailbox__identity">
        <span>Required primary calendar</span>
        <strong>{readiness?.requiredPrimaryCalendarId || (loading ? 'Checking signed-in identity…' : 'Calendar unavailable')}</strong>
        <small>The signed-in Staff identity determines this address. Connecting does not activate appointment writes.</small>
      </div>
      <ol className="ops-mailbox__route" aria-label="Practitioner calendar readiness path">
        {[
          { label: 'Identity', value: readiness?.actor || 'Checking', state: readiness ? 'ready' : 'pending' },
          { label: 'Writer grant', value: verified ? 'Verified' : readiness?.connectionStatus === 'invalid' ? 'Needs reconnect' : 'Not connected', state: verified ? 'ready' : 'pending' },
          { label: 'Primary calendar', value: primary?.summary || 'Not verified', state: primary && verified ? 'ready' : 'pending' },
          { label: 'Staff booking', value: readiness?.bookingActivationEnabled ? 'Active' : 'Off', state: readiness?.bookingActivationEnabled ? 'ready' : 'off' },
        ].map((step, index) => (
          <li key={step.label} className={`is-${step.state}`}>
            <span className="ops-mailbox__route-marker" aria-hidden="true">{step.state === 'ready' ? <Check /> : null}</span>
            <span><small>{step.label}</small><strong>{step.value}</strong></span>
            {index < 3 ? <ChevronRight className="ops-mailbox__route-arrow" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
      <div className="ops-mailbox__foot">
        <p>This only verifies a writable calendar. No appointment, invite, reminder, or client notification is created.</p>
        {!loading && readiness?.oauthConfigured && !verified ? (
          <button type="button" onClick={connectCalendar} disabled={connecting}>
            {connecting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}
            {connecting ? 'Opening Google…' : readiness.connectionStatus === 'invalid' ? 'Reconnect my calendar' : 'Connect my calendar'}
          </button>
        ) : null}
      </div>
      {callbackMessage ? <p className="ops-mailbox__notice" role="status">{callbackMessage}</p> : null}
      {error ? <p className="ops-mailbox__notice ops-mailbox__notice--error" role="alert">{error}</p> : null}
    </section>
  );
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

const GAP_LABELS: Record<GmailReplySyncGapReason, string> = {
  provider_message_missing: 'Message disappeared before it could be mirrored',
  body_truncated: 'Message body was shortened for safe storage',
  metadata_truncated: 'Message metadata was bounded for safe storage',
  metadata_unusable: 'Message metadata could not be trusted',
};

function evidenceTime(value: string | null | undefined) {
  if (!value) return 'Time unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ReplySyncReview() {
  const [readiness, setReadiness] = useState<StaffGmailReplyReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getStaffGmailReplyReadiness()
      .then((result) => { if (!cancelled) setReadiness(result); })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Reply evidence could not be read');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const reviewCount = readiness?.syncGaps.length || 0;
  const status = loading ? 'Reading evidence' : error ? 'Status unavailable' : reviewCount ? `${reviewCount} review marker${reviewCount === 1 ? '' : 's'}` : readiness?.state === 'quiet' ? 'No markers in view' : 'No checkpoint';

  return (
    <section className="ops-reply-evidence" aria-labelledby="ops-reply-evidence-title">
      <header>
        <span className="ops-reply-evidence__icon" aria-hidden="true"><History /></span>
        <div>
          <p>Local Gmail evidence</p>
          <h2 id="ops-reply-evidence-title">Reply mirror review</h2>
        </div>
        <span className={`ops-reply-evidence__status${reviewCount ? ' is-review' : ''}`} role="status">{status}</span>
      </header>

      <ol className="ops-reply-evidence__rail" aria-label="Reply evidence path">
        <li className={readiness?.checkpoint ? 'is-known' : ''}>
          <i aria-hidden="true" />
          <span><small>Checkpoint</small><strong>{loading ? 'Checking' : readiness?.checkpoint?.historyId || 'Not established'}</strong><em>{readiness?.checkpoint ? evidenceTime(readiness.checkpoint.observedAt) : 'No local high-water mark'}</em></span>
        </li>
        <li className={reviewCount ? 'is-review' : ''}>
          <i aria-hidden="true" />
          <span><small>Review evidence</small><strong>{loading ? 'Checking' : error ? 'Unknown' : reviewCount ? `${reviewCount} marker${reviewCount === 1 ? '' : 's'}` : 'No markers in this read'}</strong><em>Latest bounded local evidence</em></span>
        </li>
        <li className="is-off">
          <i aria-hidden="true" />
          <span><small>Reply sync</small><strong>Off</strong><em>No Gmail polling is running</em></span>
        </li>
      </ol>

      {readiness?.syncGaps.length ? (
        <div className="ops-reply-evidence__reviews">
          <p>Recent review markers</p>
          <ul>
            {readiness.syncGaps.map((gap) => (
              <li key={`${gap.messageId}:${gap.historyId}:${gap.reason}`}>
                <AlertTriangle aria-hidden="true" />
                <span>
                  <strong>{GAP_LABELS[gap.reason] || gap.reason}</strong>
                  <small>{evidenceTime(gap.observedAt)} · Message {gap.messageId} · History {gap.historyId}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="ops-reply-evidence__notice is-error" role="alert">Reply evidence could not be read. Do not treat this as clear. {error}</p> : null}
      {!loading && !error && readiness?.state === 'no_baseline' ? <p className="ops-reply-evidence__notice">No reply checkpoint exists yet. This is expected while reply sync remains dormant.</p> : null}
      <footer>This surface reads Amari’s local evidence only. It does not contact Gmail, start reply sync, or send email.</footer>
    </section>
  );
}

function ledgerTime(value: string | null | undefined) {
  if (!value) return 'Time unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function readableOutcome(value: string | null | undefined) {
  if (!value) return 'Unknown';
  return value.replace(/[_-]+/g, ' ');
}

function CountSummary({ counts }: { counts: OpsLedgerActivity['counts'] }) {
  const total = Number(counts?.total) || 0;
  const completed = Number(counts?.completed) || 0;
  const failed = Number(counts?.failed) || 0;
  const skipped = Number(counts?.skipped) || 0;
  return <span className="ops-ledger__counts">{total} task{total === 1 ? '' : 's'} · {completed} complete{failed ? ` · ${failed} failed` : ''}{skipped ? ` · ${skipped} skipped` : ''}</span>;
}

function LedgerLoadingState() {
  return <div className="ops-ledger__state"><Loader2 className="animate-spin" aria-hidden="true" /><span>Reading the operations ledger…</span></div>;
}

function LedgerEmptyState({ label }: { label: string }) {
  return <div className="ops-ledger__state"><CircleCheck aria-hidden="true" /><strong>No {label} in this ledger.</strong><span>Only recorded operational metadata appears here.</span></div>;
}

function ActivityLedger({ activity }: { activity: OpsLedgerActivity[] }) {
  const groups = new Map<string, { label: string; entries: OpsLedgerActivity[] }>();
  for (const entry of activity) {
    const taskId = entry.taskId || entry.taskLabel || entry.id;
    const existing = groups.get(taskId);
    if (existing) existing.entries.push(entry);
    else groups.set(taskId, { label: entry.taskLabel || 'Untitled task', entries: [entry] });
  }

  if (!groups.size) return <LedgerEmptyState label="activity" />;

  return (
    <div className="ops-ledger__list" aria-label="Activity by task">
      {[...groups.values()].map(({ label, entries }) => {
        const first = entries[0];
        const counts = entries.reduce((total, item) => ({
          total: total.total + (Number(item.counts?.total) || 0),
          completed: total.completed + (Number(item.counts?.completed) || 0),
          failed: total.failed + (Number(item.counts?.failed) || 0),
          skipped: total.skipped + (Number(item.counts?.skipped) || 0),
        }), { total: 0, completed: 0, failed: 0, skipped: 0 });
        const latest = entries.reduce((current, item) => (Date.parse(item.at || '') > Date.parse(current.at || '') ? item : current), first);
        return (
          <details key={first.taskId || first.id} className="ops-ledger__task">
            <summary>
              <span className="ops-ledger__summary-main"><strong>{label}</strong><CountSummary counts={counts} /></span>
              <span className="ops-ledger__summary-meta"><b className={`ops-ledger__outcome ops-ledger__outcome--${latest.outcome || 'unknown'}`}>{readableOutcome(latest.outcome)}</b><time dateTime={latest.at || undefined}>{ledgerTime(latest.at)}</time></span>
            </summary>
            <div className="ops-ledger__task-detail">
              {entries.map((entry) => (
                <div key={entry.id} className="ops-ledger__event">
                  <div><span>Actor</span><strong>{entry.actor || 'Unknown'}</strong></div>
                  <div><span>Requested by</span><strong>{entry.requestedBy || 'Unknown'}</strong></div>
                  <div><span>Counts</span><CountSummary counts={entry.counts} /></div>
                  <div><span>Outcome and time</span><strong>{readableOutcome(entry.outcome)} · {ledgerTime(entry.at)}</strong></div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ChangesLedger({ changes }: { changes: OpsLedgerChange[] }) {
  if (!changes.length) return <LedgerEmptyState label="changes" />;
  return (
    <div className="ops-ledger__list" aria-label="Releases and configuration changes">
      {changes.map((change) => (
        <article key={change.id} className="ops-ledger__change">
          <header>
            <span className="ops-ledger__kind">{readableOutcome(change.kind)}</span>
            <time dateTime={change.at || undefined}>{ledgerTime(change.at)}</time>
          </header>
          <h3>{change.label || 'Recorded change'}</h3>
          {change.taskLabel ? <p className="ops-ledger__link">Task: {change.taskLabel}</p> : null}
          <div className="ops-ledger__transition" aria-label="Change from previous state to current state">
            <span><small>From</small><strong>{change.from || 'Not recorded'}</strong></span>
            <span className="ops-ledger__arrow" aria-hidden="true">→</span>
            <span><small>To</small><strong>{change.to || 'Not recorded'}</strong></span>
          </div>
          <dl className="ops-ledger__proof">
            <div><dt><ShieldCheck aria-hidden="true" /> Verification</dt><dd>{change.verification || 'Not recorded'}</dd></div>
            <div><dt><RotateCcw aria-hidden="true" /> Rollback</dt><dd>{change.rollback || 'Not recorded'}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function IncidentGroup({ label, incidents }: { label: string; incidents: OpsLedgerIncident[] }) {
  if (!incidents.length) return null;
  return (
    <section className="ops-ledger__incident-group" aria-labelledby={`ops-ledger-${label.toLowerCase()}-title`}>
      <h3 id={`ops-ledger-${label.toLowerCase()}-title`}>{label}<span>{incidents.length}</span></h3>
      <div className="ops-ledger__list">
        {incidents.map((incident) => (
          <article key={incident.id} className="ops-ledger__incident">
            <header><span className={`ops-ledger__status ops-ledger__status--${incident.status}`}>{readableOutcome(incident.status)}</span><span className={`ops-ledger__severity ops-ledger__severity--${incident.severity}`}>{readableOutcome(incident.severity)}</span></header>
            <h4>{incident.title || 'Operational incident'}</h4>
            <dl>
              <div><dt>Task</dt><dd>{incident.taskLabel || 'Not linked'}</dd></div>
              <div><dt>Release</dt><dd>{incident.releaseLabel || 'Not linked'}</dd></div>
              <div><dt>{incident.status === 'resolved' ? 'Resolved' : 'Opened'}</dt><dd>{ledgerTime(incident.status === 'resolved' ? incident.resolvedAt : incident.openedAt)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function IncidentsLedger({ incidents }: { incidents: OpsLedgerIncident[] }) {
  if (!incidents.length) return <LedgerEmptyState label="incidents" />;
  const open = incidents.filter((incident) => incident.status === 'open');
  const resolved = incidents.filter((incident) => incident.status === 'resolved');
  return <div className="ops-ledger__incident-groups"><IncidentGroup label="Open" incidents={open} /><IncidentGroup label="Resolved" incidents={resolved} /></div>;
}

function OperationsLedgerView({ tab, ledger, loading, error }: { tab: 'activity' | 'changes' | 'incidents'; ledger: OpsLedger | null; loading: boolean; error: string | null }) {
  const title = tab === 'activity' ? 'Activity by task' : tab === 'changes' ? 'Releases and configuration' : 'Incident register';
  const description = tab === 'activity'
    ? 'A bounded account of operational work, with task details kept collapsed until needed.'
    : tab === 'changes'
      ? 'Release and configuration movement, with verification and rollback evidence alongside each change.'
      : 'Open and resolved incidents linked to the task or release that owns the work.';
  return (
    <section className="ops-ledger" aria-labelledby="ops-ledger-title">
      <header className="ops-ledger__head">
        <div><p>Read-only operations ledger</p><h2 id="ops-ledger-title">{title}</h2><span>{description}</span></div>
        {ledger?.generatedAt ? <time dateTime={ledger.generatedAt}>Updated {ledgerTime(ledger.generatedAt)}</time> : null}
      </header>
      {loading ? <LedgerLoadingState /> : error ? <div className="ops-ledger__state ops-ledger__state--error" role="alert"><CircleAlert aria-hidden="true" /><strong>Operations ledger unavailable.</strong><span>{error}</span></div> : !ledger ? <LedgerEmptyState label={tab} /> : tab === 'activity' ? <ActivityLedger activity={ledger.activity || []} /> : tab === 'changes' ? <ChangesLedger changes={ledger.changes || []} /> : <IncidentsLedger incidents={ledger.incidents || []} />}
      <footer className="ops-ledger__foot">Staff shows operational metadata only. Customer names, contact IDs, message content, and raw provider data are excluded.</footer>
    </section>
  );
}

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const [mailCallbackState] = useState<'connected' | 'failed' | null>(() => {
    const value = params.get('amariMail');
    return value === 'connected' || value === 'failed' ? value : null;
  });
  const [calendarCallbackState] = useState<'connected' | 'failed' | null>(() => {
    const value = params.get('staffCalendar');
    return value === 'connected' || value === 'failed' ? value : null;
  });
  const navigate = useNavigate();
  const tab = tabFromSearch(params.get('tab'));
  const [board, setBoard] = useState<OpsSystemsBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<OpsLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [crmSrc, setCrmSrc] = useState<string | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [automationSrc, setAutomationSrc] = useState<string | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);

  useEffect(() => {
    if (!mailCallbackState && !calendarCallbackState) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('amariMail');
      next.delete('staffCalendar');
      return next;
    }, { replace: true });
  }, [mailCallbackState, calendarCallbackState, setParams]);

  useEffect(() => {
    if (tab !== 'overview' || board) return;
    let cancelled = false;
    void getOpsSystemsBoard()
      .then((data) => { if (!cancelled) setBoard(data); })
      .catch((err) => { if (!cancelled) setBoardError(err instanceof Error ? err.message : 'Could not load system status'); });
    return () => { cancelled = true; };
  }, [tab, board]);

  useEffect(() => {
    if (!['activity', 'changes', 'incidents'].includes(tab) || ledger) return;
    let cancelled = false;
    setLedgerLoading(true);
    setLedgerError(null);
    void getOpsLedger()
      .then((data) => { if (!cancelled) setLedger(data); })
      .catch((err) => { if (!cancelled) setLedgerError(err instanceof Error ? err.message : 'Could not load the operations ledger'); })
      .finally(() => { if (!cancelled) setLedgerLoading(false); });
    return () => { cancelled = true; };
  }, [tab, ledger]);

  useEffect(() => {
    if (tab !== 'crm') return;
    if (crmSrc) return;
    let cancelled = false;
    setCrmLoading(true);
    setCrmError(null);
    void getCrmMirrorAccessUrl()
      .then(({ url }) => {
        if (cancelled) return;
        const joined = `${url}${url.includes('?') ? '&' : '?'}embed=1&parent_origin=${encodeURIComponent(window.location.origin)}`;
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
        const joined = `${url}${url.includes('?') ? '&' : '?'}embed=1&parent_origin=${encodeURIComponent(window.location.origin)}`;
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

  useEffect(() => {
    function sessionExpired(event: MessageEvent) {
      const matches = (src: string | null, type: string) => {
        if (!src || event.data?.type !== type) return false;
        try { return event.origin === new URL(src).origin; } catch { return false; }
      };
      if (matches(crmSrc, 'amari:staff-crm-session-expired')) setCrmSrc(null);
      if (matches(automationSrc, 'amari:staff-automation-session-expired')) setAutomationSrc(null);
    }
    window.addEventListener('message', sessionExpired);
    return () => window.removeEventListener('message', sessionExpired);
  }, [crmSrc, automationSrc]);

  function selectTab(next: OpsTab) {
    setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  }

  const frameSrc = tab === 'systems' ? SYSTEMS_SRC : tab === 'automation' ? automationSrc : tab === 'crm' ? crmSrc : null;
  const attention = (board?.systems || []).filter((system) => ['red', 'sick', 'stuck', 'map_bad'].includes(system.state));

  return (
    <main className={`ops-hub${tab !== 'overview' ? ' ops-hub--framed' : ''}`}>
      <header className="ops-hub__head">
        <Link to="/" className="ops-hub__back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div>
          <p>Operator surfaces</p>
          <h1>Operations</h1>
          <span>The working picture of the practice, with a direct route into each workspace.</span>
          <small className="ops-hub__build">Staff build {currentStaffBuildIdentity()}</small>
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
          <PractitionerCalendarReadiness callbackState={calendarCallbackState} />
          <ReplySyncReview />
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

      {tab !== 'overview' ? <section className={`ops-hub__frame${['activity', 'changes', 'incidents'].includes(tab) ? ' ops-hub__frame--ledger' : ''}`} aria-label={TABS.find((item) => item.id === tab)?.label}>
        {['activity', 'changes', 'incidents'].includes(tab) ? (
          <OperationsLedgerView tab={tab as 'activity' | 'changes' | 'incidents'} ledger={ledger} loading={ledgerLoading} error={ledgerError} />
        ) : null}
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
