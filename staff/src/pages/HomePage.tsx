import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardPlus,
  GraduationCap,
  Kanban,
  Loader2,
  MapPinned,
  MessageCircleMore,
  RefreshCw,
  Search,
  ShoppingBag,
  Palette,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHomeOperations } from '../hooks/useHomeOperations';
import { memberWorkspacePath } from '../lib/member-workspace';
import { selectAcquisitionProspects } from '../lib/outreach-scope';
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

function time(value: string) {
  const ms = appointmentMs(value);
  if (!Number.isFinite(ms)) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date(ms));
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
  if (loading) return <div className="home-state"><Loader2 aria-hidden="true" /> Loading…</div>;
  if (error) return <div className="home-state home-state--error"><TriangleAlert aria-hidden="true" /><span>{error}</span></div>;
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
  const current = schedule.find((appointment) => scheduleStatus(appointment, now) === 'now');
  const next = schedule.find((appointment) => scheduleStatus(appointment, now) === 'upcoming');
  const sessionDoor = current || next || null;
  const replies = (state.conversations.data || []).slice(0, 4);
  const needsReplyIds = useMemo(
    () => new Set((state.conversations.data || []).map((conversation) => conversation.contactId)),
    [state.conversations.data],
  );
  const outreach = useMemo(
    () => selectAcquisitionProspects(state.outreach.data?.prospects || [], 3, needsReplyIds),
    [needsReplyIds, state.outreach.data],
  );
  const sickSystems = (state.systems.data?.systems || []).filter((system) => ['red', 'sick', 'stuck', 'map_bad'].includes(system.state));
  const refreshedLabel = state.refreshedAt
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(state.refreshedAt))
    : null;

  return (
    <main className="integrated-home">
      <header className="integrated-home__header">
        <div>
          <p className="integrated-home__eyebrow">Amari Method · staff</p>
          <h1>Here’s the practice right now.</h1>
          <span>{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date())}</span>
        </div>
        <div className="integrated-home__header-actions">
          <button type="button" onClick={() => navigate('/client-desk')}><Search aria-hidden="true" /> Find a person</button>
          <button type="button" onClick={() => { void refresh(); }} aria-label="Refresh home"><RefreshCw aria-hidden="true" />{refreshedLabel ? `Updated ${refreshedLabel}` : 'Refresh'}</button>
        </div>
      </header>

      <section className="home-shift" aria-label="Current session and today’s schedule">
        <div className="home-now">
          <p>{current ? 'In session now' : next ? 'Next session' : 'Session desk'}</p>
          <StateMessage loading={state.schedule.loading} error={state.schedule.error}>
            {sessionDoor ? (
              <button type="button" onClick={() => navigate(appointmentRoute(sessionDoor))}>
                <span className="home-now__time">{time(sessionDoor.startTime)}</span>
                <strong>{sessionDoor.contactName}</strong>
                <small>{sessionDoor.title || sessionDoor.calendarName}</small>
                <span className="home-now__action">Open session record <ArrowRight aria-hidden="true" /></span>
              </button>
            ) : (
              <button type="button" onClick={() => navigate('/calendar')}>
                <span className="home-now__time">Clear</span>
                <strong>No more sessions today</strong>
                <small>Review the full day or prepare tomorrow.</small>
                <span className="home-now__action">Open calendar <ArrowRight aria-hidden="true" /></span>
              </button>
            )}
          </StateMessage>
        </div>

        <div className="home-day">
          <header className="home-panel-head">
            <div><p>Today</p><span>{schedule.length} {schedule.length === 1 ? 'appointment' : 'appointments'}</span></div>
            <button type="button" onClick={() => navigate('/calendar')}>Full calendar <ChevronRight aria-hidden="true" /></button>
          </header>
          <StateMessage loading={state.schedule.loading} error={state.schedule.error}>
            {schedule.length ? (
              <ol className="home-day__rail">
                {schedule.map((appointment) => {
                  const status = scheduleStatus(appointment, now);
                  return <li key={appointment.id} className={`home-day__item home-day__item--${status}`}>
                    <button type="button" onClick={() => navigate(appointmentRoute(appointment))}>
                      <time>{time(appointment.startTime)}</time>
                      <span><strong>{appointment.contactName}</strong><small>{appointment.title || appointment.calendarName}</small></span>
                      {status === 'now' ? <em>Now</em> : <ChevronRight aria-hidden="true" />}
                    </button>
                  </li>;
                })}
              </ol>
            ) : <div className="home-empty">No appointments remain on today’s schedule. <button type="button" onClick={() => navigate('/calendar')}>Open the calendar</button></div>}
          </StateMessage>
        </div>
      </section>

      <section className="home-workboard" aria-label="Practice workboard">
        <div className="home-attention">
          <header className="home-panel-head">
            <div><p>Attention</p><span>Work that needs a person</span></div>
            <strong>{(state.conversations.data?.length || 0) + (state.systems.data?.attentionCount || 0)}</strong>
          </header>

          {sickSystems.slice(0, 2).map((system) => (
            <button key={system.id} type="button" className="home-attention__item home-attention__item--danger" onClick={() => navigate('/operations?tab=systems')}>
              <Activity aria-hidden="true" /><span><strong>{system.label}</strong><small>{system.note || 'System needs attention'}</small></span><ChevronRight aria-hidden="true" />
            </button>
          ))}

          <StateMessage loading={state.conversations.loading} error={state.conversations.error}>
            {replies.map((reply) => (
              <button key={reply.id} type="button" className="home-attention__item" onClick={() => navigate('/client-desk')}>
                <MessageCircleMore aria-hidden="true" />
                <span><strong>{reply.contactName || reply.email || reply.phone}</strong><small>{reply.lastMessagePreview || 'New message'} · {relativeTime(reply.lastMessageDate)}</small></span>
                <i aria-label="Needs reply" />
              </button>
            ))}
          </StateMessage>

          {!state.conversations.loading && !state.conversations.error && !replies.length && !sickSystems.length ? (
            <div className="home-clear"><span>Clear</span><p>No unanswered replies or system incidents are showing.</p></div>
          ) : null}

        </div>

        <div className="home-replies">
          <header className="home-panel-head">
            <div><p>New-client outreach</p><span>{state.outreach.data?.generatedAt ? `Prospects updated ${relativeTime(state.outreach.data.generatedAt)}` : 'Prospects only'}</span></div>
            <button type="button" onClick={() => navigate('/outreach')}>Open outreach <ChevronRight aria-hidden="true" /></button>
          </header>
          <StateMessage loading={state.outreach.loading} error={state.outreach.error}>
            {outreach.length ? outreach.map((prospect) => (
              <button type="button" key={prospect.contactId} className="home-followup" onClick={() => navigate('/outreach')}>
                <span><strong>{prospect.fullName}</strong><small>{prospect.derived?.why || 'Ready for a new-client outreach touch'}</small></span><ChevronRight aria-hidden="true" />
              </button>
            )) : <div className="home-empty">No new-client prospects are due. Current and former clients stay in People. <button type="button" onClick={() => navigate('/outreach')}>Review outreach</button></div>}
          </StateMessage>
        </div>

        <div className="home-money">
          <header className="home-panel-head"><div><p>Money &amp; balances</p><span>Read-only practice signals</span></div></header>
          <div className="home-money__figures">
            <button type="button" onClick={() => navigate('/revenue')}>
              <CircleDollarSign aria-hidden="true" /><span><small>This month</small><strong>{state.revenue.loading ? '…' : state.revenue.error ? 'Unavailable' : money.format(state.revenue.data?.thisMonth.gross || 0)}</strong><em>{state.revenue.data?.thisMonth.chargeCount || 0} successful charges</em></span>
            </button>
            <button type="button" onClick={() => navigate('/balances')}>
              <Wallet aria-hidden="true" /><span><small>Session balances</small><strong>Review</strong><em>Open the full ledger and payment checks</em></span>
            </button>
          </div>
          {state.revenue.error ? <p className="home-inline-error">Revenue is unavailable. Open its workspace to retry.</p> : null}
        </div>

        <div className="home-health">
          <header className="home-panel-head"><div><p>System health</p><span>{state.systems.data?.generatedAt ? `Updated ${relativeTime(state.systems.data.generatedAt)}` : 'Live monitoring'}</span></div></header>
          <StateMessage loading={state.systems.loading} error={state.systems.error}>
            <button type="button" onClick={() => navigate('/operations?tab=systems')} className={`home-health__signal home-health__signal--${state.systems.data?.overall || 'unknown'}`}>
              <span>{state.systems.data?.attentionCount || 0}</span><div><strong>{state.systems.data?.attentionCount ? 'systems need attention' : 'Monitored systems are clear'}</strong><small>Open Operations for paths, heartbeats, and incident details.</small></div><ChevronRight aria-hidden="true" />
            </button>
            <p className="home-health__sms">Ops alerts still arrive by text. Text <strong>OPS</strong> to <strong>(628) 600-0806</strong> for the command menu.</p>
          </StateMessage>
        </div>
      </section>

      <section className="home-tools" aria-label="More Staff tools">
        <header className="home-panel-head"><div><p>More tools</p><span>Use these when the work calls for them</span></div></header>
        <div className="home-tools__grid">
          {[
            { label: 'Communication', detail: 'Complete message chronology', Icon: MessageCircleMore, to: '/client-desk' },
            { label: 'Staff POS', detail: 'Create a draft checkout', Icon: ShoppingBag, to: '/pos' },
            { label: 'Funnel', detail: 'Lead flow and pace', Icon: TrendingUp, to: '/funnel' },
            { label: 'Pipeline', detail: 'Current care flow', Icon: Kanban, to: '/pipeline' },
            { label: 'Ask Amari', detail: 'Chief of Staff', Icon: Sparkles, to: '/cos' },
            { label: 'Training', detail: 'Sharpen, scripts and playbooks', Icon: GraduationCap, to: '/training' },
            { label: 'Design system', detail: 'Brand and collateral reference', Icon: Palette, to: '/design-system' },
            { label: 'Community', detail: 'Field relationships', Icon: MapPinned, to: '/community' },
            { label: 'Operations', detail: 'System health and cutover checks', Icon: Activity, to: '/operations' },
          ].map(({ label, detail, Icon, to }) => <button key={label} type="button" onClick={() => navigate(to)}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight aria-hidden="true" /></button>)}
        </div>
      </section>

      <details className="home-specialist">
        <summary><BookOpen aria-hidden="true" /><span><strong>Reference links</strong><small>Occasional staff material that does not belong in the daily navigation.</small></span><ChevronRight aria-hidden="true" /></summary>
        <div>
          <a href="/field-signup" target="_blank" rel="noreferrer"><ClipboardPlus aria-hidden="true" /><span><strong>Study session links</strong><small>Public signup directory</small></span></a>
          <a href="/staff/resources/booking-rules.html" target="_blank" rel="noreferrer"><CalendarDays aria-hidden="true" /><span><strong>Booking rules</strong><small>Durations, buffers, and starts</small></span></a>
        </div>
      </details>
    </main>
  );
}
