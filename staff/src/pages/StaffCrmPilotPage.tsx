import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Archive,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Ellipsis,
  Home,
  Loader2,
  MessageSquare,
  Package,
  Phone,
  Search,
  Send,
  SlidersHorizontal,
  Users,
  WalletCards,
  Workflow,
} from 'lucide-react';
import {
  getCalendarSummary,
  getCrmPilotContact,
  getCrmPilotInbox,
  getBalances,
  getOpsSystemsBoard,
  getPartnerProspects,
  getPipeline,
  getStaffProducts,
  getStaffRevenue,
  type CrmPilotContactResponse,
  type CrmPilotThread,
  type OpsSystemsBoard,
  type PipelineCard,
  type PipelineColumns,
  type PipelineData,
  type StaffProduct,
  type StaffProductsResponse,
  type StaffRevenueData,
} from '../lib/api';
import { conversationWorkState, type ConversationWorkState } from '../lib/conversation-work-state';
import type { BalanceRow, BalancesResponse, PartnerProspect, PartnerProspectsResponse, TodayAppointment } from '../types/staff';
import './StaffCrmPilotPage.css';

type PilotSurface = 'home' | 'inbox' | 'outreach' | 'pipeline' | 'products' | 'money';
type InboxView = ConversationWorkState | 'all';

type PilotConversation = CrmPilotThread & {
  id: string;
  initials: string;
  name: string;
  preview: string;
  age: string;
  state: ConversationWorkState;
  reason: string;
};

const stateLabel: Record<ConversationWorkState, string> = {
  needs_reply: 'Needs reply',
  waiting: 'Waiting',
  done: 'Done',
};

const pipelineStages: { id: keyof PipelineColumns; label: string; phase: string }[] = [
  { id: 'touch-1', label: 'First touch', phase: 'Outreach' },
  { id: 'touch-2', label: 'Second touch', phase: 'Outreach' },
  { id: 'touch-3', label: 'Third touch', phase: 'Outreach' },
  { id: 'touch-4', label: 'Fourth touch', phase: 'Outreach' },
  { id: 'touch-5', label: 'Fifth touch', phase: 'Outreach' },
  { id: 'touch-6', label: 'Sixth touch+', phase: 'Outreach' },
  { id: 'discovery-noshow', label: 'Discovery missed', phase: 'Discovery' },
  { id: 'discovery', label: 'Discovery complete', phase: 'Discovery' },
  { id: 'session-noshow', label: 'First session missed', phase: 'Care' },
  { id: 'first-session', label: 'First session complete', phase: 'Care' },
  { id: 'multipack-1', label: 'First purchase', phase: 'Client' },
  { id: 'multipack-2', label: 'Repeat purchase', phase: 'Client' },
];

function pipelineCardNote(card: PipelineCard, stage: keyof PipelineColumns) {
  if (stage === 'multipack-1' || stage === 'multipack-2' || stage === 'first-session') {
    if (card.seriesType && card.seriesType !== 'none') {
      return `${card.sessionsCompleted} complete · ${card.sessionsRemaining} remaining`;
    }
    return card.sessionsCompleted ? `${card.sessionsCompleted} session${card.sessionsCompleted === 1 ? '' : 's'} complete` : 'Care record';
  }
  return card.touchCount ? `${card.touchCount} recorded touch${card.touchCount === 1 ? '' : 'es'}` : 'No recorded touch';
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const preciseMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const OFFSET_OR_Z = /([+-]\d{2}:?\d{2}|Z)$/i;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function pacificDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
}

