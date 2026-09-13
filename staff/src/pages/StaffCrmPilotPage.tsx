import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Ellipsis,
  Home,
  MessageSquare,
  MoreHorizontal,
  Search,
  Send,
  SlidersHorizontal,
  Users,
  WalletCards,
  Workflow,
} from 'lucide-react';
import './StaffCrmPilotPage.css';

type PilotSurface = 'home' | 'inbox';
type WorkState = 'needs_reply' | 'waiting' | 'done';
type InboxView = WorkState | 'all';

type PilotMessage = {
  id: string;
  author: 'client' | 'staff';
  body: string;
  time: string;
  day: string;
};

type PilotConversation = {
  id: string;
  initials: string;
  name: string;
  preview: string;
  age: string;
  state: WorkState;
  channel: 'SMS' | 'Email';
  reason?: string;
  profile: {
    memberSince: string;
    phone: string;
    email: string;
    nextAppointment: string;
    appointmentDetail: string;
    balance: string;
    lastVisit: string;
  };
  messages: PilotMessage[];
};

const initialConversations: PilotConversation[] = [
  {
    id: 'michaela',
    initials: 'MC',
    name: 'Michaela Cassidy',
    preview: 'Could we move Friday a little later?',
    age: '18m',
    state: 'needs_reply',
    channel: 'SMS',
    reason: 'Scheduling question',
    profile: { memberSince: 'June 2026', phone: '(415) 555-0138', email: 'michaela@example.com', nextAppointment: 'Friday · 2:00 PM', appointmentDetail: 'Follow-up · Session 3 of 6', balance: '4 sessions', lastVisit: 'September 5' },
    messages: [
      { id: 'm1', author: 'staff', body: 'You are all set for Friday at 2:00 PM. Let me know if anything changes.', time: '4:21 PM', day: 'Tuesday, September 12' },
      { id: 'm2', author: 'client', body: 'Thanks! I may need to move it a little later. Is 3:30 available?', time: '4:43 PM', day: 'Tuesday, September 12' },
      { id: 'm3', author: 'client', body: 'Could we move Friday a little later?', time: '8:42 AM', day: 'Today' },
    ],
  },
  {
    id: 'robin',
    initials: 'RS',
    name: 'Robin Schultz',
    preview: 'Is the assessment at the same address?',
    age: '1h',
    state: 'needs_reply',
    channel: 'SMS',
    reason: 'Client question',
    profile: { memberSince: 'August 2026', phone: '(415) 555-0184', email: 'robin@example.com', nextAppointment: 'Monday · 11:00 AM', appointmentDetail: 'Assessment · First visit', balance: 'Assessment paid', lastVisit: 'New client' },
    messages: [
      { id: 'r1', author: 'staff', body: 'Your assessment is booked for Monday at 11:00 AM.', time: '9:06 AM', day: 'Today' },
      { id: 'r2', author: 'client', body: 'Is the assessment at the same address?', time: '9:34 AM', day: 'Today' },
    ],
  },
  {
    id: 'jason',
    initials: 'JP',
    name: "Jason 'jp' Peterson",
    preview: 'Liked “You got it 👍”',
    age: '8h',
    state: 'done',
    channel: 'SMS',
    reason: 'Reaction closed automatically',
    profile: { memberSince: 'January 2026', phone: '(415) 555-0151', email: 'jason@example.com', nextAppointment: 'September 21 · 9:30 AM', appointmentDetail: 'Follow-up · Session 5 of 6', balance: '2 sessions', lastVisit: 'September 12' },
    messages: [
      { id: 'j1', author: 'staff', body: 'You got it 👍', time: '8:31 AM', day: 'Today' },
      { id: 'j2', author: 'client', body: 'Liked “You got it 👍”', time: '8:33 AM', day: 'Today' },
    ],
  },
  {
    id: 'zach',
    initials: 'ZT',
    name: 'Zach Taylor',
    preview: 'Loved “Great! And yes, I would absolutely come to you.”',
    age: '15h',
    state: 'done',
    channel: 'SMS',
    reason: 'Reaction closed automatically',
    profile: { memberSince: 'March 2026', phone: '(415) 555-0167', email: 'zach@example.com', nextAppointment: 'Today · 1:30 PM', appointmentDetail: 'Follow-up · Session 2 of 6', balance: '5 sessions', lastVisit: 'August 29' },
    messages: [
      { id: 'z1', author: 'staff', body: 'Great! And yes, I would absolutely come to you.', time: '5:17 PM', day: 'Tuesday, September 12' },
      { id: 'z2', author: 'client', body: 'Loved “Great! And yes, I would absolutely come to you.”', time: '5:19 PM', day: 'Tuesday, September 12' },
    ],
  },
  {
    id: 'julio',
    initials: 'JM',
    name: 'Julio Munoz',
    preview: "Sounds amazing. Much appreciated. I'm definitely doing the exercises.",
    age: '1d',
    state: 'done',
    channel: 'SMS',
    reason: 'Closing acknowledgement',
    profile: { memberSince: 'November 2025', phone: '(415) 555-0192', email: 'julio@example.com', nextAppointment: 'September 25 · 4:00 PM', appointmentDetail: 'Follow-up · Session 4 of 6', balance: '3 sessions', lastVisit: 'September 11' },
    messages: [
      { id: 'u1', author: 'staff', body: 'I sent the practice notes from today. Let me know if anything feels unclear.', time: '2:18 PM', day: 'Monday, September 11' },
      { id: 'u2', author: 'client', body: "Sounds amazing. Much appreciated. I'm definitely doing the exercises.", time: '2:25 PM', day: 'Monday, September 11' },
    ],
  },
];

