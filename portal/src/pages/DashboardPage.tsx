import { useState } from 'react';
import { Link } from 'react-router-dom';
import BookingModal from '../components/BookingModal';
import CancelModal from '../components/CancelModal';
import { useClientData } from '../hooks/useClientData';
import { useAuth } from '../contexts/AuthContext';
import type { ClientData, Appointment } from '../types/portal';

/* ============================================================
   Client Portal — editorial dashboard
   Styles live in src/styles/portal.css (cp-* prefix).
   All UI is composed from small inline sub-components below.
   ============================================================ */

// 8-step rail — numbered dots only, no fabricated names.
const JOURNEY_STEP_COUNT = 8;

// Pricing source of truth — keep in sync with /Users/Eben/Desktop/Claude/CLAUDE.md
const PRICING = {
  initial: 225,
  followup: 190,
  series4: 720,
  series8: 1295,
  livingPractice: 347,
};

/* ---------- helpers ---------- */
function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function formatMonthDay(iso: string): { m: string; d: string; w: string } {
  const dt = new Date(iso);
  const m = dt.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const d = pad2(dt.getDate());
  const w = dt.toLocaleString('en-US', { weekday: 'short' });
  return { m, d, w };
}

function formatLongDate(iso: string): string {
  const dt = new Date(iso);
  return dt.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const target = new Date(iso).getTime();
  const diffMs = target - now;
  const diffHrs = diffMs / (1000 * 60 * 60);
  const diffDays = diffHrs / 24;
  if (diffMs < 0) return 'In the past';
  if (diffHrs < 1) return 'Within the hour';
  if (diffHrs < 24) return diffHrs < 1.5 ? 'In an hour' : `In ${Math.round(diffHrs)} hours`;
  if (diffDays < 1.5) return 'Tomorrow';
  if (diffDays < 7) return `In ${Math.round(diffDays)} days`;
  if (diffDays < 14) return 'Next week';
  return `In ${Math.round(diffDays / 7)} weeks`;
}

function isWithin24Hours(iso: string): boolean {
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 && diff < 1000 * 60 * 60 * 24;
}

function detectFormat(apt: Appointment): 'Virtual' | 'In-person' {
  const t = (apt.appointmentType || apt.title || '').toLowerCase();
  if (t.includes('virtual') || t.includes('zoom') || t.includes('online')) return 'Virtual';
  return 'In-person';
}

function deriveJourneyStep(client: ClientData, upcoming: Appointment[]): number {
  // Step is 1-indexed: how far along the 8-step rail you are.
  // 0 = haven't started. 1-8 = currently on that step. 9+ = method completed.
  if (client.sessionsCompleted === 0 && upcoming.length === 0) return 0;
  // If there are upcoming sessions, the next is the "current" step.
  const onStep = client.sessionsCompleted + (upcoming.length > 0 ? 1 : 0);
  return Math.min(onStep, JOURNEY_STEP_COUNT + 1);
}

function deriveSeriesUsedTotal(client: ClientData): { used: number; total: number } | null {
  if (client.seriesType === 'none' || client.seriesType === 'Single') return null;
  const total = client.seriesType === '4-session' ? 4 : 8;
  const used = Math.max(0, total - client.sessionsRemaining);
  return { used, total };
}

function deriveSeriesSavings(seriesType: ClientData['seriesType']): number {
  // A series buys you 1 initial + (n-1) follow-ups vs. the package price.
  // Numbers derive from PRICING so a price change updates here automatically.
  if (seriesType === '4-session') {
    const oneOff = PRICING.initial + 3 * PRICING.followup;
    return oneOff - PRICING.series4;
  }
  if (seriesType === '8-session') {
    const oneOff = PRICING.initial + 7 * PRICING.followup;
    return oneOff - PRICING.series8;
  }
  return 0;
}

/* ---------- sub-components ---------- */