function relativeTime(value: string | null) {
  if (!value) return 'No activity';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}d`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function pacificWallClockAsUtc(ms: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '0';
  return Date.UTC(+value('year'), +value('month') - 1, +value('day'), +value('hour') % 24, +value('minute'), +value('second'));
}

function appointmentMs(value: string) {
  if (!value) return Number.NaN;
  if (OFFSET_OR_Z.test(value)) return new Date(value).getTime();
  const match = NAIVE_DATETIME.exec(value);
  if (!match) return Number.NaN;
  const naiveAsUtc = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
  let ms = naiveAsUtc - (pacificWallClockAsUtc(naiveAsUtc) - naiveAsUtc);
  ms = naiveAsUtc - (pacificWallClockAsUtc(ms) - ms);
  return ms;
}

function appointmentTime(value: string) {
  const ms = appointmentMs(value);
  if (!Number.isFinite(ms)) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(new Date(ms));
}

function fullDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
  }).format(value);
}

function dayLabel(value: string | null) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  }).format(new Date(value));
}

function messageTime(value: string | null) {
  if (!value) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(new Date(value));
}

function reasonFor(state: ConversationWorkState, preview: string) {
  if (state === 'needs_reply') return 'Client is waiting';
  if (state === 'waiting') return 'Waiting for client';
  const reaction = /^(liked|loved|laughed at|emphasized|questioned|disliked)\b/i.test(preview);
  return reaction ? 'Reaction closed automatically' : 'Conversation complete';
}

function toConversation(thread: CrmPilotThread): PilotConversation {
  const name = thread.display_name || thread.email_normalized || thread.phone_e164 || 'Unnamed contact';
  const preview = thread.last_preview || 'No communication mirrored yet.';
  const state = conversationWorkState(thread.last_direction, preview, thread.last_event_at);
  return {
    ...thread,
    id: thread.thread_id || thread.contact_id,
    initials: initials(name),
    name,
    preview,
    age: relativeTime(thread.last_event_at),
    state,
    reason: reasonFor(state, preview),
  };
}

function goToCurrentStaff(path: string) {
  window.location.assign(`/staff${path}`);
}

function PilotMark() {
  return <span className="crm-pilot__mark" aria-hidden="true">A</span>;
}

function CollectionHead({ eyebrow, title, detail, action, onAction }: { eyebrow: string; title: string; detail: string; action: string; onAction: () => void }) {
  return <header className="crm-collection__head"><div><p>{eyebrow}</p><h1>{title}</h1><span>{detail}</span></div><button onClick={onAction}>{action}<ChevronRight /></button></header>;
}

function OutreachPreview({ people }: { people: PartnerProspect[] }) {
  return <div className="crm-outreach__rows">{people.map((person, index) => <button key={person.contactId} onClick={() => goToCurrentStaff(`/outreach?contact=${encodeURIComponent(person.contactId)}`)}><span className="crm-outreach__rank">{String(index + 1).padStart(2, '0')}</span><span className="crm-avatar">{initials(person.fullName)}</span><span className="crm-outreach__person"><strong>{person.fullName || 'Unnamed prospect'}</strong><small>{person.partnerFacility || person.companyName || person.category || 'Prospect'}</small></span><span className="crm-outreach__next"><strong>{person.derived?.action === 'text' ? 'Send a text' : person.derived?.action === 'discovery' ? 'Find the right person' : person.derived?.action === 'decide' ? 'Decide next step' : 'Make a call'}</strong><small>{person.derived?.why || person.stageLabel || 'Proactive outreach is due'}</small></span><span className="crm-outreach__touch"><strong>{person.touchCount || 0}</strong><small>touches</small></span><ChevronRight /></button>)}</div>;
}

function ProductPreviewGroup({ title, detail, products, tone }: { title: string; detail: string; products: StaffProduct[]; tone: 'current' | 'custom' | 'legacy' }) {
  return <section className={`crm-products__group crm-products__group--${tone}`}><header><div><p>{title}</p><span>{detail}</span></div><b>{products.length}</b></header><div>{products.map(product => { const ready = product.readiness === 'ready' && product.availableInPos; return <button key={product.key} onClick={() => goToCurrentStaff('/products')}><span className="crm-products__icon"><Package /></span><span className="crm-products__identity"><strong>{product.name}</strong><small>{product.description || product.internalReason}</small></span><span className="crm-products__effect"><small>After payment</small><strong>{product.fulfillmentSummary}</strong></span><span className="crm-products__price"><strong>{preciseMoney.format(product.amountCents / 100)}</strong><small className={ready ? 'is-ready' : 'needs-work'}>{ready ? 'Ready in POS' : 'Review needed'}</small></span><ChevronRight /></button>; })}{products.length === 0 ? <p className="crm-products__empty">No products in this group.</p> : null}</div></section>;
}

function BalancePreview({ rows }: { rows: BalanceRow[] }) {
  return <div className="crm-money__rows">{rows.map(row => <button key={row.id} onClick={() => goToCurrentStaff(`/client/${encodeURIComponent(row.id)}`)}><span className="crm-avatar">{initials(row.name)}</span><span><strong>{row.name}</strong><small>{row.seriesType === 'none' ? 'No active series' : row.seriesType}</small></span><span><strong>{row.purchased ?? '—'}</strong><small>Purchased</small></span><span><strong>{row.attended}</strong><small>Completed</small></span><span className={row.remaining <= 1 ? 'is-low' : ''}><strong>{row.remaining}</strong><small>Remaining</small></span><time>{row.lastSessionDate ? dayLabel(row.lastSessionDate) : 'No recent visit'}</time><ChevronRight /></button>)}</div>;
}

export default function StaffCrmPilotPage() {
  const [surface, setSurface] = useState<PilotSurface>('home');
  const [view, setView] = useState<InboxView>('needs_reply');
  const [threads, setThreads] = useState<CrmPilotThread[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<CrmPilotContactResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [schedule, setSchedule] = useState<TodayAppointment[]>([]);
  const [systems, setSystems] = useState<OpsSystemsBoard | null>(null);
  const [revenue, setRevenue] = useState<StaffRevenueData | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [outreach, setOutreach] = useState<PartnerProspectsResponse | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [products, setProducts] = useState<StaffProductsResponse | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getCrmPilotInbox()
      .then(result => {
        if (!active) return;
        const nextThreads = result.threads || [];
        setThreads(nextThreads);
        const nextConversations = nextThreads.map(toConversation);
        setSelectedId(nextConversations.find(item => item.state === 'needs_reply')?.contact_id || nextConversations[0]?.contact_id || '');
        setInboxError(null);
      })
      .catch(error => { if (active) setInboxError(error instanceof Error ? error.message : 'Inbox could not be loaded.'); })
      .finally(() => { if (active) setInboxLoading(false); });

    void Promise.allSettled([getCalendarSummary(pacificDate()), getOpsSystemsBoard(), getStaffRevenue(6)])
      .then(([scheduleResult, systemsResult, revenueResult]) => {
        if (!active) return;
        if (scheduleResult.status === 'fulfilled') setSchedule(scheduleResult.value.filter(item => item.appointmentStatus?.toLowerCase() !== 'cancelled'));
        if (systemsResult.status === 'fulfilled') setSystems(systemsResult.value);
        if (revenueResult.status === 'fulfilled') setRevenue(revenueResult.value);
      })
      .finally(() => { if (active) setHomeLoading(false); });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (surface !== 'pipeline' || pipeline) return;
    let active = true;
    setPipelineLoading(true);
    setPipelineError(null);
    void getPipeline()
      .then(result => { if (active) setPipeline(result); })
      .catch(error => { if (active) setPipelineError(error instanceof Error ? error.message : 'Pipeline could not be loaded.'); })
      .finally(() => { if (active) setPipelineLoading(false); });
    return () => { active = false; };
  }, [pipeline, surface]);

  useEffect(() => {
    if (surface !== 'outreach' || outreach) return;
    let active = true;
    setOutreachLoading(true);
    setOutreachError(null);
    void getPartnerProspects()
      .then(result => { if (active) setOutreach(result); })
      .catch(error => { if (active) setOutreachError(error instanceof Error ? error.message : 'Outreach could not be loaded.'); })
      .finally(() => { if (active) setOutreachLoading(false); });
    return () => { active = false; };
  }, [outreach, surface]);

  useEffect(() => {
    if (surface !== 'products' || products) return;
    let active = true;
    setProductsLoading(true);
    setProductsError(null);
    void getStaffProducts()
      .then(result => { if (active) setProducts(result); })
      .catch(error => { if (active) setProductsError(error instanceof Error ? error.message : 'Products could not be loaded.'); })
      .finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [products, surface]);

  useEffect(() => {
    if (surface !== 'money' || balances) return;
    let active = true;
    setBalancesLoading(true);
    setBalancesError(null);
    void getBalances()
      .then(result => { if (active) setBalances(result); })
      .catch(error => { if (active) setBalancesError(error instanceof Error ? error.message : 'Balances could not be loaded.'); })
      .finally(() => { if (active) setBalancesLoading(false); });
    return () => { active = false; };
  }, [balances, surface]);

  const conversations = useMemo(() => threads.map(toConversation), [threads]);
  const actionable = useMemo(() => conversations.filter(item => item.state === 'needs_reply'), [conversations]);
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return conversations.filter(item => {
      const isInView = view === 'all' || item.state === view;
      const matchesSearch = !normalizedQuery || `${item.name} ${item.preview} ${item.email_normalized || ''} ${item.phone_e164 || ''}`.toLocaleLowerCase().includes(normalizedQuery);
      return isInView && matchesSearch;
    });
  }, [conversations, query, view]);
  const selected = visibleConversations.find(item => item.contact_id === selectedId)
    || visibleConversations[0]
    || null;

  useEffect(() => {
    if (visibleConversations.length > 0 && !visibleConversations.some(item => item.contact_id === selectedId)) {
      setSelectedId(visibleConversations[0].contact_id);
    }
  }, [selectedId, visibleConversations]);

  useEffect(() => {
    if (!selected?.contact_id) {
      setSelectedDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    void getCrmPilotContact(selected.contact_id)
      .then(result => { if (active) setSelectedDetail(result); })
      .catch(error => { if (active) { setSelectedDetail(null); setDetailError(error instanceof Error ? error.message : 'Contact history could not be loaded.'); } })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected?.contact_id]);

  const orderedSchedule = useMemo(() => [...schedule].sort((a, b) => appointmentMs(a.startTime) - appointmentMs(b.startTime)), [schedule]);
  const systemIssues = systems?.systems.filter(item => ['red', 'sick', 'stuck', 'map_bad'].includes(item.state)) || [];
  const totalAttention = actionable.length + (systems?.attentionCount || 0);
  const messages = useMemo(() => [...(selectedDetail?.communicationTimeline || [])].reverse(), [selectedDetail]);
  const lastVisit = selectedDetail?.appointments?.find(item => item.status?.toLowerCase() !== 'cancelled' && new Date(item.starts_at).getTime() < Date.now()) || null;
  const pipelineTotal = pipeline ? Object.values(pipeline.columns).reduce((sum, cards) => sum + cards.length, 0) : 0;
  const needsReplyExternalIds = useMemo(() => new Set(actionable.map(item => item.external_contact_id).filter(Boolean)), [actionable]);
  const outreachDue = useMemo(() => (outreach?.prospects || [])
    .filter(person => person.derived?.kind === 'act' && !needsReplyExternalIds.has(person.contactId))
    .sort((a, b) => (b.derived?.urgency || 0) - (a.derived?.urgency || 0))
    .slice(0, 30), [needsReplyExternalIds, outreach]);
  const outreachWaiting = outreach?.prospects.filter(person => person.derived?.kind === 'waiting').length || 0;
  const productGroups = useMemo(() => ({
    current: products?.products.filter(product => product.salesPolicy === 'current') || [],
    custom: products?.products.filter(product => product.salesPolicy === 'custom') || [],
    legacy: products?.products.filter(product => product.salesPolicy === 'legacy') || [],
  }), [products]);
  const orderedBalances = useMemo(() => [...(balances?.rows || [])].sort((a, b) => b.remaining - a.remaining), [balances]);

  const openSurface = (next: PilotSurface) => {
    setSurface(next);
    setThreadOpen(false);
  };

  const openConversation = (contactId: string) => {
    setSelectedId(contactId);
    setThreadOpen(true);
  };

  const openCurrentInbox = () => {
    const externalId = selectedDetail?.contact.ghl_contact_id || selected?.external_contact_id;
    goToCurrentStaff(`/client-desk${externalId ? `?contact=${encodeURIComponent(externalId)}` : ''}`);
  };

  return (
    <main className="crm-pilot">
      <aside className="crm-pilot__rail">
        <div className="crm-pilot__brand"><PilotMark /><span><strong>Amari Method</strong><small>Staff workspace preview</small></span></div>
        <p className="crm-pilot__rail-label">Practice</p>
        <nav aria-label="Practice navigation">
          <button className={surface === 'home' ? 'is-active' : ''} onClick={() => openSurface('home')}><Home /><span>Home</span></button>
          <button onClick={() => goToCurrentStaff('/calendar')}><CalendarDays /><span>Calendar</span></button>
          <button className={surface === 'inbox' ? 'is-active' : ''} onClick={() => openSurface('inbox')}><MessageSquare /><span>Inbox</span>{actionable.length > 0 ? <b>{actionable.length}</b> : null}</button>
          <button onClick={() => goToCurrentStaff('/clients')}><Users /><span>People</span></button>
          <button className={surface === 'outreach' ? 'is-active' : ''} onClick={() => openSurface('outreach')}><Send /><span>Outreach</span></button>
          <button className={surface === 'pipeline' ? 'is-active' : ''} onClick={() => openSurface('pipeline')}><Workflow /><span>Pipeline</span></button>
        </nav>
        <div className="crm-pilot__rail-foot">
          <p className="crm-pilot__rail-label">Business</p>
          <nav><button className={surface === 'products' ? 'is-active' : ''} onClick={() => openSurface('products')}><SlidersHorizontal /><span>Products</span></button><button className={surface === 'money' ? 'is-active' : ''} onClick={() => openSurface('money')}><WalletCards /><span>Money</span></button></nav>
          <div className="crm-pilot__actor"><span>AM</span><div><strong>Private preview</strong><small>Real data · read only</small></div></div>
        </div>
      </aside>

      <section className="crm-pilot__workspace">
        <header className="crm-pilot__mobile-head"><div><PilotMark /><strong>Staff preview</strong></div><button aria-label="Search" onClick={() => openSurface('inbox')}><Search /></button></header>

        {surface === 'home' ? (
          <section className="crm-home">
            <header className="crm-home__opening"><div><p>{fullDate()}</p><h1>Good morning.</h1></div><span>{homeLoading ? 'Loading today’s practice data.' : `${orderedSchedule.length} ${orderedSchedule.length === 1 ? 'session' : 'sessions'} today. ${actionable.length} ${actionable.length === 1 ? 'conversation needs' : 'conversations need'} a reply${systems?.attentionCount ? `, and ${systems.attentionCount} system ${systems.attentionCount === 1 ? 'issue needs' : 'issues need'} review` : ''}.`}</span></header>
            {inboxError ? <div className="crm-pilot__notice" role="alert">Inbox data is unavailable. {inboxError}</div> : null}
            <div className="crm-home__primary-grid">
              <section><header className="crm-section-head"><h2>Today</h2><span>Pacific time</span></header><div className="crm-schedule"><header><strong>Session schedule</strong><span>{homeLoading ? 'Loading' : `${orderedSchedule.length} booked`}</span></header>{orderedSchedule.slice(0, 5).map(item => <button key={item.id} onClick={() => goToCurrentStaff(`/client/${encodeURIComponent(item.contactId)}/session?appointment=${encodeURIComponent(item.id)}`)}><time>{appointmentTime(item.startTime)}</time><i /><span><strong>{item.contactName}</strong><small>{item.title || item.calendarName}</small></span><em>Open session</em></button>)}{!homeLoading && orderedSchedule.length === 0 ? <p className="crm-schedule__empty">No sessions are on today’s schedule.</p> : null}</div><footer className="crm-schedule-foot"><span>{orderedSchedule.length > 5 ? `${orderedSchedule.length - 5} more today` : 'Live Staff calendar'}</span><button onClick={() => goToCurrentStaff('/calendar')}>Open calendar</button></footer></section>
              <section><header className="crm-section-head"><h2>Attention</h2><span>{totalAttention} {totalAttention === 1 ? 'item' : 'items'}</span></header><div className="crm-attention"><header><strong>Work requiring a person</strong><span>{actionable.length} {actionable.length === 1 ? 'reply' : 'replies'} · {systems?.attentionCount || 0} {(systems?.attentionCount || 0) === 1 ? 'system' : 'systems'}</span></header>{actionable.slice(0, 3).map(item => <button key={item.id} onClick={() => { openSurface('inbox'); openConversation(item.contact_id); }}><span className="crm-attention__icon"><MessageSquare /></span><span><strong>{item.name}</strong><small>{item.preview}</small></span><time>{item.age}</time></button>)}{systemIssues.slice(0, 1).map(item => <button key={item.id} onClick={() => goToCurrentStaff('/operations')}><span className="crm-attention__icon crm-attention__icon--system"><Workflow /></span><span><strong>{item.label}</strong><small>{item.note || item.status}</small></span><time>Review</time></button>)}{!inboxLoading && totalAttention === 0 ? <p className="crm-attention__empty">Nothing needs attention right now.</p> : null}</div><div className="crm-settled"><Check /><span><strong>{conversations.filter(item => item.state === 'done').length} conversations are outside the work queue</strong><small>Clear reactions and closing acknowledgements remain available in All without counting as work.</small></span></div></section>
            </div>
            <div className="crm-home__secondary-grid"><section><header className="crm-section-head"><h2>Practice</h2><span>{revenue?.thisMonth.month || 'Current month'}</span></header><div className="crm-metrics"><div><span>Sessions today</span><strong>{homeLoading ? '…' : orderedSchedule.length}</strong><small>Live calendar</small></div><div><span>Collected</span><strong>{revenue ? money.format(revenue.thisMonth.gross) : '—'}</strong><small>{revenue?.thisMonth.chargeCount || 0} successful charges</small></div><div><span>Needs review</span><strong>{systems?.attentionCount ?? '—'}</strong><small>Monitored systems</small></div></div></section><section><header className="crm-section-head"><h2>Quick access</h2></header><div className="crm-quick"><button onClick={openCurrentInbox}><span>Open the current message desk</span><ChevronRight /></button><button onClick={() => goToCurrentStaff('/balances')}><span>Review session balances</span><ChevronRight /></button><button onClick={() => goToCurrentStaff('/clients')}><span>Find a practice member</span><ChevronRight /></button></div></section></div>
          </section>
        ) : surface === 'inbox' ? (
          <section className={`crm-inbox${threadOpen ? ' is-thread-open' : ''}`}>
            <section className="crm-inbox__list">
              <header><h1>Inbox</h1><p>Real mirrored conversations · read-only preview</p><label><Search /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
              <nav className="crm-inbox__tabs" aria-label="Inbox views">{(['needs_reply','waiting','done','all'] as InboxView[]).map(tab => <button key={tab} className={view === tab ? 'is-active' : ''} onClick={() => { setView(tab); setThreadOpen(false); }}>{tab === 'all' ? 'All' : stateLabel[tab]}{tab === 'needs_reply' ? ` · ${actionable.length}` : ''}</button>)}</nav>
              <div className="crm-inbox__rows">{inboxLoading ? <div className="crm-inbox__loading"><Loader2 /> Loading conversations…</div> : null}{inboxError ? <p className="crm-inbox__empty" role="alert">{inboxError}</p> : null}{!inboxLoading && !inboxError ? visibleConversations.map(item => <button key={item.contact_id} className={selected?.contact_id === item.contact_id ? 'is-active' : ''} onClick={() => openConversation(item.contact_id)}><span className="crm-avatar">{item.initials}</span><span><strong>{item.name}</strong><small>{item.preview}</small><em>{item.reason}</em></span><time>{item.age}</time></button>) : null}{!inboxLoading && !inboxError && visibleConversations.length === 0 ? <div className="crm-inbox__empty"><Check /><strong>{query.trim() ? 'No matching conversations' : view === 'needs_reply' ? 'Nobody is waiting for a reply' : `No conversations are ${view === 'waiting' ? 'waiting' : 'in this view'}`}</strong><span>{query.trim() ? 'Try another name, email, phone number, or message.' : view === 'needs_reply' ? 'New substantive replies will appear here. The complete record stays in All.' : 'Choose another view to continue.'}</span>{view !== 'all' && !query.trim() ? <button onClick={() => setView('all')}>Open all conversations</button> : null}</div> : null}</div>
              <footer>Needs reply is derived from the latest mirrored sender and clear terminal-message rules. This preview does not change conversation state or send messages.</footer>
            </section>

            <section className="crm-thread">
              {!selected ? <div className="crm-thread__empty"><MessageSquare /><strong>Select a conversation</strong><span>All mirrored contacts remain available in All.</span></div> : <>
                <header><div className="crm-thread__person"><button className="crm-thread__back" aria-label="Back to inbox" onClick={() => setThreadOpen(false)}><ArrowLeft /></button><span className="crm-avatar">{selected.initials}</span><div><h2>{selected.name}</h2><p>Practice record · {selected.channel || 'No channel'}</p></div></div><div className="crm-thread__actions"><button onClick={openCurrentInbox}>Open current Inbox</button><button className="is-primary" disabled title="State changes are disabled in the private read-only preview">{selected.state === 'done' ? 'Done' : 'Mark done'}</button><button aria-label="More actions" disabled><Ellipsis /></button></div></header>
                <div className="crm-thread__stream">{detailLoading ? <div className="crm-thread__loading"><Loader2 /> Loading complete history…</div> : null}{detailError ? <p className="crm-thread__error" role="alert">{detailError}</p> : null}{!detailLoading && !detailError && messages.length === 0 ? <p className="crm-thread__error">No communication has been mirrored for this contact.</p> : null}{!detailLoading && !detailError ? messages.map((message, index) => { const previous = messages[index - 1]; const showDay = !previous || dayLabel(previous.occurred_at) !== dayLabel(message.occurred_at); const body = message.body_clean || message.subject || 'Message content is not available in the mirror.'; return <div key={message.id || message.message_ref || `${message.occurred_at}-${index}`}>{showDay ? <div className="crm-thread__date"><span>{dayLabel(message.occurred_at)}</span></div> : null}<div className={`crm-bubble-row ${message.direction === 'outbound' ? 'is-outbound' : ''}`}><div className="crm-bubble">{body}<small>{message.direction === 'outbound' ? message.sender_label || 'Staff' : selected.name.split(' ')[0]} · {message.thread_channel || message.event_kind || 'message'} · {messageTime(message.occurred_at)}</small></div></div></div>; }) : null}<div className={`crm-thread__state crm-thread__state--${selected.state}`}>{selected.state === 'needs_reply' ? `Waiting for Staff · ${selected.age}` : selected.state === 'waiting' ? 'Waiting for client' : 'Conversation complete'}</div></div>
                <footer className="crm-composer crm-composer--readonly"><div><textarea aria-label="Message" value="" readOnly placeholder="Replying stays in the current Inbox during this read-only pilot." /><button aria-label="Open current Inbox to reply" onClick={openCurrentInbox}><Send /></button></div><p><span>Real history from the owned mirror</span><span>No message can be sent here</span></p></footer>
              </>}
            </section>

            <aside className="crm-person">{!selected ? null : detailLoading ? <div className="crm-person__loading"><Loader2 /> Loading record…</div> : selectedDetail ? <><header><span className="crm-avatar">{selected.initials}</span><h2>{selectedDetail.contact.display_name || selected.name}</h2><p>{selectedDetail.contact.created_at ? `Record since ${dayLabel(selectedDetail.contact.created_at)}` : 'Practice record'}</p></header><section><h3>Contact</h3><dl><div><dt>Phone</dt><dd>{selectedDetail.contact.phone_e164 || 'Not recorded'}</dd></div><div><dt>Email</dt><dd>{selectedDetail.contact.email_normalized || 'Not recorded'}</dd></div><div><dt>Source</dt><dd>{selectedDetail.contact.referral_source_label || 'Not recorded'}</dd></div></dl></section><section><h3>Next appointment</h3>{selectedDetail.nextAppointment ? <div className="crm-person__appointment"><strong>{dayLabel(selectedDetail.nextAppointment.starts_at)} · {appointmentTime(selectedDetail.nextAppointment.starts_at)}</strong><span>{selectedDetail.nextAppointment.service_name || selectedDetail.nextAppointment.status || 'Appointment'}</span></div> : <p className="crm-person__quiet">No upcoming appointment mirrored.</p>}<button onClick={() => goToCurrentStaff('/calendar')}>Open calendar</button></section><section><h3>Current context</h3><dl><div><dt>Series</dt><dd>{selectedDetail.importedCurrentState?.series_type || 'Not recorded'}</dd></div><div><dt>Balance</dt><dd>{selectedDetail.importedCurrentState?.sessions_remaining ?? 'Not recorded'}</dd></div><div><dt>Last visit</dt><dd>{lastVisit ? dayLabel(lastVisit.starts_at) : 'Not recorded'}</dd></div></dl><button onClick={openCurrentInbox}>Open full current record</button></section></> : <p className="crm-person__quiet">The selected record is unavailable.</p>}</aside>
          </section>
        ) : surface === 'pipeline' ? (
          <section className="crm-pipeline">
            <header className="crm-pipeline__head"><div><p>Practice development</p><h1>Pipeline</h1><span>{pipelineLoading ? 'Loading the current care flow.' : pipelineError ? 'The current care flow is temporarily unavailable.' : `${pipelineTotal} people across outreach, discovery, and care.`}</span></div><button onClick={() => goToCurrentStaff('/pipeline')}><span>Open current pipeline</span><ChevronRight /></button></header>
            {pipelineError ? <div className="crm-pilot__notice" role="alert">Pipeline data is unavailable. {pipelineError}</div> : null}
            {pipelineLoading ? <div className="crm-pipeline__loading"><Loader2 /> Loading pipeline…</div> : null}
            {!pipelineLoading && pipeline ? <div className="crm-pipeline__board">{pipelineStages.map((stage, index) => { const cards = pipeline.columns[stage.id] || []; const phaseStart = index === 0 || pipelineStages[index - 1].phase !== stage.phase; return <section className="crm-pipeline__stage" key={stage.id}>{phaseStart ? <p className="crm-pipeline__phase">{stage.phase}</p> : <p className="crm-pipeline__phase" aria-hidden="true">&nbsp;</p>}<header><div><h2>{stage.label}</h2><span>{cards.length} {cards.length === 1 ? 'person' : 'people'}</span></div><b>{cards.length}</b></header><div className="crm-pipeline__cards">{cards.length ? cards.map(card => <button key={card.id} onClick={() => goToCurrentStaff(`/client/${encodeURIComponent(card.id)}`)}><span className="crm-pipeline__avatar">{initials(card.name)}</span><span><strong>{card.name}</strong><small>{pipelineCardNote(card, stage.id)}</small>{card.dateAdded ? <time>Added {dayLabel(card.dateAdded)}</time> : null}</span><ChevronRight /></button>) : <div className="crm-pipeline__empty">No one in this stage</div>}</div></section>; })}</div> : null}
          </section>
        ) : surface === 'outreach' ? (
          <section className="crm-collection crm-outreach">
            <CollectionHead eyebrow="Practice development" title="Outreach" detail={outreachLoading ? 'Loading the acquisition worklist.' : outreachError ? 'The acquisition worklist is temporarily unavailable.' : `${outreachDue.length} proactive contacts are due. ${outreachWaiting} are cooling off.`} action="Open working outreach" onAction={() => goToCurrentStaff('/outreach')} />
            {outreachError ? <div className="crm-pilot__notice" role="alert">Outreach data is unavailable. {outreachError}</div> : null}
            <div className="crm-collection__body">
              <section className="crm-outreach__summary"><div><span>Reach out now</span><strong>{outreachLoading ? '…' : outreachDue.length}</strong><small>A focused day list, not the full backlog</small></div><div><span>Cooling off</span><strong>{outreachLoading ? '…' : outreachWaiting}</strong><small>Hidden until the next useful touch</small></div><div><span>Prospects tracked</span><strong>{outreachLoading ? '…' : outreach?.total ?? '—'}</strong><small>Searchable in the working view</small></div></section>
              <div className="crm-collection__section-head"><div><h2>Today’s worklist</h2><p>Incoming replies stay in Inbox. This list is only proactive acquisition work.</p></div><span>Ordered by urgency</span></div>
              {outreachLoading ? <div className="crm-collection__loading"><Loader2 /> Loading outreach…</div> : outreachDue.length ? <OutreachPreview people={outreachDue} /> : !outreachError ? <div className="crm-collection__empty"><Check /><strong>No proactive outreach is due</strong><span>New work will appear when a contact reaches the next useful step.</span></div> : null}
            </div>
          </section>
        ) : surface === 'products' ? (
          <section className="crm-collection crm-products">
            <CollectionHead eyebrow="Sales catalog" title="Products" detail={productsLoading ? 'Loading the Staff catalog.' : productsError ? 'The Staff catalog is temporarily unavailable.' : `${products?.products.length || 0} products, separated by who they are for and what happens after payment.`} action="Open working products" onAction={() => goToCurrentStaff('/products')} />
            {productsError ? <div className="crm-pilot__notice" role="alert">Product data is unavailable. {productsError}</div> : null}
            <div className="crm-collection__body">
              <div className="crm-collection__section-head"><div><h2>Staff catalog</h2><p>Price, purpose, fulfillment, and availability are visible without opening a product.</p></div><button onClick={() => goToCurrentStaff('/pos')}>Open POS <ChevronRight /></button></div>
              {productsLoading ? <div className="crm-collection__loading"><Loader2 /> Loading products…</div> : products ? <div className="crm-products__groups"><ProductPreviewGroup title="Current offers" detail="The products Staff should use for new sales" products={productGroups.current} tone="current" /><ProductPreviewGroup title="Custom products" detail="Owned one-off and reusable Staff items" products={productGroups.custom} tone="custom" /><ProductPreviewGroup title="Legacy offers" detail="Founding-member support, kept separate from current pricing" products={productGroups.legacy} tone="legacy" /></div> : null}
            </div>
          </section>
        ) : (
          <section className="crm-collection crm-money">
            <CollectionHead eyebrow="Practice ledger" title="Money & balances" detail={balancesLoading ? 'Loading the session ledger.' : balancesError ? 'The session ledger is temporarily unavailable.' : `${balances?.count || 0} prepaid practice members with ${balances?.totalRemaining || 0} sessions remaining.`} action="Open working balances" onAction={() => goToCurrentStaff('/balances')} />
            {balancesError ? <div className="crm-pilot__notice" role="alert">Balance data is unavailable. {balancesError}</div> : null}
            <div className="crm-collection__body">
              <section className="crm-money__summary"><div><CircleDollarSign /><span><small>Collected this month</small><strong>{revenue ? money.format(revenue.thisMonth.gross) : '—'}</strong><em>{revenue?.thisMonth.chargeCount || 0} successful charges</em></span></div><div><Archive /><span><small>Prepaid members</small><strong>{balancesLoading ? '…' : balances?.count ?? '—'}</strong><em>Tracked in the session ledger</em></span></div><div><Clock3 /><span><small>Sessions remaining</small><strong>{balancesLoading ? '…' : balances?.totalRemaining ?? '—'}</strong><em>Across active prepaid records</em></span></div></section>
              <div className="crm-collection__section-head"><div><h2>Session balances</h2><p>Purchased, completed, and remaining are shown as distinct columns.</p></div><span>{orderedBalances.length} records</span></div>
              {balancesLoading ? <div className="crm-collection__loading"><Loader2 /> Loading balances…</div> : orderedBalances.length ? <BalancePreview rows={orderedBalances} /> : !balancesError ? <div className="crm-collection__empty"><Check /><strong>No prepaid balances to show</strong><span>The ledger is current and contains no active records.</span></div> : null}
            </div>
          </section>
        )}

        <nav className="crm-pilot__bottom-nav" aria-label="Mobile navigation"><button className={surface === 'home' ? 'is-active' : ''} onClick={() => openSurface('home')}><Home /><span>Home</span></button><button className={surface === 'inbox' ? 'is-active' : ''} onClick={() => openSurface('inbox')}><MessageSquare /><span>Inbox{actionable.length ? ` · ${actionable.length}` : ''}</span></button><button className={surface === 'outreach' ? 'is-active' : ''} onClick={() => openSurface('outreach')}><Phone /><span>Outreach</span></button><button className={surface === 'pipeline' ? 'is-active' : ''} onClick={() => openSurface('pipeline')}><Workflow /><span>Pipeline</span></button><button className={surface === 'products' ? 'is-active' : ''} onClick={() => openSurface('products')}><Package /><span>Products</span></button><button className={surface === 'money' ? 'is-active' : ''} onClick={() => openSurface('money')}><WalletCards /><span>Money</span></button></nav>
      </section>
    </main>
  );
}