const appointments = [
  { time: '10:00 AM', name: 'Surrina Haas', detail: 'Follow-up · Session 4 of 6' },
  { time: '1:30 PM', name: 'Zach Taylor', detail: 'Follow-up · Session 2 of 6' },
  { time: '4:00 PM', name: 'Priya Desai', detail: 'Assessment · First visit' },
];

const stateLabel: Record<WorkState, string> = {
  needs_reply: 'Needs reply',
  waiting: 'Waiting',
  done: 'Done',
};

function PilotMark() {
  return <span className="crm-pilot__mark" aria-hidden="true">A</span>;
}

export default function StaffCrmPilotPage() {
  const [surface, setSurface] = useState<PilotSurface>('home');
  const [view, setView] = useState<InboxView>('needs_reply');
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState('michaela');
  const [threadOpen, setThreadOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  const actionable = useMemo(() => conversations.filter(item => item.state === 'needs_reply'), [conversations]);
  const visibleConversations = useMemo(
    () => {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      return conversations.filter(item => {
        const isInView = view === 'all' || item.state === view;
        const matchesSearch = !normalizedQuery || `${item.name} ${item.preview} ${item.channel}`.toLocaleLowerCase().includes(normalizedQuery);
        return isInView && matchesSearch;
      });
    },
    [conversations, query, view],
  );
  const selected = visibleConversations.find(item => item.id === selectedId) ?? visibleConversations[0] ?? conversations.find(item => item.id === selectedId) ?? conversations[0];

  useEffect(() => {
    if (visibleConversations.length > 0 && !visibleConversations.some(item => item.id === selectedId)) {
      setSelectedId(visibleConversations[0].id);
    }
  }, [selectedId, visibleConversations]);

  const openSurface = (next: PilotSurface) => {
    setSurface(next);
    if (next === 'home') setThreadOpen(false);
  };

  const openConversation = (id: string) => {
    setSelectedId(id);
    setThreadOpen(true);
  };

  const markDone = () => {
    setConversations(items => items.map(item => item.id === selected.id ? { ...item, state: 'done' } : item));
    const next = conversations.find(item => item.id !== selected.id && item.state === 'needs_reply');
    if (next) setSelectedId(next.id);
    else setThreadOpen(false);
  };

  const sendReply = () => {
    const body = draft.trim();
    if (!body) return;
    setConversations(items => items.map(item => item.id === selected.id
      ? {
          ...item,
          preview: body,
          age: 'Now',
          state: 'waiting',
          messages: [...item.messages, { id: `draft-${Date.now()}`, author: 'staff', body, time: 'Now', day: 'Today' }],
        }
      : item));
    setDraft('');
    setView('waiting');
  };

  return (
    <main className="crm-pilot">
      <aside className="crm-pilot__rail">
        <div className="crm-pilot__brand"><PilotMark /><span><strong>Amari Method</strong><small>Staff workspace</small></span></div>
        <p className="crm-pilot__rail-label">Practice</p>
        <nav aria-label="Practice navigation">
          <button className={surface === 'home' ? 'is-active' : ''} onClick={() => openSurface('home')}><Home /><span>Home</span></button>
          <button><CalendarDays /><span>Calendar</span></button>
          <button className={surface === 'inbox' ? 'is-active' : ''} onClick={() => openSurface('inbox')}><MessageSquare /><span>Inbox</span>{actionable.length > 0 ? <b>{actionable.length}</b> : null}</button>
          <button><Users /><span>People</span></button>
          <button><Send /><span>Outreach</span></button>
          <button><Workflow /><span>Pipeline</span></button>
        </nav>
        <div className="crm-pilot__rail-foot">
          <p className="crm-pilot__rail-label">Business</p>
          <nav><button><SlidersHorizontal /><span>Products</span></button><button><WalletCards /><span>Money</span></button></nav>
          <div className="crm-pilot__actor"><span>GH</span><div><strong>Garrett Hewstan</strong><small>Practitioner</small></div></div>
        </div>
      </aside>

      <section className="crm-pilot__workspace">
        <header className="crm-pilot__mobile-head"><div><PilotMark /><strong>Staff</strong></div><button aria-label="Search"><Search /></button></header>

        {surface === 'home' ? (
          <section className="crm-home">
            <header className="crm-home__opening"><div><p>Wednesday, September 13</p><h1>Good morning, Garrett.</h1></div><span>Three sessions today. {actionable.length === 1 ? 'One conversation needs' : `${actionable.length} conversations need`} a reply, and one system issue needs review.</span></header>
            <div className="crm-home__primary-grid">
              <section><header className="crm-section-head"><h2>Today</h2><span>Pacific time</span></header><div className="crm-schedule"><header><strong>Session schedule</strong><span>On time</span></header>{appointments.map(item => <button key={item.time}><time>{item.time}</time><i /><span><strong>{item.name}</strong><small>{item.detail}</small></span><em>Open session</em></button>)}</div><footer className="crm-schedule-foot"><span>Next session in 48 minutes</span><button>Open calendar</button></footer></section>
              <section><header className="crm-section-head"><h2>Attention</h2><span>{actionable.length + 1} items</span></header><div className="crm-attention"><header><strong>Work requiring a person</strong><span>{actionable.length} {actionable.length === 1 ? 'reply' : 'replies'} · 1 system</span></header>{actionable.slice(0, 2).map(item => <button key={item.id} onClick={() => { openSurface('inbox'); openConversation(item.id); }}><span className="crm-attention__icon"><MessageSquare /></span><span><strong>{item.name}</strong><small>{item.preview}</small></span><time>{item.age}</time></button>)}<button><span className="crm-attention__icon crm-attention__icon--system"><Workflow /></span><span><strong>Ledger drift scan</strong><small>Two records need reconciliation</small></span><time>Review</time></button></div><div className="crm-settled"><Check /><span><strong>Three conversations settled automatically</strong><small>Reactions and closing acknowledgements remain in history without entering this queue.</small></span></div></section>
            </div>
            <div className="crm-home__secondary-grid"><section><header className="crm-section-head"><h2>Practice</h2><span>September</span></header><div className="crm-metrics"><div><span>Sessions</span><strong>34</strong><small>8 this week</small></div><div><span>Collected</span><strong>$8,420</strong><small>22 charges</small></div><div><span>Needs review</span><strong>2</strong><small>Session balances</small></div></div></section><section><header className="crm-section-head"><h2>Quick access</h2></header><div className="crm-quick"><button onClick={() => openSurface('inbox')}><span>Start a new message</span><ChevronRight /></button><button><span>Review session balances</span><ChevronRight /></button><button><span>Find a practice member</span><ChevronRight /></button></div></section></div>
          </section>
        ) : (
          <section className={`crm-inbox${threadOpen ? ' is-thread-open' : ''}`}>
            <section className="crm-inbox__list">
              <header><h1>Inbox</h1><p>Conversations requiring a response or decision</p><label><Search /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
              <nav className="crm-inbox__tabs" aria-label="Inbox views">{(['needs_reply','waiting','done','all'] as InboxView[]).map(tab => <button key={tab} className={view === tab ? 'is-active' : ''} onClick={() => setView(tab)}>{tab === 'all' ? 'All' : stateLabel[tab]}{tab === 'needs_reply' ? ` · ${actionable.length}` : ''}</button>)}</nav>
              <div className="crm-inbox__rows">{visibleConversations.map(item => <button key={item.id} className={selected.id === item.id ? 'is-active' : ''} onClick={() => openConversation(item.id)}><span className="crm-avatar">{item.initials}</span><span><strong>{item.name}</strong><small>{item.preview}</small><em>{item.reason ?? stateLabel[item.state]}</em></span><time>{item.age}</time></button>)}{visibleConversations.length === 0 ? <p className="crm-inbox__empty">Nothing is waiting in this view.</p> : null}</div>
              <footer>Reactions and clear closing acknowledgements move to Done automatically. Every message remains available in All conversations.</footer>
            </section>

            <section className="crm-thread">
              <header><div className="crm-thread__person"><button className="crm-thread__back" aria-label="Back to inbox" onClick={() => setThreadOpen(false)}><ArrowLeft /></button><span className="crm-avatar">{selected.initials}</span><div><h2>{selected.name}</h2><p>Practice member · {selected.channel}</p></div></div><div className="crm-thread__actions"><button>Snooze</button>{selected.state !== 'done' ? <button className="is-primary" onClick={markDone}>Mark done</button> : <button className="is-primary" onClick={() => setConversations(items => items.map(item => item.id === selected.id ? { ...item, state: 'needs_reply' } : item))}>Reopen</button>}<button aria-label="More actions"><Ellipsis /></button></div></header>
              <div className="crm-thread__stream">{selected.messages.map((message, index) => <div key={message.id}>{index === 0 || selected.messages[index - 1].day !== message.day ? <div className="crm-thread__date"><span>{message.day}</span></div> : null}<div className={`crm-bubble-row ${message.author === 'staff' ? 'is-outbound' : ''}`}><div className="crm-bubble">{message.body}<small>{message.author === 'staff' ? 'Garrett' : selected.name.split(' ')[0]} · {message.time}</small></div></div></div>)}<div className={`crm-thread__state crm-thread__state--${selected.state}`}>{selected.state === 'needs_reply' ? `Waiting for Staff · ${selected.age}` : selected.state === 'waiting' ? 'Waiting for client' : 'Conversation complete'}</div></div>
              <footer className="crm-composer"><div><textarea aria-label="Message" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a reply…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendReply(); } }} /><button aria-label="Send reply" onClick={sendReply}><Send /></button></div><p><span>{selected.channel} from Amari Method</span><span>Enter to send · Shift Enter for a new line</span></p></footer>
            </section>

            <aside className="crm-person"><header><span className="crm-avatar">{selected.initials}</span><h2>{selected.name}</h2><p>Practice member since {selected.profile.memberSince}</p></header><section><h3>Contact</h3><dl><div><dt>Phone</dt><dd>{selected.profile.phone}</dd></div><div><dt>Email</dt><dd>{selected.profile.email}</dd></div><div><dt>Status</dt><dd>Active practice</dd></div></dl></section><section><h3>Next appointment</h3><div className="crm-person__appointment"><strong>{selected.profile.nextAppointment}</strong><span>{selected.profile.appointmentDetail}</span></div><button>Manage appointment</button></section><section><h3>Current context</h3><dl><div><dt>Owner</dt><dd>Garrett</dd></div><div><dt>Balance</dt><dd>{selected.profile.balance}</dd></div><div><dt>Last visit</dt><dd>{selected.profile.lastVisit}</dd></div></dl><button>Open full record</button></section></aside>
          </section>
        )}

        <nav className="crm-pilot__bottom-nav" aria-label="Mobile navigation"><button className={surface === 'home' ? 'is-active' : ''} onClick={() => openSurface('home')}><Home /><span>Home</span></button><button><CalendarDays /><span>Calendar</span></button><button className={surface === 'inbox' ? 'is-active' : ''} onClick={() => openSurface('inbox')}><MessageSquare /><span>Inbox{actionable.length ? ` · ${actionable.length}` : ''}</span></button><button><Users /><span>People</span></button><button><MoreHorizontal /><span>More</span></button></nav>
      </section>
    </main>
  );
}