function TopBar({ firstName, hasLivingPractice }: { firstName: string; hasLivingPractice: boolean }) {
  const { logout } = useAuth();
  return (
    <header className="cp-topbar">
      <Link to="/" className="cp-seal">
        <span className="cp-mark"></span>
        <span>Amari Method</span>
      </Link>
      <nav className="cp-topnav">
        <Link to="/" className="cp-topnav-link cp-current">Dashboard</Link>
        {hasLivingPractice && (
          <Link to="/practice" className="cp-topnav-link">Living Practice</Link>
        )}
      </nav>
      <div className="cp-account">
        <span className="cp-account-name">{firstName}</span>
        <button type="button" className="cp-account-out" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}

function Greeting({ user, sub, lastVisit }: { user: string; sub: string; lastVisit?: string }) {
  return (
    <section className="cp-greet">
      <div className="cp-greet-l">
        <h1 className="cp-hello">Hey, <em>{user}.</em></h1>
        <p className="cp-greet-sub">{sub}</p>
      </div>
      {lastVisit && (
        <div className="cp-greet-r">
          <span className="cp-mono">Last visit</span>
          <span className="cp-greet-when">{lastVisit}</span>
        </div>
      )}
    </section>
  );
}

function Journey({ step }: { step: number }) {
  const pct = Math.min(100, Math.round((step / JOURNEY_STEP_COUNT) * 100));
  const headline = step === 0
    ? <>The eight-step <em>method.</em></>
    : step > JOURNEY_STEP_COUNT
      ? <>You've completed <em>the method.</em></>
      : <>Step <em>{step}</em> of {JOURNEY_STEP_COUNT}</>;

  return (
    <section className="cp-journey">
      <div className="cp-journey-head">
        <div>
          <span className="cp-mono">Your journey</span>
          <h2 className="cp-journey-title">{headline}</h2>
        </div>
        <div className="cp-journey-pct">
          <span className="cp-journey-pct-n">{pct}<small>%</small></span>
          <span className="cp-mono">Complete</span>
        </div>
      </div>

      <ol className="cp-rail cp-rail-numbers-only">
        {Array.from({ length: JOURNEY_STEP_COUNT }).map((_, i) => {
          const idx = i + 1;
          const done = idx < step;
          const current = idx === step;
          return (
            <li key={idx} className={'cp-rail-step' + (done ? ' is-done' : '') + (current ? ' is-current' : '')}>
              <span className="cp-rail-mark">
                <span className="cp-rail-dot"></span>
                {i < JOURNEY_STEP_COUNT - 1 && <span className="cp-rail-line"></span>}
              </span>
              <span className="cp-rail-label">
                <span className="cp-rail-n">{pad2(idx)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SessionDate({ m, d, w }: { m: string; d: string; w?: string }) {
  return (
    <div className="cp-date">
      <span className="cp-date-m">{m}</span>
      <span className="cp-date-d">{d}</span>
      {w && <span className="cp-date-w">{w}</span>}
    </div>
  );
}

function isInitialSession(apt: Appointment): boolean {
  const t = (apt.appointmentType || apt.title || '').toLowerCase();
  return t.includes('initial') || t.includes('intro') || t.includes('discovery');
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function toIcsDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

function buildIcsUrl(apt: Appointment): string {
  const format = detectFormat(apt);
  const meet = apt.meetingUrl || '';
  const description = format === 'Virtual'
    ? (meet
        ? `Virtual session with Dr. Garrett. Join here: ${meet}`
        : 'Virtual session with Dr. Garrett. The Google Meet link is in your confirmation email from Amari Method.')
    : 'In-person session with Dr. Garrett at Amari Method.';
  const locationLine = meet
    ? `LOCATION:${meet}`
    : (format === 'In-person' ? 'LOCATION:Amari Method' : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Amari Method//Portal//EN',
    'BEGIN:VEVENT',
    `UID:${apt.id}@amarimethod.com`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(apt.startTime)}`,
    `DTEND:${toIcsDate(apt.endTime)}`,
    `SUMMARY:${apt.title || 'Amari Method session'}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    ...(locationLine ? [locationLine] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
}

function NextSession({ apt, onReschedule, onCancel }: { apt: Appointment; onReschedule: () => void; onCancel: () => void }) {
  const { m, d, w } = formatMonthDay(apt.startTime);
  const time = new Date(apt.startTime).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  const format = detectFormat(apt);
  const locked = isWithin24Hours(apt.startTime);
  const initialOnly = isInitialSession(apt);

  return (
    <section className="cp-next">
      <div className="cp-next-head">
        <span className="cp-mono cp-accent">Up next</span>
        <span className="cp-next-when">{formatRelative(apt.startTime)}</span>
      </div>
      <div className="cp-next-body">
        <SessionDate m={m} d={d} w={w} />
        <div className="cp-next-info">
          <h3 className="cp-next-title">{apt.title || 'Session'}</h3>
          <p className="cp-next-meta">
            <span>{time}</span>
            <span className="cp-dot">·</span>
            <span>{format}</span>
            <span className="cp-dot">·</span>
            <span>with <b>Dr. Garrett</b></span>
          </p>
          {format === 'Virtual' && !apt.meetingUrl && (
            <p className="cp-next-note">Google Meet link is in your confirmation email.</p>
          )}
        </div>
        <div className="cp-next-actions">
          {format === 'Virtual' && apt.meetingUrl ? (
            <a
              href={apt.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="cp-btn cp-btn-primary"
            >
              <span>Join Google Meet</span><span className="cp-arrow">→</span>
            </a>
          ) : (
            <a
              href={buildIcsUrl(apt)}
              download={`amari-session-${apt.id}.ics`}
              className="cp-btn cp-btn-primary"
            >
              <span>Add to calendar</span><span className="cp-arrow">→</span>
            </a>
          )}
          {format === 'Virtual' && apt.meetingUrl && (
            <a
              href={buildIcsUrl(apt)}
              download={`amari-session-${apt.id}.ics`}
              className="cp-btn cp-btn-ghost"
            >
              Add to calendar
            </a>
          )}
          {initialOnly ? (
            <a href="mailto:hello@amarimethod.com?subject=Reschedule%20my%20initial%20session" className="cp-btn cp-btn-ghost">
              Email to change
            </a>
          ) : (
            <>
              <button type="button" className="cp-btn cp-btn-ghost" onClick={onReschedule} disabled={locked}>
                Reschedule
              </button>
              <button type="button" className="cp-btn cp-btn-text" onClick={onCancel} disabled={locked}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {locked && !initialOnly && (
        <p className="cp-locked">
          <span className="cp-lock-dot"></span>
          Within 24 hours — changes locked. <a href="mailto:hello@amarimethod.com">Need help?</a>
        </p>
      )}
      {initialOnly && (
        <p className="cp-locked" style={{ background: 'var(--cp-paper-2)', borderLeftColor: 'var(--cp-accent)' }}>
          <span className="cp-lock-dot" style={{ background: 'var(--cp-accent)' }}></span>
          Initial sessions are scheduled with Dr. Garrett directly.
        </p>
      )}
    </section>
  );
}

function ComingUp({ sessions, onReschedule, onCancel }: { sessions: Appointment[]; onReschedule: (a: Appointment) => void; onCancel: (a: Appointment) => void }) {
  if (sessions.length === 0) return null;
  return (
    <section className="cp-coming">
      <div className="cp-section-head">
        <h3 className="cp-section-h">Coming up</h3>
        <span className="cp-mono">{sessions.length} scheduled</span>
      </div>
      <ul className="cp-coming-rows">
        {sessions.map(s => {
          const { m, d, w } = formatMonthDay(s.startTime);
          const time = new Date(s.startTime).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
          const format = detectFormat(s);
          const locked = isWithin24Hours(s.startTime);
          const initialOnly = isInitialSession(s);
          return (
            <li key={s.id} className="cp-coming-row">
              <SessionDate m={m} d={d} />
              <div className="cp-coming-body">
                <span className="cp-coming-title">{s.title || 'Session'}</span>
                <span className="cp-coming-meta">{w} · {time} · {format}</span>
              </div>
              <div className="cp-coming-actions">
                {initialOnly ? (
                  <a href="mailto:hello@amarimethod.com?subject=Reschedule%20my%20initial%20session" className="cp-btn cp-btn-row cp-btn-text">Email to change</a>
                ) : (
                  <>
                    <button type="button" className="cp-btn cp-btn-row" onClick={() => onReschedule(s)} disabled={locked}>Reschedule</button>
                    <button type="button" className="cp-btn cp-btn-row cp-btn-text" onClick={() => onCancel(s)} disabled={locked}>Cancel</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SeriesPanel({ client }: { client: ClientData }) {
  const ut = deriveSeriesUsedTotal(client);
  if (!ut) return null;
  const saved = deriveSeriesSavings(client.seriesType);
  return (
    <section className="cp-series">
      <div className="cp-section-head">
        <h3 className="cp-section-h">Your series</h3>
        <span className="cp-mono">{client.seriesType}</span>
      </div>
      <div className="cp-series-body">
        <div className="cp-series-stat">
          <span className="cp-series-n"><em>{ut.used}</em>/{ut.total}</span>
          <span className="cp-mono">Sessions used</span>
        </div>
        <div className="cp-series-bar">
          {Array.from({ length: ut.total }).map((_, i) => (
            <span key={i} className={'cp-series-pip' + (i < ut.used ? ' is-used' : '')}></span>
          ))}
        </div>
        <div className="cp-series-meta">
          <div><span className="cp-mono">Remaining</span><b>{ut.total - ut.used} sessions</b></div>
          {saved > 0 && (
            <div><span className="cp-mono">Saved</span><b><em>${saved}</em> vs. one-off</b></div>
          )}
        </div>
      </div>
    </section>
  );
}

interface ActionItem {
  h: string;
  p: string;
  price?: string;
  href?: string;
  onClick?: () => void;
  muted?: boolean;
  primary?: boolean;
}

function BookManage({ actions }: { actions: ActionItem[] }) {
  return (
    <section className="cp-actions">
      <div className="cp-section-head">
        <h3 className="cp-section-h">Book &amp; manage</h3>
      </div>
      <div className="cp-actions-grid">
        {actions.map((a, i) => {
          const className = 'cp-action'
            + (a.primary ? ' cp-action-primary' : '')
            + (a.muted ? ' is-muted' : '');
          const inner = (
            <>
              <span className="cp-action-l">
                <span className="cp-action-h">{a.h}</span>
                <span className="cp-action-p">{a.p}</span>
              </span>
              <span className="cp-action-r">
                {a.price && <span className="cp-action-price">{a.price}</span>}
                <span className="cp-arrow">→</span>
              </span>
            </>
          );
          if (a.href) {
            return <a key={i} href={a.href} className={className}>{inner}</a>;
          }
          return (
            <button key={i} type="button" className={className} onClick={a.onClick}>
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function History({ items }: { items: Appointment[] }) {
  // Filter out no-shows from client view per design feedback
  const visible = items.filter(a => a.status !== 'no_show');
  if (visible.length === 0) {
    return (
      <section className="cp-history">
        <div className="cp-section-head">
          <h3 className="cp-section-h">Session history</h3>
          <span className="cp-mono">None yet</span>
        </div>
        <div className="cp-empty" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--cp-mute)', fontSize: 13 }}>
          Your sessions will appear here.
        </div>
      </section>
    );
  }
  return (
    <section className="cp-history">
      <div className="cp-section-head">
        <h3 className="cp-section-h">Session history</h3>
        <span className="cp-mono">{visible.length} session{visible.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="cp-hist-rows">
        {visible.map(a => {
          const { m, d } = formatMonthDay(a.startTime);
          const format = detectFormat(a);
          // Past appointments that weren't no-show or cancelled are effectively
          // completed — Garrett doesn't always mark "complete" manually after
          // each session, so 'confirmed' in the past = it ran.
          const isCancelled = a.status === 'cancelled';
          const statusClass = isCancelled ? 'cp-cancelled' : 'cp-completed';
          const statusLabel = isCancelled ? 'Cancelled' : 'Completed';
          return (
            <li key={a.id} className={'cp-hist-row pa-' + a.status}>
              <SessionDate m={m} d={d} />
              <div className="cp-hist-body">
                <span className="cp-hist-title">{a.title || 'Session'}</span>
                <span className="cp-hist-meta">{formatLongDate(a.startTime)} · {format} · with Dr. Garrett</span>
              </div>
              <div className="cp-hist-right">
                <span className={'cp-status ' + statusClass}>{statusLabel}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Footer() {
  return (
    <footer className="cp-foot">
      <span>amarimethod.com</span>
      <span className="cp-dot">·</span>
      <a href="mailto:hello@amarimethod.com">Help &amp; policies</a>
      <span className="cp-dot">·</span>
      <a href="mailto:hello@amarimethod.com">Contact Dr. Garrett</a>
      <span className="cp-foot-r">© {new Date().getFullYear()} Amari Method</span>
    </footer>
  );
}

/* ---------- Skeleton ---------- */
function Sk({ w, h, mt = 0 }: { w: number | string; h: number | string; mt?: number }) {
  return <div className="cp-sk cp-sk-r" style={{ width: w, height: h, marginTop: mt }} />;
}

function Skeleton({ firstName }: { firstName: string }) {
  return (
    <div className="cp-screen cp-screen-skel">
      <TopBar firstName={firstName} hasLivingPractice={false} />
      <section className="cp-greet">
        <div className="cp-greet-l">
          <Sk w="62%" h={60} />
          <Sk w="46%" h={22} mt={12} />
        </div>
      </section>
      <section className="cp-journey">
        <div className="cp-journey-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Sk w={100} h={12} />
            <Sk w={360} h={32} />
          </div>
          <div className="cp-journey-pct" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <Sk w={120} h={48} />
            <Sk w={70} h={12} />
          </div>
        </div>
        <div className="cp-sk-rail">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="cp-sk-step">
              <Sk w={14} h={14} />
              <Sk w="60%" h={11} mt={8} />
            </div>
          ))}
        </div>
      </section>
      <section className="cp-next">
        <div className="cp-next-body">
          <Sk w={90} h={86} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
            <Sk w="60%" h={34} />
            <Sk w="50%" h={16} />
            <Sk w="70%" h={48} mt={8} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
            <Sk w="100%" h={44} />
            <Sk w="100%" h={44} />
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

/* ---------- Error state ---------- */
function ErrorState({ firstName, message, onRetry }: { firstName: string; message: string; onRetry: () => void }) {
  return (
    <div className="cp-screen">
      <TopBar firstName={firstName} hasLivingPractice={false} />
      <Greeting user={firstName} sub="Welcome back." />
      <section className="cp-error">
        <span className="cp-mono cp-accent">Connection lost</span>
        <h2 className="cp-error-h">We <em>can't reach</em> your portal right now.</h2>
        <p className="cp-error-p">{message || "Try again in a moment, or contact Dr. Garrett if it persists — your sessions and progress are safe on our end."}</p>
        <div className="cp-error-actions">
          <button type="button" className="cp-btn cp-btn-primary" onClick={onRetry}>
            <span>Try again</span><span className="cp-arrow">→</span>
          </button>
          <a href="mailto:hello@amarimethod.com" className="cp-btn cp-btn-ghost">Contact Dr. Garrett</a>
        </div>
      </section>
      <Footer />
    </div>
  );
}

/* ---------- Completed state ---------- */
function DashCompleted({ client, history }: { client: ClientData; history: Appointment[] }) {
  return (
    <div className="cp-screen">
      <TopBar firstName={client.firstName} hasLivingPractice={client.hasLivingPractice} />
      <Greeting user={client.firstName} sub="You've moved through all eight steps. The protocols are yours now." />
      <Journey step={JOURNEY_STEP_COUNT + 1} />
      <section className="cp-celebrate">
        <span className="cp-celebrate-glyph">✦</span>
        <div className="cp-celebrate-body">
          <span className="cp-mono cp-accent">Method completed</span>
          <h2 className="cp-celebrate-h">Living Practice <em>is yours now.</em></h2>
          <p className="cp-celebrate-p">The eight-week journey is complete. The protocols are yours to use whenever the body asks. Dr. Garrett opens a check-in slot every quarter — book one when you need it.</p>
          <div className="cp-celebrate-actions">
            {client.hasLivingPractice && (
              <Link to="/practice" className="cp-btn cp-btn-primary">
                <span>Begin Living Practice</span><span className="cp-arrow">→</span>
              </Link>
            )}
            <a href="mailto:hello@amarimethod.com" className="cp-btn cp-btn-ghost">Book a quarterly check-in</a>
          </div>
        </div>
      </section>
      <History items={history} />
      <Footer />
    </div>
  );
}

/* ============================================================
   Main page
   ============================================================ */
export default function DashboardPage() {
  const { email } = useAuth();
  const { data, isLoading, error, refetch } = useClientData();
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);

  const firstName = data?.client?.firstName || data?.client?.lastName || email?.split('@')[0] || 'there';

  if (isLoading) return <Skeleton firstName={firstName} />;
  if (error) return <ErrorState firstName={firstName} message={error} onRetry={refetch} />;
  if (!data) return null;

  const { client, appointments, upcomingAppointments } = data;
  const step = deriveJourneyStep(client, upcomingAppointments);
  const completed = step > JOURNEY_STEP_COUNT;
  const hasHadInitial = client.sessionsCompleted > 0;
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;

  if (completed) {
    return <DashCompleted client={client} history={appointments} />;
  }

  const nextApt = upcomingAppointments[0];
  const otherUpcoming = upcomingAppointments.slice(1);

  // Greeting subtitle based on state
  const sub = !hasHadInitial
    ? "Welcome — let's get your first session on the calendar."
    : hasActiveSeries
      ? `${client.sessionsRemaining} session${client.sessionsRemaining !== 1 ? 's' : ''} left in your series.`
      : nextApt
        ? 'Welcome back.'
        : 'Book your next session whenever you\'re ready.';

  // Last visit
  const pastAppointments = appointments.filter(a => a.status === 'completed' || a.status === 'showed');
  const lastVisit = pastAppointments.length > 0
    ? new Date(pastAppointments[0].startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : undefined;

  // Book & manage actions — grouped: primary first, then series upgrades, then other
  const actions: ActionItem[] = [];
  if (!hasHadInitial) {
    actions.push({
      h: 'Book your initial session',
      p: '60 minutes with Dr. Garrett — assessment, first protocol, take-home practice.',
      price: `$${PRICING.initial}`,
      onClick: () => setShowBookingModal(true),
      primary: true,
    });
  } else {
    actions.push({
      h: hasActiveSeries ? 'Book your next session' : 'Book another session',
      p: hasActiveSeries
        ? `${client.sessionsRemaining} session${client.sessionsRemaining !== 1 ? 's' : ''} left in your series.`
        : 'Pick a date that fits your week.',
      price: hasActiveSeries ? 'Included' : `$${PRICING.followup}`,
      onClick: () => setShowBookingModal(true),
      primary: true,
    });
  }

  if (client.seriesType === 'none' && hasHadInitial) {
    actions.push({
      h: '4-session series',
      p: 'Four sessions at a package rate — pace one a week.',
      price: `$${PRICING.series4.toLocaleString()}`,
      href: 'https://www.amarimethod.com/4-session-series',
    });
    actions.push({
      h: '8-session series',
      p: 'Full eight-week journey, plus Living Practice access.',
      price: `$${PRICING.series8.toLocaleString()}`,
      href: 'https://www.amarimethod.com/8-session-series',
    });
  }

  if (client.hasLivingPractice) {
    actions.push({
      h: 'Continue Living Practice',
      p: 'Daily home practice videos with Dr. Garrett.',
      href: '/portal/practice',
    });
  } else {
    actions.push({
      h: 'Living Practice',
      p: 'Standalone video program for daily home practice.',
      price: `$${PRICING.livingPractice}`,
      href: 'https://www.amarimethod.com/living-practice',
    });
  }

  actions.push({
    h: 'Contact Dr. Garrett',
    p: 'Questions, scheduling, or notes between sessions.',
    muted: true,
    href: 'mailto:hello@amarimethod.com',
  });

  return (
    <div className="cp-screen">
      <TopBar firstName={firstName} hasLivingPractice={client.hasLivingPractice} />
      {showBookingModal && (
        <BookingModal
          rescheduleFor={rescheduleTarget}
          onClose={() => {
            const wasReschedule = !!rescheduleTarget;
            setShowBookingModal(false);
            setRescheduleTarget(null);
            // Refetch after a reschedule flow closes (booked new + cancelled old).
            if (wasReschedule) refetch();
          }}
        />
      )}
      {cancelTarget && (
        <CancelModal
          appointment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSuccess={() => {
            setCancelTarget(null);
            refetch();
          }}
        />
      )}
      <Greeting user={firstName} sub={sub} lastVisit={lastVisit} />
      <Journey step={step} />
      {nextApt && (
        <NextSession
          apt={nextApt}
          onReschedule={() => { setRescheduleTarget(nextApt); setShowBookingModal(true); }}
          onCancel={() => setCancelTarget(nextApt)}
        />
      )}
      {hasActiveSeries && <SeriesPanel client={client} />}
      <ComingUp
        sessions={otherUpcoming}
        onReschedule={(a) => { setRescheduleTarget(a); setShowBookingModal(true); }}
        onCancel={(a) => setCancelTarget(a)}
      />
      <BookManage actions={actions} />
      <History items={appointments} />
      <Footer />
    </div>
  );
}
