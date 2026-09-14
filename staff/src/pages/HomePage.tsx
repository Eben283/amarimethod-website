import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  MessageSquare,
  RefreshCw,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHomeOperations } from '../hooks/useHomeOperations';
import { memberWorkspacePath } from '../lib/member-workspace';
import type { TodayAppointment } from '../types/staff';
import './HomePage.css';

const OFFSET_OR_Z = /([+-]\d{2}:?\d{2}|Z)$/i;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function pacificWallClockAsUtc(ms: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '0';
  return Date.UTC(+value('year'), +value('month') - 1, +value('day'), +value('hour') % 24, +value('minute'), +value('second'));
}

function appointmentMs(value: string) {
  if (!value) return NaN;
  if (OFFSET_OR_Z.test(value)) return new Date(value).getTime();
  const match = NAIVE_DATETIME.exec(value);
  if (!match) return NaN;
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

function relativeTime(value: string | number | null | undefined) {
  if (!value) return 'Time unavailable';
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ms)) return 'Time unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ms));
}

function fullDate() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
  }).format(new Date());
}

function scheduleStatus(appointment: TodayAppointment, now: number) {
  const start = appointmentMs(appointment.startTime);
  const end = appointmentMs(appointment.endTime);
  if (start <= now && now < end) return 'now';
  if (end <= now) return 'past';
  return 'upcoming';
}

function appointmentRoute(appointment: TodayAppointment) {
  return memberWorkspacePath(appointment.contactId, 'session', appointment.id);
}

