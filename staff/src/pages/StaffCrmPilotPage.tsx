import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Ellipsis,
  Home,
  Loader2,
  MessageSquare,
  MoreHorizontal,
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
  getOpsSystemsBoard,
  getStaffRevenue,
  type CrmPilotContactResponse,
  type CrmPilotThread,
  type OpsSystemsBoard,
  type StaffRevenueData,
} from '../lib/api';
import { conversationWorkState, type ConversationWorkState } from '../lib/conversation-work-state';
import type { TodayAppointment } from '../types/staff';
import './StaffCrmPilotPage.css';

type PilotSurface = 'home' | 'inbox';
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

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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
    || conversations.find(item => item.contact_id === selectedId)
    || visibleConversations[0]
    || conversations[0]
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

  const openSurface = (next: PilotSurface) => {
    setSurface(next);
    if (next === 'home') setThreadOpen(false);
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
          <button onClick={() => goToCurrentStaff('/outreach')}><Send /><span>Outreach</span></button>
          <button onClick={() => goToCurrentStaff('/pipeline')}><Workflow /><span>Pipeline</span></button>
        </nav>
        <div className="crm-pilot__rail-foot">
          <p className="crm-pilot__rail-label">Business</p>
          <nav><button onClick={() => goToCurrentStaff('/products')}><SlidersHorizontal /><span>Products</span></button><button onClick={() => goToCurrentStaff('/balances')}><WalletCards /><span>Money</span></button></nav>
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
        ) : (
          <section className={`crm-inbox${threadOpen ? ' is-thread-open' : ''}`}>
            <section className="crm-inbox__list">
              <header><h1>Inbox</h1><p>Real mirrored conversations · read-only preview</p><label><Search /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
              <nav className="crm-inbox__tabs" aria-label="Inbox views">{(['needs_reply','waiting','done','all'] as InboxView[]).map(tab => <button key={tab} className={view === tab ? 'is-active' : ''} onClick={() => setView(tab)}>{tab === 'all' ? 'All' : stateLabel[tab]}{tab === 'needs_reply' ? ` · ${actionable.length}` : ''}</button>)}</nav>
              <div className="crm-inbox__rows">{inboxLoading ? <div className="crm-inbox__loading"><Loader2 /> Loading conversations…</div> : null}{inboxError ? <p className="crm-inbox__empty" role="alert">{inboxError}</p> : null}{!inboxLoading && !inboxError ? visibleConversations.map(item => <button key={item.contact_id} className={selected?.contact_id === item.contact_id ? 'is-active' : ''} onClick={() => openConversation(item.contact_id)}><span className="crm-avatar">{item.initials}</span><span><strong>{item.name}</strong><small>{item.preview}</small><em>{item.reason}</em></span><time>{item.age}</time></button>) : null}{!inboxLoading && !inboxError && visibleConversations.length === 0 ? <p className="crm-inbox__empty">Nothing is waiting in this view.</p> : null}</div>
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
        )}

        <nav className="crm-pilot__bottom-nav" aria-label="Mobile navigation"><button className={surface === 'home' ? 'is-active' : ''} onClick={() => openSurface('home')}><Home /><span>Home</span></button><button onClick={() => goToCurrentStaff('/calendar')}><CalendarDays /><span>Calendar</span></button><button className={surface === 'inbox' ? 'is-active' : ''} onClick={() => openSurface('inbox')}><MessageSquare /><span>Inbox{actionable.length ? ` · ${actionable.length}` : ''}</span></button><button onClick={() => goToCurrentStaff('/clients')}><Users /><span>People</span></button><button onClick={() => goToCurrentStaff('/')}><MoreHorizontal /><span>Current app</span></button></nav>
      </section>
    </main>
  );
}