function StateMessage({ loading, error, children }: { loading: boolean; error: string | null; children: React.ReactNode }) {
  if (loading) return <div className="staff-home__state"><Loader2 aria-hidden="true" /> Loading…</div>;
  if (error) return <div className="staff-home__state staff-home__state--error" role="alert"><TriangleAlert aria-hidden="true" /><span>{error}</span></div>;
  return <>{children}</>;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { state, refresh } = useHomeOperations();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const schedule = useMemo(() => (state.schedule.data || [])
    .filter((appointment) => appointment.appointmentStatus?.toLowerCase() !== 'cancelled')
    .sort((a, b) => appointmentMs(a.startTime) - appointmentMs(b.startTime)), [state.schedule.data]);
  const replies = state.conversations.data || [];
  const sickSystems = (state.systems.data?.systems || [])
    .filter((system) => ['red', 'sick', 'stuck', 'map_bad'].includes(system.state));
  const totalAttention = replies.length + sickSystems.length;
  const attentionLoading = state.conversations.loading || state.systems.loading;
  const attentionHasError = Boolean(state.conversations.error || state.systems.error);
  const homeLoading = state.schedule.loading || attentionLoading;
  const summary = homeLoading
    ? 'Loading today’s practice data.'
    : `${schedule.length} ${schedule.length === 1 ? 'session' : 'sessions'} today. ${replies.length} ${replies.length === 1 ? 'conversation needs' : 'conversations need'} a reply${sickSystems.length ? `, and ${sickSystems.length} system ${sickSystems.length === 1 ? 'issue needs' : 'issues need'} review` : ''}.`;
  const refreshedLabel = state.refreshedAt
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(state.refreshedAt))
    : 'Refresh';

  return (
    <main className="staff-home">
      <header className="staff-home__opening">
        <div>
          <p>{fullDate()}</p>
          <h1>Good morning.</h1>
        </div>
        <div className="staff-home__summary">
          <span>{summary}</span>
          <button type="button" onClick={() => { void refresh(); }} aria-label="Refresh Home data">
            <RefreshCw aria-hidden="true" /> {refreshedLabel}
          </button>
        </div>
      </header>

      <div className="staff-home__primary-grid">
        <section aria-labelledby="home-schedule-title">
          <header className="staff-home__section-head">
            <h2 id="home-schedule-title">Today</h2>
            <span>Pacific time</span>
          </header>
          <div className="staff-home__schedule">
            <header>
              <strong>Session schedule</strong>
              <span>{state.schedule.loading ? 'Loading' : `${schedule.length} booked`}</span>
            </header>
            <StateMessage loading={state.schedule.loading} error={state.schedule.error}>
              {schedule.slice(0, 5).map((appointment) => {
                const status = scheduleStatus(appointment, now);
                return (
                  <button key={appointment.id} type="button" className={`is-${status}`} onClick={() => navigate(appointmentRoute(appointment))}>
                    <time>{appointmentTime(appointment.startTime)}</time>
                    <i aria-hidden="true" />
                    <span><strong>{appointment.contactName}</strong><small>{appointment.title || appointment.calendarName}</small></span>
                    {status === 'now' ? <em>In session</em> : <em>Open session</em>}
                  </button>
                );
              })}
              {!schedule.length ? <p className="staff-home__empty">No sessions are on today’s schedule.</p> : null}
            </StateMessage>
          </div>
          <footer className="staff-home__schedule-foot">
            <span>{schedule.length > 5 ? `${schedule.length - 5} more today` : 'Live Staff calendar'}</span>
            <button type="button" onClick={() => navigate('/calendar')}>Open calendar</button>
          </footer>
        </section>

        <section aria-labelledby="home-attention-title">
          <header className="staff-home__section-head">
            <h2 id="home-attention-title">Attention</h2>
            <span>{totalAttention} {totalAttention === 1 ? 'item' : 'items'}</span>
          </header>
          <div className="staff-home__attention">
            <header>
              <strong>Work requiring a person</strong>
              <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'} · {sickSystems.length} {sickSystems.length === 1 ? 'system' : 'systems'}</span>
            </header>
            {attentionLoading ? <StateMessage loading error={null}>{null}</StateMessage> : <>
              {state.conversations.error ? <StateMessage loading={false} error={state.conversations.error}>{null}</StateMessage> : replies.slice(0, 3).map((reply) => (
                <button key={reply.id} type="button" onClick={() => navigate(`/client-desk?contact=${encodeURIComponent(reply.contactId)}`)}>
                  <span className="staff-home__attention-icon"><MessageSquare aria-hidden="true" /></span>
                  <span><strong>{reply.contactName || reply.email || reply.phone}</strong><small>{reply.lastMessagePreview || 'New message'}</small></span>
                  <time>{relativeTime(reply.lastMessageDate)}</time>
                </button>
              ))}
              {state.systems.error ? <StateMessage loading={false} error={state.systems.error}>{null}</StateMessage> : sickSystems.slice(0, 2).map((system) => (
                <button key={system.id} type="button" onClick={() => navigate('/operations?tab=systems')}>
                  <span className="staff-home__attention-icon staff-home__attention-icon--system"><Workflow aria-hidden="true" /></span>
                  <span><strong>{system.label}</strong><small>{system.note || system.status}</small></span>
                  <time>Review</time>
                </button>
              ))}
            </>}
            {!homeLoading && totalAttention === 0 ? <p className="staff-home__empty">Nothing needs attention right now.</p> : null}
          </div>
          {!attentionLoading && !attentionHasError ? (
            <div className="staff-home__settled">
              <CheckCircle2 aria-hidden="true" />
              <span><strong>Completed conversations stay out of the work queue</strong><small>Reactions, thanks, and other closing messages remain available in All conversations.</small></span>
            </div>
          ) : null}
        </section>
      </div>

      <div className="staff-home__secondary-grid">
        <section aria-labelledby="home-practice-title">
          <header className="staff-home__section-head">
            <h2 id="home-practice-title">Practice</h2>
            <span>{state.revenue.data?.thisMonth.month || 'Current month'}</span>
          </header>
          <div className="staff-home__metrics">
            <div><span>Sessions today</span><strong>{state.schedule.loading ? '…' : schedule.length}</strong><small>Live calendar</small></div>
            <div><span>Collected</span><strong>{state.revenue.loading ? '…' : state.revenue.error ? '—' : money.format(state.revenue.data?.thisMonth.gross || 0)}</strong><small>{state.revenue.error ? 'Revenue unavailable' : `${state.revenue.data?.thisMonth.chargeCount || 0} successful charges`}</small></div>
            <div><span>Needs review</span><strong>{state.systems.loading ? '…' : sickSystems.length}</strong><small>Monitored systems</small></div>
          </div>
        </section>

        <section aria-labelledby="home-quick-title">
          <header className="staff-home__section-head"><h2 id="home-quick-title">Quick access</h2></header>
          <div className="staff-home__quick">
            <button type="button" onClick={() => navigate('/client-desk')}><span>Open the message desk</span><ChevronRight aria-hidden="true" /></button>
            <button type="button" onClick={() => navigate('/balances')}><span>Review session balances</span><ChevronRight aria-hidden="true" /></button>
            <button type="button" onClick={() => navigate('/clients')}><span>Find a practice member</span><ChevronRight aria-hidden="true" /></button>
          </div>
        </section>
      </div>
    </main>
  );
}
